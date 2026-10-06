import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { withGroq } from "./support/groqStub";

// API routes without other coverage: publishing a share link, the normaliser endpoint, PNG download, and the three AI
// routes. Groq is stubbed (tests/support/groqStub) and Prisma is an in-memory stand-in (lib/db uses globalThis.prisma),
// so nothing touches the network or the real database. Routes are imported after the stand-ins are in place.

process.env.RATE_LIMIT_DISABLED = "true";

const created: any[] = [];
let slugTaken = 0;
(globalThis as any).prisma = {
  sharedDiagram: {
    findUnique: async () => (slugTaken-- > 0 ? { id: "taken" } : null),
    create: async ({ data }: any) => {
      const row = { id: `s${created.length + 1}`, views: 0, createdAt: new Date(0), updatedAt: new Date(0), ...data };
      created.push(row);
      return row;
    },
  },
};

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }) as any;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ─── POST /api/share (publish) ──────────────────────────────────────────────────────────────────────────────────────

test("publish: returns the link and an edit token; stores only the token's hash", async () => {
  const { POST } = await import("../src/app/api/share/route");
  const res = await POST(post("/api/share", { title: "Shop", dbml: "Table a { id int [pk] }", layout: { a: { x: 1, y: 2 } } }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.slug, /^[A-Za-z0-9]{9}$/);
  assert.equal(body.url, `http://localhost/share/${body.slug}`);
  assert.equal(body.visibility, "public");
  assert.ok(body.editToken.length >= 30);
  const row = created.at(-1);
  assert.equal(row.editTokenHash, sha256(body.editToken));
  assert.ok(!JSON.stringify(row).includes(body.editToken), "the token itself is never stored");
  assert.equal(row.layoutJson, '{"a":{"x":1,"y":2}}');
  assert.equal(row.passwordHash, null);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("publish: a password-protected diagram stores a salted hash, never the password", async () => {
  const { POST } = await import("../src/app/api/share/route");
  const res = await POST(post("/api/share", { dbml: "Table a { id int }", visibility: "password", password: "hunter22" }), undefined);
  assert.equal(res.status, 200);
  const row = created.at(-1);
  assert.equal(row.title, "Untitled diagram");
  assert.match(row.passwordHash, /^[0-9a-f]{64}$/);
  assert.match(row.passwordSalt, /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(row).includes("hunter22"));
});

test("publish: a slug that is already taken is replaced by a fresh one", async () => {
  const { POST } = await import("../src/app/api/share/route");
  slugTaken = 2;
  const res = await POST(post("/api/share", { dbml: "Table a { id int }" }), undefined);
  assert.equal(res.status, 200);
  assert.equal(slugTaken, -1, "looked up three slugs: two taken, then a free one");
});

test("publish: input checks — DBML required, size limit, visibility values, password length, title length", async () => {
  const { POST } = await import("../src/app/api/share/route");
  const call = async (body: unknown) => {
    const r = await POST(post("/api/share", body), undefined);
    return [r.status, (await r.json()).error];
  };
  assert.deepEqual(await call({ dbml: "   " }), [400, "dbml is required"]);
  assert.deepEqual(await call({ dbml: 42 }), [400, "dbml is required"]);
  assert.deepEqual(await call({ dbml: "x".repeat(2_000_001) }), [413, "Diagram is too large to publish"]);
  assert.deepEqual(await call({ dbml: "Table a {}", visibility: "secret" }), [400, "Invalid visibility"]);
  assert.deepEqual(await call({ dbml: "Table a {}", visibility: "password", password: "abc" }), [400, "Choose a password of at least 4 characters"]);
  const before = created.length;
  await POST(post("/api/share", { dbml: "Table a {}", title: "T".repeat(500) }), undefined);
  assert.equal(created.length, before + 1);
  assert.equal(created.at(-1).title.length, 200);
});

test("publish: a body that is not JSON is a 500 with a message, not a crash", async () => {
  const { POST } = await import("../src/app/api/share/route");
  const res = await POST(post("/api/share", "{not json"), undefined);
  assert.equal(res.status, 500);
  assert.ok((await res.json()).error);
});

// ─── POST /api/audit (the 3NF normaliser over HTTP) ─────────────────────────────────────────────────────────────────

test("audit: normalises a valid schema and reports what it changed", async () => {
  const { POST } = await import("../src/app/api/audit/route");
  const schema = { entities: [{ name: "post", attributes: [{ name: "post_id", dataType: "INTEGER", isPrimaryKey: true }, { name: "tags", dataType: "TEXT" }] }] };
  const res = await POST(post("/api/audit", { schema }), undefined);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.issuesFound, 1);
  assert.deepEqual(body.normalizedSchema.entities.map((e: any) => e.name), ["post", "post_tag"]);
  assert.match(body.report, /Normalization Report/);
});

test("audit: missing or malformed schemas are 400s that say why", async () => {
  const { POST } = await import("../src/app/api/audit/route");
  const missing = await POST(post("/api/audit", {}), undefined);
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, "Schema is required");
  const bad = await POST(post("/api/audit", { schema: { entities: "nope" } }), undefined);
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.equal(body.error, "Invalid schema format");
  assert.ok(body.details.entities);
});

// ─── POST /api/download-png ─────────────────────────────────────────────────────────────────────────────────────────

test("PNG download: decodes the data URL into an attachment with the right length", async () => {
  const { POST } = await import("../src/app/api/download-png/route");
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const res = await POST(post("/api/download-png", { dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}` }), undefined);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "image/png");
  assert.equal(res.headers.get("Content-Disposition"), 'attachment; filename="designdb_erd.png"');
  assert.equal(res.headers.get("Content-Length"), "8");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), pngBytes);
});

test("PNG download: a missing data URL is a 400", async () => {
  const { POST } = await import("../src/app/api/download-png/route");
  const res = await POST(post("/api/download-png", {}), undefined);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Missing dataUrl");
});

// ─── POST /api/ai-assistant ─────────────────────────────────────────────────────────────────────────────────────────

const GOOD_DBML = "Table users {\n  id int [pk]\n}\n";

test("assistant: a schema change returns the explanation and the DBML, with the schema sent as context", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  await withGroq({ content: `Added a users table.\n\n\`\`\`dbml\n${GOOD_DBML}\`\`\`` }, async (sent) => {
    const res = await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "add users" }], dbml: "Table a { id int }", dialect: "MySQL" }), undefined);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reply, "Added a users table.");
    assert.equal(body.dbml, GOOD_DBML);
    const msgs = sent[0].body.messages;
    assert.equal(msgs[0].role, "system");
    assert.match(msgs[1].content, /^Target database: MySQL\n\nCurrent schema \(DBML\):\n```dbml\nTable a \{ id int \}\n```$/);
    assert.deepEqual(msgs[2], { role: "user", content: "add users" });
  });
});

test("assistant: a question gets a plain answer and no DBML", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  await withGroq({ content: "Use a junction table." }, async () => {
    const body = await (await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "how do I model tags?" }] }), undefined)).json();
    assert.deepEqual(body.reply, "Use a junction table.");
    assert.equal(body.dbml, undefined);
  });
});

test("assistant: DBML that fails to parse gets one corrective retry with the parser's error", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  await withGroq([{ content: "Done.\n```dbml\nTable broken {\n```" }, { content: `Fixed.\n\`\`\`dbml\n${GOOD_DBML}\`\`\`` }], async (sent) => {
    const body = await (await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "x" }] }), undefined)).json();
    assert.equal(sent.length, 2);
    const retry = sent[1].body.messages.at(-1);
    assert.equal(retry.role, "user");
    assert.match(retry.content, /^That DBML failed to parse: .+Return the corrected, COMPLETE DBML/s);
    assert.equal(body.reply, "Fixed.");
    assert.equal(body.dbml, GOOD_DBML);
  });
});

test("assistant: still-broken DBML after the retry is never offered — the user gets a plain explanation", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  await withGroq({ content: "```dbml\nTable broken {\n```" }, async (sent) => {
    const body = await (await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "x" }] }), undefined)).json();
    assert.equal(sent.length, 2, "exactly one retry");
    assert.equal(body.dbml, undefined);
    assert.match(body.reply, /formatting problem I couldn't fix automatically/);
  });
});

test("assistant: only the last 12 messages go to the model, each capped at 8,000 characters; roles are sanitised", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  const history = Array.from({ length: 15 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  history[14] = { role: "system", content: "y".repeat(9000) };
  await withGroq({ content: "ok" }, async (sent) => {
    await POST(post("/api/ai-assistant", { messages: history, dbml: "z".repeat(70_000) }), undefined);
    const msgs = sent[0].body.messages.slice(2);
    assert.equal(msgs.length, 12);
    assert.equal(msgs[0].content, "m3");
    assert.deepEqual(msgs.at(-1), { role: "user", content: "y".repeat(8000) }, "a 'system' message from the client is sent as a user message");
    assert.ok(sent[0].body.messages[1].content.length < 60_200, "the schema context is capped at 60,000 characters");
  });
});

test("assistant: no messages is a 400; no API key is a 503 that names the variable", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  assert.equal((await POST(post("/api/ai-assistant", { messages: [] }), undefined)).status, 400);
  assert.equal((await POST(post("/api/ai-assistant", {}), undefined)).status, 400);
  const realKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    const res = await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "x" }] }), undefined);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /GROQ_API_KEY/);
  } finally {
    if (realKey !== undefined) process.env.GROQ_API_KEY = realKey;
  }
});

test("assistant: Groq's own rate limit becomes a 503 busy answer with Retry-After, without Groq's message", async () => {
  const { POST } = await import("../src/app/api/ai-assistant/route");
  await withGroq({ status: 429, headers: { "retry-after": "9" } }, async () => {
    const res = await POST(post("/api/ai-assistant", { messages: [{ role: "user", content: "x" }] }), undefined);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Retry-After"), "9");
    const text = await res.text();
    assert.ok(!text.includes("org_test"));
    assert.equal(JSON.parse(text).error.code, "AI_BUSY");
  });
});

// ─── POST /api/ai-query ─────────────────────────────────────────────────────────────────────────────────────────────

test("AI query: sends the schema as context and returns the SQL without code fences", async () => {
  const { POST } = await import("../src/app/api/ai-query/route");
  await withGroq({ content: "```sql\nSELECT name FROM users LIMIT 10;\n```" }, async (sent) => {
    const res = await POST(post("/api/ai-query", { prompt: "ten user names", tables: { users: [{ name: "id", type: "int" }, { name: "name", type: "text" }] } }), undefined);
    assert.deepEqual(await res.json(), { query: "SELECT name FROM users LIMIT 10;" });
    const system = sent[0].body.messages[0].content;
    assert.match(system, /Database Schema:\nTABLE users:\n {2}id int\n {2}name text$/);
    assert.deepEqual(sent[0].body.messages[1], { role: "user", content: "ten user names" });
  });
});

test("AI query: no schema says so; a malformed table entry is skipped rather than failing the request", async () => {
  const { POST } = await import("../src/app/api/ai-query/route");
  await withGroq({ content: "SELECT 1;" }, async (sent) => {
    await POST(post("/api/ai-query", { prompt: "anything" }), undefined);
    assert.match(sent[0].body.messages[0].content, /No schema available\.$/);
    const res = await POST(post("/api/ai-query", { prompt: "anything", tables: { users: "id int", orders: [{ name: "id", type: "int" }] } }), undefined);
    assert.equal(res.status, 200);
    assert.match(sent[1].body.messages[0].content, /TABLE orders:\n {2}id int$/);
    assert.doesNotMatch(sent[1].body.messages[0].content, /TABLE users/);
  });
});

test("AI query: a missing prompt is a 400 and Groq is never called", async () => {
  const { POST } = await import("../src/app/api/ai-query/route");
  await withGroq({ content: "SELECT 1;" }, async (sent) => {
    const res = await POST(post("/api/ai-query", { tables: {} }), undefined);
    assert.equal(res.status, 400);
    assert.equal(sent.length, 0);
  });
});

// ─── POST /api/generate ─────────────────────────────────────────────────────────────────────────────────────────────

const LIBRARY = JSON.stringify({
  entities: [
    { name: "book", attributes: [{ name: "book_id", dataType: "INTEGER", isPrimaryKey: true }, { name: "title", dataType: "VARCHAR(200)" }] },
    { name: "loan", attributes: [{ name: "loan_id", dataType: "INTEGER", isPrimaryKey: true }, { name: "book_id", dataType: "INTEGER" }] },
  ],
  relationships: [{ fromEntity: "loan", toEntity: "book", type: "many-to-one", foreignKey: "book_id", referencedKey: "book_id" }],
});

test("generate: prompt → normalised schema, Mermaid, PostgreSQL and a report", async () => {
  const { POST } = await import("../src/app/api/generate/route");
  await withGroq({ content: LIBRARY }, async () => {
    const res = await POST(post("/api/generate", { prompt: "a library" }), undefined);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.schema.entities.map((e: any) => e.name), ["book", "loan"]);
    assert.match(body.mermaid, /^erDiagram\n/);
    assert.match(body.mermaid, /loan }o--\|\| book/);
    assert.match(body.sql, /CREATE TABLE book \(/);
    assert.match(body.sql, /DROP TABLE IF EXISTS loan CASCADE;/);
    assert.match(body.report, /Schema was already in 3NF/);
  });
});

test("generate: a missing prompt is a 400; a body that is not JSON is a 500", async () => {
  const { POST } = await import("../src/app/api/generate/route");
  assert.equal((await POST(post("/api/generate", {}), undefined)).status, 400);
  assert.equal((await POST(post("/api/generate", "{oops"), undefined)).status, 500);
});

test("generate: with the AI cache on, a repeated prompt is answered from the cache; fresh:true asks again", async () => {
  const { POST } = await import("../src/app/api/generate/route");
  process.env.CACHE_AI = "true";
  try {
    await withGroq({ content: LIBRARY }, async (sent) => {
      const a = await POST(post("/api/generate", { prompt: "a  library\n" }), undefined);
      const b = await POST(post("/api/generate", { prompt: "a library" }), undefined);
      assert.equal(a.headers.get("X-Cache"), "MISS");
      assert.equal(b.headers.get("X-Cache"), "HIT", "whitespace differences do not matter");
      assert.equal(sent.length, 1);
      const c = await POST(post("/api/generate", { prompt: "a library", fresh: true }), undefined);
      assert.equal(c.headers.get("X-Cache"), "MISS");
      assert.equal(sent.length, 2);
      await POST(post("/api/generate", { prompt: "a library", existingSchema: { entities: [] } }), undefined);
      assert.equal(sent.length, 3, "an edit of an existing schema is never served from the cache");
    });
  } finally {
    delete process.env.CACHE_AI;
  }
});

test("generate: Groq's rate limit becomes a 503 busy answer", async () => {
  const { POST } = await import("../src/app/api/generate/route");
  await withGroq({ status: 429 }, async () => {
    const res = await POST(post("/api/generate", { prompt: "rate limited prompt" }), undefined);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("Retry-After"), "30");
  });
});
