import { test } from "node:test";
import assert from "node:assert/strict";
import type { SqlJsStatic } from "../src/lib/sandbox/engine";
import { normalizeTo3NF } from "../src/lib/execution/normalize_schema";
import { validateSchema, type Schema } from "../src/lib/execution/utils/schema_validator";
import { generateTables } from "../src/lib/execution/export_sql";
import { generateMermaid } from "../src/lib/execution/generate_mermaid";
import { analyzeRequirements } from "../src/lib/execution/analyse_requirements";
import { FEW_SHOT_EXAMPLES, SYSTEM_PROMPT } from "../src/lib/execution/prompts";
import { withGroq } from "./support/groqStub";

// The AI generation pipeline behind POST /api/generate: model JSON → validation → 3NF passes → SQL + Mermaid.

// sql.js resolves its own .wasm under Node (same as tests/sandbox.test.ts)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;
let SQL: SqlJsStatic | undefined;
const sqlite = async () => new (SQL ??= await initSqlJs()).Database();

const col = (name: string, dataType = "VARCHAR(255)", extra: Record<string, unknown> = {}) => ({ name, dataType, isPrimaryKey: false, isNullable: true, isUnique: false, ...extra });
const pk = (name = "id", dataType = "INTEGER") => col(name, dataType, { isPrimaryKey: true, isNullable: false, isUnique: true });
const rel = (fromEntity: string, toEntity: string, foreignKey: string, referencedKey = "id", extra: Record<string, unknown> = {}) => ({
  fromEntity,
  toEntity,
  foreignKey,
  referencedKey,
  type: "many-to-one" as const,
  onDelete: "RESTRICT" as const,
  onUpdate: "CASCADE" as const,
  ...extra,
});
const schemaOf = (entities: any[], relationships: any[] = []): Schema => validateSchema({ entities, relationships }).data!;
const names = (s: Schema) => s.entities.map((e) => e.name).sort();
const attrs = (s: Schema, entity: string) => s.entities.find((e) => e.name === entity)!.attributes.map((a) => a.name);

// ─── schema validation (the gate every model reply passes through) ──────────────────────────────────────────────────

test("validateSchema fills defaults for omitted flags, relationships and referential actions", () => {
  const r = validateSchema({ entities: [{ name: "customer", attributes: [{ name: "customer_id", dataType: "INTEGER" }] }] });
  assert.equal(r.isValid, true);
  assert.deepEqual(r.data!.relationships, []);
  assert.deepEqual(r.data!.entities[0].attributes[0], { name: "customer_id", dataType: "INTEGER", isPrimaryKey: false, isNullable: false, isUnique: false });
  const withRel = validateSchema({ entities: [], relationships: [{ fromEntity: "order", toEntity: "customer", type: "many-to-one", foreignKey: "customer_id", referencedKey: "customer_id" }] });
  assert.equal(withRel.data!.relationships[0].onDelete, "RESTRICT");
  assert.equal(withRel.data!.relationships[0].onUpdate, "CASCADE");
});

test("validateSchema accepts numeric and boolean defaults and sizes, as models often send them", () => {
  const r = validateSchema({
    entities: [{ name: "product", attributes: [col("stock_quantity", "INTEGER", { defaultValue: 0 }), col("is_active", "BOOLEAN", { defaultValue: true }), col("sku", "VARCHAR", { size: 64 })] }],
  });
  assert.equal(r.isValid, true, JSON.stringify(r.errors));
  const [stock, active, sku] = r.data!.entities[0].attributes;
  assert.equal(stock.defaultValue, "0");
  assert.equal(active.defaultValue, "true");
  assert.equal(sku.size, "64");
});

test("validateSchema rejects a missing entity list, unknown relationship types and unknown actions", () => {
  assert.equal(validateSchema({}).isValid, false);
  assert.equal(validateSchema(null).isValid, false);
  assert.equal(validateSchema({ entities: "customer" }).isValid, false);
  const badType = { entities: [], relationships: [{ ...rel("order", "customer", "customer_id"), type: "zero-to-many" }] };
  assert.equal(validateSchema(badType).isValid, false);
  const badAction = { entities: [], relationships: [rel("order", "customer", "customer_id", "id", { onDelete: "DROP" })] };
  assert.equal(validateSchema(badAction).isValid, false);
  assert.equal(validateSchema({ entities: [{ name: "x", attributes: [{ name: 42, dataType: "INTEGER" }] }] }).isValid, false);
});

test("validateSchema drops keys it does not know (a reply under a different key loses that data)", () => {
  const r = validateSchema({ entities: [{ name: "customer", attributes: [], color: "red" }], relations: [{ from: "a" }] });
  assert.equal(r.isValid, true);
  assert.equal((r.data!.entities[0] as any).color, undefined);
  assert.deepEqual(r.data!.relationships, []);
});

// ─── 3NF normalisation ──────────────────────────────────────────────────────────────────────────────────────────────

test("normalizeTo3NF leaves an already normalised schema alone and reports it", () => {
  const input = schemaOf([{ name: "customer", attributes: [pk("customer_id"), col("email"), col("status")] }]);
  const r = normalizeTo3NF({ schema: input, options: {} });
  assert.equal(r.issuesFound, 0);
  assert.deepEqual(r.schema, input);
  assert.match(r.report, /Schema was already in 3NF\./);
  assert.match(r.report, /\*\*Start Entities:\*\* 1/);
});

test("normalizeTo3NF handles an empty schema", () => {
  const r = normalizeTo3NF({ schema: schemaOf([]), options: {} });
  assert.deepEqual(r.schema, { entities: [], relationships: [] });
  assert.equal(r.issuesFound, 0);
});

test("normalizeTo3NF does not modify the schema it is given", () => {
  const input = schemaOf([{ name: "post", attributes: [pk(), col("tags")] }]);
  const copy = JSON.parse(JSON.stringify(input));
  normalizeTo3NF({ schema: input, options: {} });
  assert.deepEqual(input, copy);
});

test("1NF: a table without a primary key gets <table>_id", () => {
  const r = normalizeTo3NF({ schema: schemaOf([{ name: "event", attributes: [col("title")] }]), options: {} });
  const ev = r.schema.entities.find((e) => e.name === "event")!;
  assert.deepEqual(ev.attributes[0], { name: "event_id", dataType: "INTEGER", isPrimaryKey: true, isNullable: false, isUnique: true });
  assert.match(r.report, /Injected missing primary key 'event_id' into 'event'/);
});

test("1NF: a list-valued text column becomes a child table linked back to its parent", () => {
  const r = normalizeTo3NF({ schema: schemaOf([{ name: "post", attributes: [pk("post_id"), col("title"), col("tags")] }]), options: {} });
  assert.deepEqual(names(r.schema), ["post", "post_tag"]);
  assert.deepEqual(attrs(r.schema, "post"), ["post_id", "title"]);
  assert.deepEqual(attrs(r.schema, "post_tag"), ["post_tag_id", "post_id", "value"]);
  assert.deepEqual(r.schema.relationships, [{ fromEntity: "post_tag", toEntity: "post", type: "many-to-one", foreignKey: "post_id", referencedKey: "post_id", onDelete: "CASCADE", onUpdate: "CASCADE" }]);
  assert.equal(r.issuesFound, 1);
});

test("1NF: the child table's foreign key is named after the parent when the parent's key is a bare `id`", () => {
  const r = normalizeTo3NF({ schema: schemaOf([{ name: "post", attributes: [pk("id"), col("tags")] }]), options: {} });
  assert.deepEqual(attrs(r.schema, "post_tag"), ["post_tag_id", "post_id", "value"]);
  assert.deepEqual(
    r.schema.relationships.map((x) => [x.foreignKey, x.referencedKey]),
    [["post_id", "id"]]
  );
});

test("1NF: numeric, boolean, date and JSON columns are never treated as lists, whatever their name", () => {
  const input = schemaOf([
    {
      name: "orders",
      attributes: [
        pk(),
        col("total_amount_cents", "BIGINT"),
        col("login_attempts", "INTEGER"),
        col("weight_kgs", "DECIMAL(10,2)"),
        col("settings", "JSONB"),
        col("preferences", "JSON"),
        col("is_paid_in_parts", "BOOLEAN"),
        col("shipped_at_hours", "TIMESTAMP"),
        col("valid_days", "DATE"),
      ],
    },
  ]);
  const r = normalizeTo3NF({ schema: input, options: {} });
  assert.deepEqual(names(r.schema), ["orders"]);
  assert.equal(r.issuesFound, 0);
});

test("1NF: singular words that end in s stay columns", () => {
  const input = schemaOf([{ name: "shipment", attributes: [pk(), col("status"), col("address"), col("business"), col("progress"), col("diagnosis")] }]);
  assert.deepEqual(names(normalizeTo3NF({ schema: input, options: {} }).schema), ["shipment"]);
});

test("2NF: attributes that depend on part of a composite key move to their own table", () => {
  const input = schemaOf([
    {
      name: "enrollment",
      attributes: [pk("student_id"), pk("course_id"), col("course_title"), col("grade")],
    },
  ]);
  const r = normalizeTo3NF({ schema: input, options: {} });
  assert.deepEqual(names(r.schema), ["course", "enrollment"]);
  assert.deepEqual(attrs(r.schema, "course"), ["course_id", "course_title"]);
  assert.deepEqual(attrs(r.schema, "enrollment"), ["student_id", "course_id", "grade"]);
  assert.match(r.report, /\[2NF\] Decomposed partial dependency: moved \[course_title\]/);
});

test("2NF: no duplicate table when the plural form already exists", () => {
  const input = schemaOf([
    { name: "products", attributes: [pk(), col("name")] },
    { name: "categories", attributes: [pk(), col("name")] },
    { name: "order_items", attributes: [pk("order_id"), pk("product_id"), col("product_name"), col("quantity", "INTEGER")] },
    { name: "category_links", attributes: [pk("category_id"), pk("tag_id"), col("category_label")] },
  ]);
  const r = normalizeTo3NF({ schema: input, options: {} });
  assert.deepEqual(names(r.schema), ["categories", "category_links", "order_items", "products"]);
});

test("2NF: tables with a single-column key are untouched", () => {
  const input = schemaOf([{ name: "course", attributes: [pk("course_id"), col("course_title")] }]);
  assert.equal(normalizeTo3NF({ schema: input, options: {} }).issuesFound, 0);
});

test("3NF: zip code → city, state moves to a lookup table referenced by the zip code", () => {
  const input = schemaOf([{ name: "address", attributes: [pk(), col("street"), col("zip_code"), col("city"), col("state")] }]);
  const r = normalizeTo3NF({ schema: input, options: {} });
  assert.deepEqual(attrs(r.schema, "address"), ["id", "street", "zip_code"]);
  assert.deepEqual(attrs(r.schema, "zip_lookup"), ["zip_code", "city", "state"]);
  assert.equal(r.schema.relationships[0].foreignKey, "zip_code");
});

test("3NF strict mode extracts a prefix cluster with its own key; default mode does not", () => {
  const input = schemaOf([{ name: "employee", attributes: [pk(), col("department_id", "INTEGER"), col("department_name"), col("department_budget", "DECIMAL(10,2)")] }]);
  assert.equal(normalizeTo3NF({ schema: input, options: {} }).issuesFound, 0);
  const strict = normalizeTo3NF({ schema: input, options: { strictMode: true } });
  assert.deepEqual(attrs(strict.schema, "department"), ["department_id", "department_name", "department_budget"]);
  assert.deepEqual(attrs(strict.schema, "employee"), ["id", "department_id"]);
});

// ─── SQL export ─────────────────────────────────────────────────────────────────────────────────────────────────────

const shop = () =>
  schemaOf(
    [
      { name: "order", description: "A customer's checkout", attributes: [pk(), col("customer_id", "INTEGER", { isNullable: false }), col("status", "VARCHAR(20)", { isNullable: false, defaultValue: "pending" }), col("placed_at", "TIMESTAMP", { defaultValue: "CURRENT_TIMESTAMP" })] },
      {
        name: "customer",
        description: "People who buy.\nDROP TABLE customer;",
        attributes: [pk(), col("email", "VARCHAR(255)", { isNullable: false, isUnique: true }), col("references", "TEXT"), col("index", "INTEGER", { defaultValue: "0" })],
        seedData: [{ id: 1, email: "o'brien@example.com", references: null, index: 3 }],
        indexes: [{ name: "idx_customer_email_ref", columns: ["email", "references"], type: "BTREE" }],
        constraints: [{ name: "chk_index", expression: '"index" >= 0' }],
      },
    ],
    [rel("order", "customer", "customer_id", "id", { onDelete: "CASCADE" })]
  );

test("SQL (PostgreSQL): parents first, identity keys, constraints, FK indexes and escaped comments", () => {
  const sql = generateTables(shop(), "postgres", { includeDropTables: true });
  assert.ok(sql.indexOf('CREATE TABLE customer') < sql.indexOf('CREATE TABLE "order"'), "the referenced table is created first");
  assert.ok(sql.indexOf('DROP TABLE IF EXISTS "order" CASCADE;') < sql.indexOf("DROP TABLE IF EXISTS customer CASCADE;"), "children are dropped first");
  assert.match(sql, /id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
  assert.match(sql, /email VARCHAR\(255\) NOT NULL UNIQUE/);
  assert.match(sql, /status VARCHAR\(20\) NOT NULL DEFAULT 'pending'/);
  assert.match(sql, /placed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP/);
  assert.match(sql, /CONSTRAINT fk_order_customer_id FOREIGN KEY \(customer_id\) REFERENCES customer\(id\) ON DELETE CASCADE ON UPDATE CASCADE/);
  assert.match(sql, /CREATE INDEX idx_order_customer_id ON "order" \(customer_id\);/);
  assert.match(sql, /COMMENT ON TABLE "order" IS 'A customer''s checkout';/);
  assert.match(sql, /"references" TEXT/);
  assert.match(sql, /INSERT INTO customer \(id, email, "references", "index"\) VALUES \(1, 'o''brien@example.com', NULL, 3\);/);
});

test("SQL: a composite primary key is one table-level constraint, and runs on SQLite", async () => {
  const s = schemaOf([
    { name: "course", attributes: [pk()] },
    { name: "enrollment", attributes: [pk("student_id"), pk("course_id"), col("grade", "VARCHAR(2)")] },
  ], [rel("enrollment", "course", "course_id")]);
  const pg = generateTables(s, "postgres");
  assert.match(pg, /student_id INTEGER NOT NULL,\n {4}course_id INTEGER NOT NULL,/);
  assert.match(pg, /PRIMARY KEY \(student_id, course_id\)/);
  assert.doesNotMatch(pg, /student_id INTEGER[^\n]*PRIMARY KEY/);
  const db = await sqlite();
  db.run(generateTables(s, "sqlite"));
  db.run("INSERT INTO course DEFAULT VALUES; INSERT INTO enrollment (student_id, course_id) VALUES (7, 1);");
  assert.throws(() => db.run("INSERT INTO enrollment (student_id, course_id) VALUES (7, 1);"), /UNIQUE/);
  db.close();
});

test("SQL: function and keyword defaults stay expressions (in parentheses for SQLite); quoted literals stay as given", () => {
  const s = schemaOf([{ name: "session", attributes: [pk("token", "UUID"), col("created_on", "DATE", { defaultValue: "current_date" }), col("expires_at", "TEXT", { defaultValue: "datetime('now', '+1 day')" }), col("label", "TEXT", { defaultValue: "'guest'" }), col("ratio", "REAL", { defaultValue: "-0.5" })] }]);
  const lite = generateTables(s, "sqlite");
  assert.match(lite, /created_on DATE DEFAULT CURRENT_DATE/);
  assert.match(lite, /expires_at TEXT DEFAULT \(datetime\('now', '\+1 day'\)\)/);
  assert.match(lite, /label TEXT DEFAULT 'guest'/);
  assert.match(lite, /ratio REAL DEFAULT -0\.5/);
  assert.match(generateTables(s, "postgres"), /expires_at TEXT DEFAULT datetime\('now', '\+1 day'\)/);
});

test("SQL (PostgreSQL): table groups become schemas; ALTER TABLE mode adds keys after all tables", () => {
  const s = schemaOf([
    { name: "invoice", group: "billing", attributes: [pk(), col("account_id", "INTEGER")] },
    { name: "account", group: "billing", attributes: [pk()] },
  ], [rel("invoice", "account", "account_id")]);
  const sql = generateTables(s, "postgres", { useAlterTable: true });
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS billing;/);
  assert.match(sql, /CREATE TABLE billing\.invoice \(/);
  assert.ok(!/CONSTRAINT fk_invoice_account_id FOREIGN KEY[^\n]*\n\)/.test(sql.split("FOREIGN KEYS")[0]), "no inline key in ALTER mode");
  assert.match(sql, /ALTER TABLE billing\.invoice ADD CONSTRAINT fk_invoice_account_id FOREIGN KEY \(account_id\) REFERENCES billing\.account\(id\)/);
});

test("SQL (MySQL): AUTO_INCREMENT, backtick quoting and table comments", () => {
  const sql = generateTables(shop(), "mysql");
  assert.match(sql, /id INTEGER AUTO_INCREMENT PRIMARY KEY/);
  assert.match(sql, /CREATE TABLE `order` \(/);
  assert.match(sql, /\) COMMENT='A customer''s checkout';/);
  assert.match(sql, /`references` TEXT/);
});

test("SQL (SQLite): the generated script runs on a real SQLite engine and behaves as declared", async () => {
  const sql = generateTables(shop(), "sqlite", { includeDropTables: true });
  const db = await sqlite();
  db.run("PRAGMA foreign_keys = ON;");
  db.run(sql); // must not throw: keys, reserved names, defaults, comments, seed data
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0].values.flat();
  assert.deepEqual(tables, ["customer", "order"], "the newline in a description did not inject SQL");
  db.run(`INSERT INTO "order" (customer_id) VALUES (1)`);
  const [row] = db.exec(`SELECT id, status, placed_at IS NOT NULL FROM "order"`)[0].values;
  assert.deepEqual(row.slice(0, 2), [1, "pending"], "auto-increment key and the text default");
  assert.equal(row[2], 1);
  assert.deepEqual(db.exec("SELECT email FROM customer")[0].values, [["o'brien@example.com"]]);
  assert.throws(() => db.run(`INSERT INTO "order" (customer_id) VALUES (99)`), /FOREIGN KEY/);
  db.close();
});

test("SQL: identifiers that are not plain words are quoted, with embedded quotes doubled", async () => {
  const s = schemaOf([{ name: "line item", attributes: [pk(), col('say "hi"', "TEXT"), col("2fa_code", "TEXT")] }]);
  const sql = generateTables(s, "sqlite");
  assert.match(sql, /CREATE TABLE "line item" \(/);
  assert.match(sql, /"say ""hi""" TEXT/);
  assert.match(sql, /"2fa_code" TEXT/);
  const db = await sqlite();
  db.run(sql);
  db.close();
  assert.match(generateTables(s, "mysql"), /CREATE TABLE `line item` \(/);
});

test("SQL: a reference cycle does not loop forever, and every table is still emitted once", () => {
  const s = schemaOf([
    { name: "employee", attributes: [pk(), col("manager_id", "INTEGER"), col("team_id", "INTEGER")] },
    { name: "team", attributes: [pk(), col("lead_id", "INTEGER")] },
  ], [rel("employee", "employee", "manager_id"), rel("employee", "team", "team_id"), rel("team", "employee", "lead_id")]);
  const sql = generateTables(s, "postgres");
  assert.equal(sql.match(/CREATE TABLE employee \(/g)?.length, 1);
  assert.equal(sql.match(/CREATE TABLE team \(/g)?.length, 1);
});

test("SQL: SERIAL keys keep their own auto-numbering; SQLite booleans and varchars map to its types", () => {
  const s = schemaOf([{ name: "tag", attributes: [pk("id", "SERIAL"), col("label", "VARCHAR"), col("hidden", "BOOLEAN")] }]);
  assert.match(generateTables(s, "postgres"), /id SERIAL PRIMARY KEY/);
  const lite = generateTables(s, "sqlite");
  assert.match(lite, /label TEXT/);
  assert.match(lite, /hidden INTEGER/);
});

// ─── Mermaid ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Mermaid: entities, key markers and one cardinality per relationship type", () => {
  const s = schemaOf(
    [
      { name: "customer", attributes: [pk("customer_id")] },
      { name: "order", attributes: [pk("order_id"), col("customer_id", "INTEGER")] },
    ],
    [
      rel("order", "customer", "customer_id", "customer_id"),
      { ...rel("order", "customer", "customer_id", "customer_id"), type: "one-to-one" },
      { ...rel("order", "customer", "customer_id", "customer_id"), type: "one-to-many" },
      { ...rel("order", "customer", "customer_id", "customer_id"), type: "many-to-many" },
    ]
  );
  const m = generateMermaid(s);
  assert.ok(m.startsWith("erDiagram\n"));
  assert.match(m, /INTEGER customer_id PK\n/);
  assert.match(m, /INTEGER customer_id FK\n/);
  assert.deepEqual(
    m.split("\n").filter((l) => l.includes(" : ")).map((l) => l.trim().split(" ")[1]),
    ["}o--||", "||--||", "||--o{", "}o--o{"]
  );
});

test("Mermaid: a column that is both key and foreign key lists both, comma-separated", () => {
  const s = schemaOf([{ name: "profile", attributes: [pk("user_id")] }, { name: "user", attributes: [pk("user_id")] }], [{ ...rel("profile", "user", "user_id", "user_id"), type: "one-to-one" }]);
  assert.match(generateMermaid(s), /INTEGER user_id PK,FK\n/);
});

test("Mermaid: every attribute type and name is a token Mermaid's ER grammar accepts", () => {
  const s = schemaOf([{ name: "line-item", attributes: [pk(), col("price", "DECIMAL(10,2)"), col("title", "VARCHAR(255)"), col("unit price", "DOUBLE PRECISION")] }]);
  const m = generateMermaid(s);
  const token = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const lines = m.split("\n").slice(1).map((l) => l.trim()).filter((l) => l && l !== "}");
  const [entityLine, ...attrLines] = lines;
  assert.match(entityLine.replace(/ \{$/, ""), token);
  for (const l of attrLines) {
    const [type, name] = l.split(/\s+/);
    assert.match(type, token, `type in "${l}"`);
    assert.match(name, token, `name in "${l}"`);
  }
});

// ─── the prompt's own example ───────────────────────────────────────────────────────────────────────────────────────

test("every few-shot example is valid JSON that passes validation and only references what it defines", () => {
  assert.ok(FEW_SHOT_EXAMPLES.length >= 1);
  assert.match(SYSTEM_PROMPT, /JSON only/);
  for (const ex of FEW_SHOT_EXAMPLES) {
    const json = JSON.parse(ex.slice(ex.indexOf("{")));
    const r = validateSchema(json);
    assert.equal(r.isValid, true, JSON.stringify(r.errors));
    for (const e of r.data!.entities) assert.equal(e.attributes.filter((a) => a.isPrimaryKey).length, 1, `${e.name} has exactly one key`);
    for (const x of r.data!.relationships) {
      const from = r.data!.entities.find((e) => e.name === x.fromEntity);
      const to = r.data!.entities.find((e) => e.name === x.toEntity);
      assert.ok(from?.attributes.some((a) => a.name === x.foreignKey), `${x.fromEntity}.${x.foreignKey}`);
      assert.ok(to?.attributes.some((a) => a.name === x.referencedKey && a.isPrimaryKey), `${x.toEntity}.${x.referencedKey}`);
    }
  }
});

// ─── the Groq call (HTTP stubbed: no network, no cost) ──────────────────────────────────────────────────────────────

const library = JSON.stringify({
  entities: [
    { name: "book", attributes: [{ name: "book_id", dataType: "INTEGER", isPrimaryKey: true, isNullable: false, isUnique: true }] },
    { name: "loan", attributes: [{ name: "loan_id", dataType: "INTEGER", isPrimaryKey: true }, { name: "book_id", dataType: "INTEGER" }] },
  ],
  relationships: [{ fromEntity: "loan", toEntity: "book", type: "many-to-one", foreignKey: "book_id", referencedKey: "book_id" }],
});

test("analyzeRequirements without an API key fails with a message naming the variable", async () => {
  const realKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    await assert.rejects(analyzeRequirements({ userRequirements: "a library", systemPrompt: "s" }), /GROQ_API_KEY is not set/);
  } finally {
    if (realKey !== undefined) process.env.GROQ_API_KEY = realKey;
  }
});

test("analyzeRequirements sends the prompt, examples and request, and returns the validated schema", async () => {
  await withGroq({ content: library }, async (sent) => {
    const out = await analyzeRequirements({ userRequirements: "Books and the loans of them", systemPrompt: "SYSTEM", fewShotExamples: ["EX1", "EX2"] });
    assert.deepEqual(out.entities.map((e: any) => e.name), ["book", "loan"]);
    assert.equal(out.relationships[0].onDelete, "RESTRICT", "defaults applied");
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /\/chat\/completions$/);
    const b = sent[0].body;
    assert.equal(b.model, "openai/gpt-oss-120b");
    assert.equal(b.temperature, 0.1);
    assert.deepEqual(b.response_format, { type: "json_object" });
    assert.deepEqual(
      b.messages.map((m: any) => [m.role, m.content]),
      [
        ["system", "SYSTEM"],
        ["system", "Example 1:\nEX1"],
        ["system", "Example 2:\nEX2"],
        ["user", "User Requirements:\nBooks and the loans of them\n\nReturn the structured JSON schema now:"],
      ]
    );
  });
});

test("analyzeRequirements in edit mode sends the current schema and asks for the whole updated schema", async () => {
  await withGroq({ content: library }, async (sent) => {
    await analyzeRequirements({ userRequirements: "add authors", systemPrompt: "SYSTEM", existingSchema: { entities: [] } });
    const msgs = sent[0].body.messages;
    assert.equal(msgs[1].content, 'CRITICAL CONTEXT - CURRENT SCHEMA INSTANCE:\n{"entities":[]}');
    assert.match(msgs[2].content, /return the entirely updated JSON schema/);
    assert.equal(msgs[3].content, "Modification Request:\nadd authors\n\nReturn the fully updated JSON schema now:");
  });
});

test("analyzeRequirements honours an explicit model and temperature, including temperature 0", async () => {
  await withGroq({ content: library }, async (sent) => {
    await analyzeRequirements({ userRequirements: "x", systemPrompt: "s", model: "llama-3.3-70b-versatile", temperature: 0 });
    assert.equal(sent[0].body.model, "llama-3.3-70b-versatile");
    assert.equal(sent[0].body.temperature, 0);
  });
});

test("analyzeRequirements rejects a reply that is not JSON, or JSON that is not a schema", async () => {
  await withGroq({ content: "Sure! Here is your schema:" }, async () => {
    await assert.rejects(analyzeRequirements({ userRequirements: "x", systemPrompt: "s" }), /did not return parseable JSON/);
  });
  await withGroq({ content: JSON.stringify({ tables: [] }) }, async () => {
    await assert.rejects(analyzeRequirements({ userRequirements: "x", systemPrompt: "s" }), /invalid database structure/);
  });
});

test("analyzeRequirements passes Groq's rate-limit error through with its status (for the busy response)", async () => {
  await withGroq({ status: 429, headers: { "retry-after": "7" } }, async (sent) => {
    await assert.rejects(analyzeRequirements({ userRequirements: "x", systemPrompt: "s" }), (e: any) => e.status === 429);
    assert.equal(sent.length, 1, "no retries when Groq says not to");
  });
});

test(
  "analyzeRequirements rejects a reply cut off at the token limit instead of passing on a partial schema",
  { todo: "needs an output budget sized to the Groq plan (max_completion_tokens) — see the master prompt review" },
  async () => {
    await withGroq({ content: library, finish: "length" }, async () => {
      await assert.rejects(analyzeRequirements({ userRequirements: "x", systemPrompt: "s" }), /cut off|token limit|length/i);
    });
  }
);
