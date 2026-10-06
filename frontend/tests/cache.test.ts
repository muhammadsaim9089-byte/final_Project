import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

// Route handlers are exercised against an in-memory stand-in for Prisma (lib/db uses globalThis.prisma when it is set),
// so these tests never touch the real database. Routes are imported dynamically, after the stand-in is in place.
process.env.RATE_LIMIT_DISABLED = "true";

type Row = Record<string, any>;
const calls: Record<string, number> = {};
const count = (k: string) => (calls[k] = (calls[k] || 0) + 1);
let clock = Date.UTC(2026, 9, 3, 9, 0, 0);
const tick = () => new Date((clock += 1000));
let nextId = 1;

const projects: Row[] = [];
const shares: Row[] = [];
const fakeDb = {
  user: { upsert: async () => ({}) },
  project: {
    findMany: async ({ where, orderBy, take, select }: any = {}) => {
      count("project.findMany");
      let rows = projects.filter((p) => !where?.userId || p.userId === where.userId);
      if (orderBy?.updatedAt === "desc") rows = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
      if (take) rows = rows.slice(0, take);
      return rows.map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r }));
    },
    findUnique: async ({ where }: any) => {
      count("project.findUnique");
      const r = projects.find((p) => p.id === where.id);
      return r ? { ...r } : null;
    },
    create: async ({ data }: any) => {
      const r = { id: `p${nextId++}`, metaJson: "{}", rawPrompt: "", createdAt: tick(), updatedAt: tick(), ...data };
      projects.push(r);
      return { ...r };
    },
    update: async ({ where, data }: any) => {
      const r = projects.find((p) => p.id === where.id);
      if (!r) throw new Error("not found");
      Object.assign(r, data, { updatedAt: tick() });
      return { ...r };
    },
    delete: async ({ where }: any) => {
      const i = projects.findIndex((p) => p.id === where.id);
      if (i < 0) throw new Error("not found");
      return projects.splice(i, 1)[0];
    },
  },
  sharedDiagram: {
    findUnique: async ({ where }: any) => {
      count("share.findUnique");
      const r = shares.find((s) => s.slug === where.slug);
      return r ? { ...r } : null;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let rows = shares.filter((s) => !where?.visibility?.in || where.visibility.in.includes(s.visibility));
      if (orderBy?.views === "desc") rows = [...rows].sort((a, b) => b.views - a.views);
      return rows.slice(0, take ?? rows.length).map((r) => ({ ...r }));
    },
    update: async ({ where, data }: any) => {
      const r = shares.find((s) => s.id === where.id);
      if (!r) throw new Error("not found");
      if (data.views?.increment) {
        r.views += data.views.increment;
        return { ...r };
      }
      Object.assign(r, data, { updatedAt: tick() });
      return { ...r };
    },
    delete: async ({ where }: any) => {
      const i = shares.findIndex((s) => s.id === where.id);
      return shares.splice(i, 1)[0];
    },
  },
};
(globalThis as any).prisma = fakeDb;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
function addShare(slug: string, visibility: string, views = 0) {
  const row = { id: `s-${slug}`, slug, title: `Diagram ${slug}`, dbml: "Table a { id int [pk] }", layoutJson: "{}", visibility, passwordHash: null, passwordSalt: null, editTokenHash: sha256(`token-${slug}`), views, createdAt: tick(), updatedAt: tick() };
  shares.push(row);
  return row;
}

const req = (url: string, init: RequestInit = {}) => new Request(`http://localhost${url}`, init);
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ─── the cache itself ───────────────────────────────────────────────────────────────────────────────────────────────

test("TTL expiry, LRU eviction and the hit / miss / eviction counters", async () => {
  const { TtlLruCache } = await import("../src/lib/server/cache");
  let now = 0;
  const c = new TtlLruCache<string>("t", { max: 3, ttlMs: 1000, now: () => now });
  c.set("a", "A");
  c.set("b", "B");
  c.set("c", "C");
  assert.equal(c.get("a"), "A"); // a is now the most recently used
  c.set("d", "D"); // evicts the least recently used: b
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), "A");
  now = 1001;
  assert.equal(c.get("c"), undefined, "expired");
  const s = c.stats();
  assert.equal(s.hits, 2);
  assert.equal(s.misses, 2);
  assert.equal(s.evictions, 1);
  assert.equal(s.hitRate, 0.5);
});

test("size budgets: oversized entries are skipped, the byte budget evicts least recently used", async () => {
  const { TtlLruCache } = await import("../src/lib/server/cache");
  const c = new TtlLruCache<{ body: string }>("b", { max: 100, ttlMs: 60_000, maxBytes: 10, maxEntryBytes: 6, sizeOf: (v) => v.body.length });
  c.set("huge", { body: "x".repeat(7) });
  assert.equal(c.get("huge"), undefined);
  c.set("a", { body: "aaaa" });
  c.set("b", { body: "bbbb" });
  c.set("c", { body: "cccc" }); // 12 > 10: a goes
  assert.equal(c.get("a"), undefined);
  assert.equal(c.stats().bytes, 8);
});

test("prefix invalidation and CACHE_DISABLED", async () => {
  const { TtlLruCache } = await import("../src/lib/server/cache");
  const c = new TtlLruCache<number>("p", { ttlMs: 60_000 });
  c.set("cache:projects:list:u1", 1);
  c.set("cache:projects:list:u2", 2);
  c.set("cache:projects:item:x", 3);
  assert.equal(c.deleteByPrefix("cache:projects:list:"), 2);
  assert.equal(c.get("cache:projects:item:x"), 3);
  process.env.CACHE_DISABLED = "true";
  try {
    assert.equal(c.get("cache:projects:item:x"), undefined);
    c.set("k", 1);
  } finally {
    delete process.env.CACHE_DISABLED;
  }
  assert.equal(c.get("k"), undefined);
});

test("concurrent misses share one load; undefined is not cached; fresh skips the read", async () => {
  const { TtlLruCache } = await import("../src/lib/server/cache");
  const c = new TtlLruCache<string>("l", { ttlMs: 60_000 });
  let loads = 0;
  const slow = () => new Promise<string>((r) => setTimeout(() => r(`v${++loads}`), 20));
  const [x, y, z] = await Promise.all([c.load("k", slow), c.load("k", slow), c.load("k", slow)]);
  assert.equal(loads, 1);
  assert.deepEqual([x.value, y.value, z.value], ["v1", "v1", "v1"]);
  assert.deepEqual([x.hit, y.hit], [false, true]);
  assert.equal((await c.load("k", slow)).hit, true);
  assert.equal((await c.load("k", slow, { fresh: true })).value, "v2");
  assert.equal(c.get("k"), "v2");
  await c.load("missing", async () => undefined);
  assert.equal(c.get("missing"), undefined);
});

test("a read that began before an invalidation does not store its old result", async () => {
  const { TtlLruCache } = await import("../src/lib/server/cache");
  const c = new TtlLruCache<string>("race", { ttlMs: 60_000 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const stale = c.load("doc", async () => {
    await gate;
    return "old";
  });
  c.delete("doc"); // a write lands while the read is still in flight
  const fresh = c.load("doc", async () => "new"); // must not join the old read
  release();
  assert.equal((await stale).value, "old");
  assert.equal((await fresh).value, "new");
  assert.equal(c.get("doc"), "new");
});

test("memoResponse: 200s are cached, errors are not, a thrown error is not retried", async () => {
  const { TtlLruCache, memoResponse } = await import("../src/lib/server/cache");
  const c = new TtlLruCache<any>("m", { ttlMs: 60_000 });
  let runs = 0;
  const ok = async () => {
    runs++;
    return Response.json({ n: runs });
  };
  const a = await memoResponse(c, "k", ok);
  const b = await memoResponse(c, "k", ok);
  assert.equal(a.headers.get("X-Cache"), "MISS");
  assert.equal(b.headers.get("X-Cache"), "HIT");
  assert.deepEqual(await b.json(), { n: 1 });
  assert.equal(runs, 1);

  let fails = 0;
  const bad = async () => {
    fails++;
    return Response.json({ error: "x" }, { status: 500 });
  };
  assert.equal((await memoResponse(c, "e", bad)).status, 500);
  assert.equal((await memoResponse(c, "e", bad)).status, 500);
  assert.equal(fails, 2, "a failure is never served from the cache");

  let throws = 0;
  await assert.rejects(
    memoResponse(c, "t", async () => {
      throws++;
      throw new Error("boom");
    }),
    /boom/
  );
  assert.equal(throws, 1);
});

// ─── HTTP headers ───────────────────────────────────────────────────────────────────────────────────────────────────

test("cachedJson: policies, ETag and 304 Not Modified", async () => {
  const { cachedJson, etagOf, etagMatches, defaultNoStore } = await import("../src/lib/server/httpCache");
  const body = JSON.stringify({ hello: "world" });
  const etag = etagOf(body);
  assert.equal(etag, etagOf(body), "stable");
  const first = cachedJson(req("/x"), body, "private");
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "private, max-age=0, must-revalidate");
  assert.equal(first.headers.get("Vary"), "Authorization, Cookie");
  assert.equal(first.headers.get("ETag"), etag);
  const again = cachedJson(req("/x", { headers: { "If-None-Match": etag } }), body, "private");
  assert.equal(again.status, 304);
  assert.equal(await again.text(), "");
  assert.equal(cachedJson(req("/x"), body, "public-static").headers.get("Cache-Control"), "public, max-age=300, s-maxage=600, stale-while-revalidate=60");
  assert.equal(cachedJson(req("/x"), body, "public-revalidate").headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  assert.equal(etagMatches(`"nope", W/${etag}`, etag), true);
  assert.equal(etagMatches("*", etag), true);
  assert.equal(etagMatches('"other"', etag), false);
  assert.equal(defaultNoStore(new Response("x")).headers.get("Cache-Control"), "no-store");
  assert.equal(defaultNoStore(cachedJson(req("/x"), body, "private")).headers.get("Cache-Control"), "private, max-age=0, must-revalidate");
});

// ─── routes, against the in-memory database ─────────────────────────────────────────────────────────────────────────

test("project list: cached, revalidated with ETags, invalidated by every kind of write", async () => {
  const list = (await import("../src/app/api/projects/route")).GET;
  const save = (await import("../src/app/api/projects/save/route")).POST;
  const one = await import("../src/app/api/projects/[id]/route");

  const created = await (await save(req("/api/projects/save", json("POST", { title: "Shop", nodes: [], edges: [] })), undefined)).json();
  const id = created.project.id as string;

  const r1 = await list(req("/api/projects"), undefined);
  assert.equal(r1.headers.get("X-Cache"), "MISS");
  assert.equal(r1.headers.get("Cache-Control"), "private, max-age=0, must-revalidate");
  const etag = r1.headers.get("ETag")!;
  const before = calls["project.findMany"];
  const r2 = await list(req("/api/projects", { headers: { "If-None-Match": etag } }), undefined);
  assert.equal(r2.status, 304, "an unchanged list is not sent again");
  assert.equal(r2.headers.get("X-Cache"), "HIT");
  assert.equal(calls["project.findMany"], before, "and the database was not asked");

  // save → fresh list
  await save(req("/api/projects/save", json("POST", { id, title: "Shop v2", nodes: [{ id: "n" }], edges: [] })), undefined);
  const r3 = await list(req("/api/projects", { headers: { "If-None-Match": etag } }), undefined);
  assert.equal(r3.status, 200);
  assert.equal(r3.headers.get("X-Cache"), "MISS");
  assert.equal((await r3.json()).projects[0].title, "Shop v2");

  // single project: cached, then invalidated by a rename
  const g1 = await one.GET(req(`/api/projects/${id}`), { params: { id } });
  assert.equal(g1.headers.get("X-Cache"), "MISS");
  assert.equal((await g1.json()).project.title, "Shop v2");
  assert.equal((await one.GET(req(`/api/projects/${id}`), { params: { id } })).headers.get("X-Cache"), "HIT");
  await one.PATCH(req(`/api/projects/${id}`, json("PATCH", { title: "Renamed" })), { params: { id } });
  const g2 = await one.GET(req(`/api/projects/${id}`), { params: { id } });
  assert.equal(g2.headers.get("X-Cache"), "MISS");
  assert.equal((await g2.json()).project.title, "Renamed");
  assert.equal((await (await list(req("/api/projects"), undefined)).json()).projects[0].title, "Renamed");

  // duplicate adds to the list; delete removes from both
  await one.POST(req(`/api/projects/${id}`, json("POST", { action: "duplicate" })), { params: { id } });
  assert.equal((await (await list(req("/api/projects"), undefined)).json()).projects.length, 2);
  await one.DELETE(req(`/api/projects/${id}`, { method: "DELETE" }), { params: { id } });
  assert.equal((await one.GET(req(`/api/projects/${id}`), { params: { id } })).status, 404);
  assert.equal((await (await list(req("/api/projects"), undefined)).json()).projects.length, 1);
});

test("shared diagram: cached and revalidated, views still counted, updates and unpublishing take effect at once", async () => {
  const share = await import("../src/app/api/share/[slug]/route");
  const row = addShare("pub1", "public");
  const ctx = { params: { slug: "pub1" } };

  const a = await share.GET(req("/api/share/pub1"), ctx);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
  const etag = a.headers.get("ETag")!;
  const reads = calls["share.findUnique"];
  const b = await share.GET(req("/api/share/pub1", { headers: { "If-None-Match": etag } }), ctx);
  assert.equal(b.status, 304);
  assert.equal(calls["share.findUnique"], reads, "served from the cache");
  assert.equal(row.views, 2, "both views counted, 304 included");

  // an update writes through: the next GET shows it with a new ETag
  const put = await share.PUT(req("/api/share/pub1", json("PUT", { editToken: "token-pub1", title: "Retitled" })), ctx);
  assert.equal(put.status, 200);
  assert.equal(put.headers.get("Cache-Control"), "no-store");
  const c = await share.GET(req("/api/share/pub1", { headers: { "If-None-Match": etag } }), ctx);
  assert.equal(c.status, 200);
  assert.equal((await c.json()).title, "Retitled");
  assert.equal(calls["share.findUnique"], reads, "write-through: still no database read");

  // making it private hides it immediately
  await share.PUT(req("/api/share/pub1", json("PUT", { editToken: "token-pub1", visibility: "private" })), ctx);
  const d = await share.GET(req("/api/share/pub1"), ctx);
  assert.equal(d.status, 404);
  assert.equal(d.headers.get("Cache-Control"), "no-store");

  // unpublishing forgets it
  await share.PUT(req("/api/share/pub1", json("PUT", { editToken: "token-pub1", visibility: "public" })), ctx);
  assert.equal((await share.GET(req("/api/share/pub1"), ctx)).status, 200);
  const del = await share.DELETE(req("/api/share/pub1", json("DELETE", { editToken: "token-pub1" })), ctx);
  assert.equal(del.status, 200);
  assert.equal((await share.GET(req("/api/share/pub1"), ctx)).status, 404);
  assert.equal((await share.PUT(req("/api/share/pub1", json("PUT", { editToken: "token-pub1", title: "x" })), ctx)).status, 403);
});

test("convert: results cached by request body, errors never; usage text is publicly cacheable", async () => {
  const convert = await import("../src/app/api/convert/route");
  const body = { input: "Table users {\n  id int [pk]\n}", from: "dbml", to: "sql", dialect: "postgres" };
  const a = await convert.POST(req("/api/convert", json("POST", body)), undefined);
  const b = await convert.POST(req("/api/convert", json("POST", body)), undefined);
  assert.equal(a.headers.get("X-Cache"), "MISS");
  assert.equal(b.headers.get("X-Cache"), "HIT");
  assert.equal(a.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await b.json(), await a.json());
  const raw = await convert.POST(req("/api/convert", json("POST", { ...body, raw: true })), undefined);
  assert.equal(raw.headers.get("X-Cache"), "MISS", "a different body is a different entry");
  assert.match(raw.headers.get("Content-Type") || "", /application\/sql/);
  const bad = { input: "", to: "sql" };
  assert.equal((await convert.POST(req("/api/convert", json("POST", bad)), undefined)).status, 400);
  const bad2 = await convert.POST(req("/api/convert", json("POST", bad)), undefined);
  assert.equal(bad2.status, 400);
  assert.equal(bad2.headers.get("X-Cache"), null);

  const u = await convert.GET(req("/api/convert"), undefined);
  assert.equal(u.headers.get("Cache-Control"), "public, max-age=300, s-maxage=600, stale-while-revalidate=60");
  assert.equal((await convert.GET(req("/api/convert", { headers: { "If-None-Match": u.headers.get("ETag")! } }), undefined)).status, 304);
});

test("every API response that chose no caching policy is no-store", async () => {
  const dl = (await import("../src/app/api/download/route")).POST;
  const res = await dl(req("/api/download", json("POST", { content: "x", filename: "a.sql" })) as any, undefined); // typed for NextRequest
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("warm-up loads the most-viewed shared diagrams and recent project lists, and gives up on time", async () => {
  const { caches, cacheKey } = await import("../src/lib/server/cache");
  const { warmCaches } = await import("../src/lib/server/cacheWarm");
  addShare("hot", "public", 500);
  addShare("hidden", "private", 900);
  caches.shares.clear();
  caches.projects.clear();
  await warmCaches();
  assert.ok(caches.shares.get(cacheKey.share("hot")), "the popular public diagram is warm");
  assert.equal(caches.shares.get(cacheKey.share("hidden")), undefined, "private diagrams are not");
  assert.ok(caches.projects.get(cacheKey.projectList("demo-user-id")), "the active user's list is warm");

  const realFindMany = fakeDb.sharedDiagram.findMany;
  fakeDb.sharedDiagram.findMany = () => new Promise(() => {}); // a database that never answers
  const t0 = Date.now();
  try {
    await warmCaches({ timeoutMs: 50 });
  } finally {
    fakeDb.sharedDiagram.findMany = realFindMany;
  }
  assert.ok(Date.now() - t0 < 1000, "the warm-up stops at its time limit");
});
