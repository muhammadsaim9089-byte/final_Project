import { test } from "node:test";
import assert from "node:assert/strict";
import type { SqlJsStatic } from "../src/lib/sandbox/engine";
import { catalogToModel, EXTRACTION_GUIDES, type Catalog } from "../src/lib/reverse/catalog";
import { introspect, parseConnectionUrl } from "../src/lib/reverse/live";
import { sqliteBytesToModel } from "../src/lib/reverse/sqlite";

// Reverse engineering: a live database's catalog, a connection URL, or an uploaded SQLite file → DiagramModel.

process.env.RATE_LIMIT_DISABLED = "true";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;

const catalog = (c: Partial<Catalog>): Catalog => ({ tables: [], foreignKeys: [], indexes: [], enums: [], ...c });

// ─── catalog → model ────────────────────────────────────────────────────────────────────────────────────────────────

test("catalog: default schemas are dropped, others kept; MySQL's database name is never a schema", () => {
  const c = catalog({ tables: [{ schema: "public", name: "users", columns: [] }, { schema: "billing", name: "invoices", columns: [] }, { schema: "dbo", name: "logs", columns: [] }] });
  assert.deepEqual(catalogToModel(c).tables.map((t) => [t.schema, t.name]), [[undefined, "users"], ["billing", "invoices"], [undefined, "logs"]]);
  assert.deepEqual(catalogToModel(c, { mysqlDatabase: true }).tables.map((t) => t.schema), [undefined, undefined, undefined]);
});

test("catalog: keys, nullability, auto-increment and comments", () => {
  const m = catalogToModel(
    catalog({
      tables: [
        {
          name: "users",
          comment: "Accounts",
          primaryKey: ["id"],
          columns: [
            { name: "id", type: "bigint", autoIncrement: true, default: "nextval('users_id_seq'::regclass)" },
            { name: "email", type: "varchar(320)", nullable: false, comment: "Login" },
            { name: "nickname", type: "text", nullable: true },
          ],
        },
      ],
    })
  );
  const [id, email, nickname] = m.tables[0].columns;
  assert.deepEqual(id, { name: "id", type: "bigint", pk: true, notNull: true, increment: true }, "an auto-increment key keeps no sequence default");
  assert.deepEqual(email, { name: "email", type: "varchar(320)", notNull: true, note: "Login" });
  assert.deepEqual(nickname, { name: "nickname", type: "text" });
  assert.equal(m.tables[0].note, "Accounts");
});

test("catalog: defaults are classified as number, string (casts and doubled quotes removed), boolean, null or expression", () => {
  const m = catalogToModel(
    catalog({
      tables: [
        {
          name: "t",
          columns: [
            { name: "a", type: "int", default: "-12.5" },
            { name: "b", type: "varchar", default: "'it''s'::character varying" },
            { name: "c", type: "boolean", default: "TRUE" },
            { name: "d", type: "text", default: "NULL" },
            { name: "e", type: "timestamptz", default: "now()" },
            { name: "f", type: "text", default: "" },
            { name: "g", type: "text", default: null },
          ],
        },
      ],
    })
  );
  assert.deepEqual(
    m.tables[0].columns.map((c) => c.default),
    [{ kind: "number", value: "-12.5" }, { kind: "string", value: "it's" }, { kind: "boolean", value: "true" }, { kind: "null", value: "null" }, { kind: "expression", value: "now()" }, undefined, undefined]
  );
});

test("catalog: MySQL enum columns become named enums, with quotes unescaped, and are not duplicated", () => {
  const m = catalogToModel(
    catalog({
      tables: [{ name: "orders", columns: [{ name: "status", type: "enum('new','shipped','can''t ship')" }, { name: "note", type: "text" }] }],
      enums: [{ name: "mood", values: ["happy", "sad"] }],
    })
  );
  assert.equal(m.tables[0].columns[0].type, "orders_status");
  assert.deepEqual(m.enums.map((e) => [e.name, e.values.map((v) => v.name)]), [["mood", ["happy", "sad"]], ["orders_status", ["new", "shipped", "can't ship"]]]);
});

test("catalog: composite keys, single and multi-column uniques, without a redundant unique on the key", () => {
  const m = catalogToModel(
    catalog({
      tables: [
        {
          name: "memberships",
          primaryKey: ["user_id", "team_id"],
          columns: [{ name: "user_id", type: "int", nullable: false }, { name: "team_id", type: "int", nullable: false }, { name: "slug", type: "text" }],
          uniques: [{ columns: ["slug"] }, { name: "uq_pair", columns: ["team_id", "slug"] }],
        },
        { name: "tags", primaryKey: ["id"], columns: [{ name: "id", type: "int" }], uniques: [{ name: "tags_pkey_dup", columns: ["id"] }] },
      ],
    })
  );
  const [memberships, tags] = m.tables;
  assert.deepEqual(memberships.indexes, [{ columns: ["user_id", "team_id"], pk: true }, { columns: ["team_id", "slug"], unique: true, name: "uq_pair" }]);
  assert.equal(memberships.columns[2].unique, true);
  assert.equal(memberships.columns[0].pk, undefined, "composite key columns are not each a key");
  assert.deepEqual(tags.indexes, [], "the key is already unique");
});

test("catalog: indexes — duplicates and ones already covered by a key or unique column are skipped; btree is the default", () => {
  const m = catalogToModel(
    catalog({
      tables: [{ name: "posts", primaryKey: ["id"], columns: [{ name: "id", type: "int" }, { name: "slug", type: "text" }, { name: "body", type: "text" }, { name: "created_at", type: "timestamp" }], uniques: [{ columns: ["slug"] }] }],
      indexes: [
        { table: "posts", name: "posts_pkey", columns: ["id"], unique: true },
        { table: "posts", name: "posts_slug_key", columns: ["slug"], unique: true },
        { table: "posts", name: "idx_created", columns: ["created_at"], type: "BTREE" },
        { table: "posts", name: "idx_created_again", columns: ["created_at"] },
        { table: "posts", name: "idx_body", columns: ["body"], type: "GIN" },
        { table: "missing_table", name: "idx_x", columns: ["x"] },
      ],
    })
  );
  assert.deepEqual(m.tables[0].indexes, [{ columns: ["created_at"], name: "idx_created" }, { columns: ["body"], name: "idx_body", type: "gin" }]);
});

test("catalog: foreign keys — many-to-one by default, one-to-one when the column is the key or unique; actions mapped", () => {
  const m = catalogToModel(
    catalog({
      tables: [
        { name: "users", primaryKey: ["id"], columns: [{ name: "id", type: "int" }] },
        { name: "posts", primaryKey: ["id"], columns: [{ name: "id", type: "int" }, { name: "user_id", type: "int" }] },
        { name: "profiles", primaryKey: ["user_id"], columns: [{ name: "user_id", type: "int" }] },
        { name: "avatars", primaryKey: ["id"], columns: [{ name: "id", type: "int" }, { name: "user_id", type: "int" }], uniques: [{ columns: ["user_id"] }] },
      ],
      foreignKeys: [
        { name: "fk_posts_user", table: "posts", columns: ["user_id"], refTable: "users", refColumns: ["id"], onDelete: "SET_NULL", onUpdate: "NO ACTION" },
        { table: "profiles", columns: ["user_id"], refTable: "users", refColumns: ["id"], onDelete: "CASCADE" },
        { table: "avatars", columns: ["user_id"], refTable: "users", refColumns: ["id"], onDelete: "WHATEVER" },
        { table: "comments", columns: ["post_id"], refTable: "posts", refColumns: ["id"] },
        { table: "posts", columns: ["user_id"], refSchema: "audit", refTable: "people", refColumns: ["id"] },
      ],
    })
  );
  const [posts, profiles, avatars, external] = m.refs;
  assert.deepEqual(posts, { name: "fk_posts_user", from: { schema: undefined, table: "posts", columns: ["user_id"] }, to: { schema: undefined, table: "users", columns: ["id"] }, type: "many-to-one", onDelete: "set null", onUpdate: "no action" });
  assert.equal(profiles.type, "one-to-one");
  assert.deepEqual([profiles.from.table, profiles.to.table, profiles.onDelete], ["users", "profiles", "cascade"]);
  assert.equal(avatars.type, "one-to-one");
  assert.equal(avatars.onDelete, undefined, "an unknown action is dropped");
  assert.equal(m.refs.length, 4, "a key from a table not in the catalog is skipped");
  assert.equal(external.to.table, "people", "a parent outside the catalog keeps its name");
});

test("extraction guides: every database has an id, a label, steps and a script", () => {
  const ids = EXTRACTION_GUIDES.map((g) => g.id);
  assert.ok(ids.includes("postgres") && ids.includes("mysql"));
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const g of EXTRACTION_GUIDES) {
    assert.ok(g.label.length > 0 && g.steps.length > 0 && g.script.length > 0, g.id);
  }
});

// ─── connection URLs ────────────────────────────────────────────────────────────────────────────────────────────────

test("connection URL: PostgreSQL with an encoded password, port and sslmode", () => {
  assert.deepEqual(parseConnectionUrl("postgresql://app%40prod:p%40ss%2Fw%3Ard@db.example.com:6543/shop%20live?sslmode=require"), {
    type: "postgres",
    host: "db.example.com",
    port: 6543,
    user: "app@prod",
    password: "p@ss/w:rd",
    database: "shop live",
    ssl: true,
  });
});

test("connection URL: MySQL and MariaDB, default port, ssl=true, unknown schemes", () => {
  assert.deepEqual(parseConnectionUrl("mysql://root:@localhost/inventory"), { type: "mysql", host: "localhost", port: undefined, user: "root", password: "", database: "inventory", ssl: false });
  assert.equal(parseConnectionUrl("mariadb://u:p@h/db?ssl=true").type, "mysql");
  assert.equal(parseConnectionUrl("mariadb://u:p@h/db?ssl=true").ssl, true);
  assert.equal(parseConnectionUrl("mongodb://u:p@h/db").type, undefined);
  assert.throws(() => parseConnectionUrl("not a url"), TypeError);
});

test("introspect: a host and a database name are required before anything connects", async () => {
  await assert.rejects(introspect({ type: "postgres", user: "u" }), /Host and database name are required/);
  await assert.rejects(introspect({ type: "mysql", url: "mysql://u:p@db.example.com/" }), /Host and database name are required/);
});

// ─── SQLite files ───────────────────────────────────────────────────────────────────────────────────────────────────

test("SQLite import is browser-only: on the server it says so instead of failing obscurely", async () => {
  await assert.rejects(sqliteBytesToModel(new Uint8Array()), /only available in the browser/);
});

test("SQLite import: tables, keys, indexes and sample rows from a real database file", async () => {
  const SQL = await initSqlJs();
  const src = new SQL.Database();
  src.run(`
    CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id) ON DELETE CASCADE, title TEXT, cover BLOB);
    CREATE INDEX idx_books_title ON books(title);
    INSERT INTO authors (name) VALUES ('Ursula'), ('Octavia'), ('Ted');
    INSERT INTO books (author_id, title, cover) VALUES (1, 'The Dispossessed', x'0102'), (2, 'Kindred', NULL);
  `);
  const bytes = (src as unknown as { export(): Uint8Array }).export(); // not in the app's sql.js type
  src.close();
  const g = globalThis as any;
  g.window = { initSqlJs: () => initSqlJs() }; // stands in for the page's sql-wasm.js
  try {
    const r = await sqliteBytesToModel(bytes, { sampleRows: 2 });
    assert.deepEqual(r.model.tables.map((t) => t.name), ["authors", "books"]);
    assert.equal(r.tableCount, 2);
    assert.equal(r.rowsRead, 4, "2 sample rows per table");
    const books = r.model.tables[1];
    assert.deepEqual(books.records!.columns, ["id", "author_id", "title", "cover"]);
    assert.deepEqual(books.records!.rows[1], [2, 2, "Kindred", null]);
    assert.equal(typeof books.records!.rows[0][3], "string", "binary values become text");
    assert.equal(r.model.refs.length, 1);
    assert.deepEqual([r.model.refs[0].from.table, r.model.refs[0].to.table, r.model.refs[0].onDelete], ["books", "authors", "cascade"]);
    assert.ok(books.indexes.some((ix) => ix.columns.join() === "title"));
    const noRows = await sqliteBytesToModel(bytes);
    assert.equal(noRows.rowsRead, 0);
    assert.equal(noRows.model.tables[0].records, undefined);
  } finally {
    delete g.window;
  }
});

// ─── the live-database route's safety switch ────────────────────────────────────────────────────────────────────────

async function callReverse(body: unknown, env: Record<string, string | undefined>) {
  const { POST } = await import("../src/app/api/reverse-engineer/route");
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = env[k];
  }
  try {
    return await POST(new Request("http://localhost/api/reverse-engineer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), undefined);
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = saved[k];
    }
  }
}

test("live connections are refused in production unless explicitly allowed", async () => {
  const res = await callReverse({ type: "postgres", host: "db", database: "x" }, { NODE_ENV: "production", ALLOW_LIVE_DB_CONNECT: undefined });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /disabled on this server/);
});

test("ALLOW_LIVE_DB_CONNECT=false turns live connections off in development too", async () => {
  const res = await callReverse({ type: "postgres", host: "db", database: "x" }, { NODE_ENV: "development", ALLOW_LIVE_DB_CONNECT: "false" });
  assert.equal(res.status, 403);
});

test("an allowed request still needs a supported database type", async () => {
  const res = await callReverse({ type: "oracle", host: "db", database: "x" }, { NODE_ENV: "production", ALLOW_LIVE_DB_CONNECT: "true" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /type must be 'postgres' or 'mysql'/);
});

test("a failed connection answers 502 without echoing the password", async () => {
  const res = await callReverse({ type: "postgres", url: "postgres://admin:Sup3rSecret%21@127.0.0.1:1/shop" }, { NODE_ENV: "development", ALLOW_LIVE_DB_CONNECT: undefined });
  assert.equal(res.status, 502);
  const { error } = await res.json();
  assert.match(error, /^Could not read the database/);
  assert.ok(!error.includes("Sup3rSecret"), error);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});
