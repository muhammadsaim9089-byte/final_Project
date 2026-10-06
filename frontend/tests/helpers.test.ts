import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { hashPassword, hashToken, newEditToken, newSlug, safeEqualHex, verifyPassword } from "../src/lib/server/shareAuth";
import { validateCanvasSchema } from "../src/lib/canvasValidation";
import { mergeModels } from "../src/lib/model/merge";
import { makeZip, csvEscape } from "../src/lib/export/zip";
import { modelToMermaid } from "../src/lib/export/mermaid";
import { emptyModel, type DiagramModel } from "../src/lib/model/types";
import { parseDbml } from "../src/lib/dbml/parser";
import { intentHref, requestEditorIntent, EDITOR_INTENT_EVENT } from "../src/components/Canvas/editorIntent";
import { requestCanvasDelete, DELETE_REQUEST_EVENT } from "../src/components/Canvas/deleteRequest";
import { cn } from "../src/lib/utils";

// ─── share-link secrets (lib/server/shareAuth) ──────────────────────────────────────────────────────────────────────

test("newSlug: the requested length, from an alphabet without look-alike characters", () => {
  const slugs = Array.from({ length: 2000 }, () => newSlug());
  for (const s of slugs) assert.match(s, /^[a-km-zA-HJ-NP-Z2-9]{9}$/);
  assert.equal(new Set(slugs).size, slugs.length, "no repeats in 2,000");
  assert.equal(newSlug(4).length, 4);
  assert.equal(newSlug(0), "");
});

test("newEditToken: 24 random bytes as base64url, unique each time", () => {
  const a = newEditToken();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, newEditToken());
});

test("hashToken: SHA-256 hex, deterministic", () => {
  assert.equal(hashToken("abc"), createHash("sha256").update("abc").digest("hex"));
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
});

test("passwords: verify accepts the password it was hashed from and nothing else", () => {
  const { hash, salt } = hashPassword("correct horse");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.equal(verifyPassword("correct horse", hash, salt), true);
  assert.equal(verifyPassword("correct horse ", hash, salt), false);
  assert.equal(verifyPassword("Correct horse", hash, salt), false);
  assert.equal(verifyPassword("", hash, salt), false);
});

test("passwords: every hash gets its own salt; unicode passwords work", () => {
  const a = hashPassword("pässwörd 🔑");
  const b = hashPassword("pässwörd 🔑");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(verifyPassword("pässwörd 🔑", b.hash, b.salt), true);
});

test("passwords: a corrupted stored hash is a failed check, not an exception", () => {
  const { salt } = hashPassword("x");
  assert.equal(verifyPassword("x", "not-hex", salt), false);
  assert.equal(verifyPassword("x", "abcd", salt), false);
  assert.equal(verifyPassword("x", "", salt), false);
});

test("safeEqualHex: equal digests match, different or different-length ones do not", () => {
  const h = hashToken("t");
  assert.equal(safeEqualHex(h, h), true);
  assert.equal(safeEqualHex(h, hashToken("u")), false);
  assert.equal(safeEqualHex(h, h.slice(0, 32)), false);
  assert.equal(safeEqualHex("", ""), true);
});

// ─── canvas validation (the "Validate" button) ──────────────────────────────────────────────────────────────────────

const table = (id: string, label: string, attributes: any[]) => ({ id, position: { x: 0, y: 0 }, data: { label, attributes } }) as any;
const attr = (name: string, type = "int", isPk = false) => ({ name, type, isPk });
const edge = (id: string, source: string, target: string, sourceColumn?: string, targetColumn?: string) => ({ id, source, target, data: { sourceColumn, targetColumn } }) as any;

test("validation: a sound schema has no errors or warnings", () => {
  const r = validateCanvasSchema(
    [table("u", "users", [attr("id", "int", true), attr("email", "varchar")]), table("o", "orders", [attr("id", "int", true), attr("user_id", "bigint")])],
    [edge("e1", "u", "o", "id", "user_id")]
  );
  assert.deepEqual(r, { isValid: true, errors: {}, warnings: {}, globalErrors: [] });
});

test("validation: missing table name, missing key and duplicate columns (case-insensitive) are errors", () => {
  const r = validateCanvasSchema([table("a", "", []), table("b", "logs", [attr("message", "text"), attr("Message", "text")])], []);
  assert.equal(r.isValid, false);
  assert.deepEqual(r.errors.a.map((e) => e.message), ["Table name is missing"]);
  assert.deepEqual(r.errors.b.map((e) => e.message), ["Table 'logs' has no primary key defined", "Table has duplicate column name: 'Message'"]);
});

test("validation: reserved words as table or column names are warnings, not errors", () => {
  const r = validateCanvasSchema([table("o", "Order", [attr("id", "int", true), attr("select")])], []);
  assert.equal(r.isValid, true);
  assert.deepEqual(r.warnings.o.map((w) => w.column), ["header", "select"]);
});

test("validation: a relationship to a missing table, column or key is reported where it belongs", () => {
  const nodes = [table("u", "users", [attr("id", "int", true), attr("code", "varchar")]), table("o", "orders", [attr("id", "int", true), attr("user_id")])];
  const r = validateCanvasSchema(nodes, [edge("e1", "u", "ghost", "id", "x"), edge("e2", "u", "o", "id", "nope"), edge("e3", "u", "o", "uuid", "user_id"), edge("e4", "u", "o", "code", "user_id")]);
  assert.deepEqual(r.globalErrors, ["Relationship references missing table(s): Source [u], Target [ghost]"]);
  assert.deepEqual(r.errors.o.map((e) => e.message), ["Foreign key column 'nope' does not exist in table 'orders'"]);
  assert.deepEqual(r.errors.u.map((e) => e.message), ["Referenced primary key column 'uuid' does not exist in parent table 'users'"]);
  assert.deepEqual(r.warnings.u.map((w) => w.message), ["Referenced column 'code' is not marked as a Primary Key in table 'users'"]);
  assert.deepEqual(r.warnings.o.map((w) => w.message), ["Type mismatch: Foreign key 'user_id' (int) references PK 'code' (varchar) in table 'users'"]);
});

test("validation: integer widths and text types count as compatible; unmapped relationships skip column checks", () => {
  const nodes = [table("u", "users", [attr("id", "smallint", true), attr("slug", "text")]), table("o", "orders", [attr("id", "int", true), attr("user_id", "BIGINT"), attr("user_slug", "varchar(40)")])];
  const r = validateCanvasSchema(nodes, [edge("e1", "u", "o", "id", "user_id"), edge("e2", "u", "o", undefined, undefined)]);
  assert.deepEqual(r.warnings, {});
});

test("validation: a self-referencing table (an employee's manager) is not a circular dependency", () => {
  const nodes = [table("e", "employees", [attr("id", "int", true), attr("manager_id")])];
  const r = validateCanvasSchema(nodes, [edge("self", "e", "e", "id", "manager_id")]);
  assert.equal(r.isValid, true, JSON.stringify(r.errors));
});

test("validation: tables that depend on each other in a loop are a circular dependency", () => {
  const nodes = [table("a", "a", [attr("id", "int", true), attr("b_id")]), table("b", "b", [attr("id", "int", true), attr("a_id")])];
  const r = validateCanvasSchema(nodes, [edge("1", "a", "b", "id", "a_id"), edge("2", "b", "a", "id", "b_id")]);
  assert.equal(r.isValid, false);
  assert.ok(r.errors.a.some((e) => /Circular dependency detected: (a -> b -> a|b -> a -> b)/.test(e.message)));
});

test("validation: a column still being typed (no name yet) does not crash the check", () => {
  const r = validateCanvasSchema([table("t", "t", [attr("id", "int", true), { type: "int" }])], []);
  assert.equal(r.isValid, true);
});

// ─── merging an import into the current diagram ─────────────────────────────────────────────────────────────────────

const dbml = (s: string) => parseDbml(s).model;

test("merge: new tables are added, existing ones kept as they are and reported", () => {
  const base = dbml(`Table users {\n  id int [pk]\n  email text\n}`);
  const incoming = dbml(`Table users {\n  id int [pk]\n  name text\n}\nTable orders {\n  id int [pk]\n  user_id int [ref: > users.id]\n}`);
  const r = mergeModels(base, incoming);
  assert.deepEqual(r.addedTables, ["orders"]);
  assert.deepEqual(r.skippedTables, ["users"]);
  assert.deepEqual(r.model.tables.find((t) => t.name === "users")!.columns.map((c) => c.name), ["id", "email"], "the existing table is not overwritten");
  assert.equal(r.model.refs.length, 1, "the new table's reference to an existing one comes along");
});

test("merge: references between tables that were already there are not duplicated or invented", () => {
  const base = dbml(`Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int\n}`);
  const incoming = dbml(`Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}\nTable c {\n  id int [pk]\n  b_id int [ref: > b.id]\n  x_id int [ref: > x.id]\n}`);
  const r = mergeModels(base, incoming);
  assert.deepEqual(r.model.refs.map((x) => `${x.from.table}->${x.to.table}`), ["c->b"], "b->a was not in the diagram before; c->x points nowhere");
});

test("merge: enums deduplicated, groups combined, notes and views appended, project name adopted only if missing", () => {
  const base = dbml(`Enum status {\n  open\n}\nTable a {\n  id int [pk]\n}\nTableGroup core {\n  a\n}`);
  const incoming = dbml(`Project shop {\n  database_type: 'PostgreSQL'\n}\nEnum status {\n  closed\n}\nEnum kind {\n  x\n}\nTable b {\n  id int [pk]\n}\nTableGroup core {\n  b\n}\nTableGroup extra {\n  b\n  missing\n}\nNote hello {\n  'hi'\n}`);
  const r = mergeModels(base, incoming);
  assert.deepEqual(r.model.enums.map((e) => [e.name, e.values.map((v) => v.name)]), [["status", ["open"]], ["kind", ["x"]]]);
  assert.deepEqual(r.model.groups.map((g) => [g.name, g.tables]), [["core", ["a", "b"]], ["extra", ["b"]]]);
  assert.equal(r.model.notes.length, 1);
  assert.equal(r.model.project.name, "shop");
  assert.equal(mergeModels(dbml(`Project mine {\n  database_type: 'MySQL'\n}`), incoming).model.project.name, "mine");
});

test("merge: neither input model is modified", () => {
  const base = dbml(`Table a {\n  id int [pk]\n}`);
  const incoming = dbml(`Table b {\n  id int [pk]\n}`);
  const before = JSON.stringify([base, incoming]);
  mergeModels(base, incoming);
  assert.equal(JSON.stringify([base, incoming]), before);
});

// ─── ZIP and CSV export helpers ─────────────────────────────────────────────────────────────────────────────────────

/** reads a stored (uncompressed) ZIP the way an unzip tool does: end record → central directory → local entries */
function readZip(zip: Uint8Array) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, "end-of-central-directory signature");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; crc: number; data: string }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, "central directory signature");
    const crc = dv.getUint32(p + 16, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(localOffset, true), 0x04034b50, "local header signature");
    const dataStart = localOffset + 30 + dv.getUint16(localOffset + 26, true);
    out.push({ name, crc, data: new TextDecoder().decode(zip.subarray(dataStart, dataStart + size)) });
    p += 46 + nameLen;
  }
  return out;
}

test("ZIP: every file can be found and read back, with the standard CRC-32", () => {
  const zip = makeZip([
    { name: "check.txt", content: "123456789" },
    { name: "tables/users.csv", content: "id,name\n1,Zoë\n" },
    { name: "empty.sql", content: new Uint8Array() },
  ]);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ["check.txt", "tables/users.csv", "empty.sql"]);
  assert.equal(files[0].crc, 0xcbf43926, "CRC-32 check value");
  assert.equal(files[1].data, "id,name\n1,Zoë\n");
  assert.equal(files[2].data, "");
});

test("ZIP: an empty archive is just the end record", () => {
  const zip = makeZip([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(readZip(zip), []);
});

test("csvEscape: quotes only when needed, doubling quotes; null and undefined are empty", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvEscape("two\nlines"), '"two\nlines"');
  assert.equal(csvEscape("cr\rhere"), '"cr\rhere"');
  assert.equal(csvEscape(0), "0");
  assert.equal(csvEscape(false), "false");
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
});

// ─── Mermaid export ─────────────────────────────────────────────────────────────────────────────────────────────────

test("Mermaid export: keys, unique markers, notes and one line per reference with the right cardinality", () => {
  const m = modelToMermaid(
    dbml(`
Table billing.invoices {
  id int [pk]
  number varchar(20) [unique, note: 'Shown on "the" PDF']
  account_id int [not null, ref: > accounts.id]
  coupon_id int [ref: - coupons.id]
}
Table accounts {
  id int [pk]
}
Table coupons {
  id int [pk]
}
Table tags {
  id int [pk]
}
Ref: accounts.id <> tags.id
`)
  );
  assert.match(m, /^erDiagram\n/);
  assert.match(m, / {4}billing_invoices \{/);
  assert.match(m, / {8}varchar number UK "Shown on 'the' PDF"/);
  assert.match(m, / {8}int account_id FK/);
  assert.match(m, / {4}accounts \|\|--o\{ billing_invoices : "account_id"/, "a required many-to-one");
  assert.match(m, / {4}accounts }o--o{ tags : "id"/, "many-to-many");
  assert.ok(m.split("\n").some((l) => /coupons .*--.* billing_invoices|billing_invoices .*--.* coupons/.test(l)), "one-to-one is drawn");
});

test("Mermaid export: an empty model is a bare erDiagram", () => {
  assert.equal(modelToMermaid(emptyModel()), "erDiagram\n");
});

// ─── editor and delete requests (window events) ─────────────────────────────────────────────────────────────────────

function withWindow<T>(run: (events: CustomEvent[]) => T): T {
  const g = globalThis as any;
  const target = new EventTarget();
  const events: CustomEvent[] = [];
  const listener = (e: Event) => events.push(e as CustomEvent);
  target.addEventListener(EDITOR_INTENT_EVENT, listener);
  target.addEventListener(DELETE_REQUEST_EVENT, listener);
  const had = "window" in g;
  const prev = g.window;
  g.window = target;
  try {
    return run(events);
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
}

test("intentHref: the URL for each kind of request, safely encoded", () => {
  assert.equal(intentHref({ projectId: "a b/c" }), "/canvas?project=a%20b%2Fc");
  assert.equal(intentHref({ project: { id: "p1" } }), "/canvas?project=p1");
  assert.equal(intentHref({ template: "e-commerce & more" }), "/canvas?template=e-commerce%20%26%20more");
  assert.equal(intentHref({ new: "ai" }), "/canvas?new=ai");
  assert.equal(intentHref({}), "/canvas?new=blank");
  assert.equal(intentHref({ projectId: "p", template: "t" }), "/canvas?project=p", "a project wins over a template");
});

test("requestEditorIntent: sends the intent as a window event", () => {
  withWindow((events) => {
    requestEditorIntent({ new: "import" });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EDITOR_INTENT_EVENT);
    assert.deepEqual(events[0].detail, { new: "import" });
  });
});

test("requestCanvasDelete: remembers where the clicked control was, even after it disappears", () => {
  const g = globalThis as any;
  class FakeElement {
    getBoundingClientRect() {
      return { x: 10, y: 20, width: 30, height: 40 };
    }
  }
  const hadElement = "Element" in g;
  const prevElement = g.Element;
  g.Element = FakeElement;
  try {
    withWindow((events) => {
      const onDone = () => {};
      requestCanvasDelete({ nodeIds: ["t1"], anchor: new FakeElement() as any, onDone });
      requestCanvasDelete({ group: "sales", anchor: { x: 1, y: 2, width: 3, height: 4 } as any });
      requestCanvasDelete({ edgeIds: ["e1"] });
      assert.deepEqual(events.map((e) => e.type), [DELETE_REQUEST_EVENT, DELETE_REQUEST_EVENT, DELETE_REQUEST_EVENT]);
      assert.deepEqual(events[0].detail.anchor, { x: 10, y: 20, width: 30, height: 40 });
      assert.equal(events[0].detail.onDone, onDone);
      assert.deepEqual(events[1].detail, { group: "sales", anchor: { x: 1, y: 2, width: 3, height: 4 } });
      assert.equal(events[2].detail.anchor, undefined);
    });
  } finally {
    if (hadElement) g.Element = prevElement;
    else delete g.Element;
  }
});

// ─── class names, templates and imports onto the canvas ─────────────────────────────────────────────────────────────

test("cn: later Tailwind classes win; falsy values are dropped", () => {
  assert.equal(cn("p-2 text-sm", "p-4"), "text-sm p-4");
  assert.equal(cn("rounded", false, null, undefined, { hidden: false, block: true }), "rounded block");
  assert.equal(cn(), "");
});

// toast.tsx has JSX at module level: Next compiles it with the automatic runtime, tsx with React.createElement
(globalThis as any).React = require("react");

function fakeLayout(api: any) {
  const tabs: any[] = [];
  return { tabs, layout: { getCanvasApi: () => api, addTab: (title: string, content: any) => tabs.push({ title, content }) } as any };
}

test("applyTemplate: a new tab holds the template's tables, already laid out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); // showToast's auto-dismiss
  const { applyTemplate } = await import("../src/components/Tools/applyTemplate");
  const { TEMPLATES } = await import("../src/lib/templates");
  const tpl = TEMPLATES[0];
  const { tabs, layout } = fakeLayout(null);
  applyTemplate(layout, tpl, "merge"); // no open diagram: merging falls back to a new tab
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].title, tpl.name);
  const tables = tabs[0].content.nodes.filter((n: any) => n.type === "tableMode");
  assert.equal(tables.length, parseDbml(tpl.dbml).model.tables.length);
  assert.ok(new Set(tables.map((n: any) => `${n.position.x},${n.position.y}`)).size === tables.length, "every table has its own place");
  assert.match(tabs[0].content.meta.versionKey, /^vk_/);
});

test("applyTemplate: merging into an open diagram goes through the canvas API, keeping the current layout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { applyTemplate } = await import("../src/components/Tools/applyTemplate");
  const { TEMPLATES } = await import("../src/lib/templates");
  const applied: any[] = [];
  const { tabs, layout } = fakeLayout({ applyModel: (model: DiagramModel, opts: any) => applied.push({ model, opts }) });
  applyTemplate(layout, TEMPLATES[0], "merge");
  assert.equal(tabs.length, 0);
  assert.deepEqual(applied[0].opts, { mode: "merge", layout: "keep", fit: true, restorePoint: "Before adding template" });
  assert.ok(applied[0].model.tables.length > 0);
});

test("importModel: new tab, replace (with a restore point) and merge", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { importModel, openModelInNewTab } = await import("../src/components/Tools/helpers");
  const model = dbml(`Table a {\n  id int [pk]\n}\nTable b {\n  id int [pk]\n  a_id int [ref: > a.id]\n}`);
  const applied: any[] = [];
  const api = { applyModel: (m: DiagramModel, opts: any) => applied.push(opts) };
  const { tabs, layout } = fakeLayout(api);
  assert.equal(openModelInNewTab(layout, model, "Imported"), 2);
  importModel(layout, model, "new", "From SQL", "SQL");
  importModel(layout, model, "replace", "x", "Prisma");
  importModel(layout, model, "merge", "x", "Rails");
  assert.deepEqual(tabs.map((x) => x.title), ["Imported", "From SQL"]);
  assert.deepEqual(applied, [
    { mode: "replace", layout: "auto", fit: true, restorePoint: "Before importing Prisma" },
    { mode: "merge", layout: "keep", fit: true, restorePoint: "Before adding tables" },
  ]);
  const { tabs: noApiTabs, layout: noApi } = fakeLayout(null);
  importModel(noApi, model, "replace", "Fallback", "SQL");
  assert.deepEqual(noApiTabs.map((x) => x.title), ["Fallback"], "with no open diagram everything opens in a new tab");
});
