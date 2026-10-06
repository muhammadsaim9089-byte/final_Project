import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml } from "../src/lib/dbml/parser";
import { buildDatabase, databaseSignature, playgroundTables, runSql, splitSqlStatements, type SqlJsDatabase, type SqlJsStatic } from "../src/lib/sandbox/engine";

// sql.js resolves its own .wasm under Node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;
let SQL: SqlJsStatic | undefined;
const engine = async () => (SQL ??= await initSqlJs());

const SHOP = `
Enum order_status { pending paid shipped }
Table customers {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  full_name varchar(150) [not null]
}
Table orders {
  id integer [pk, increment]
  customer_id integer [not null, ref: > customers.id]
  status order_status [not null]
  total decimal(10,2)
}
Table core.products {
  id integer [pk]
  name varchar
}
Table tags {
  id integer [pk]
  label varchar
}
Ref: core.products.id <> tags.id
Table order_items {
  order_id integer [ref: > orders.id]
  product_id integer [ref: > core.products.id]
  quantity integer
  indexes {
    (order_id, product_id) [pk]
  }
}
Table categories {
  id integer [pk]
  parent_id integer [ref: > categories.id]
  name varchar
}
Table countries {
  code char(2) [pk]
  name varchar
  records (code, name) {
    'US', 'United States'
    'GB', 'United Kingdom'
  }
}
`;

function shop() {
  const parsed = parseDbml(SHOP);
  assert.ok(parsed.ok, JSON.stringify((parsed as any).diagnostics));
  return parsed.model;
}

const scalar = (db: SqlJsDatabase, sql: string) => db.exec(sql)[0]?.values[0]?.[0];

test("splitSqlStatements splits on top-level semicolons only", () => {
  assert.deepEqual(splitSqlStatements(`SELECT 'a;b'; -- c;\nSELECT "x;" /* ; */ ;\n\n`), ["SELECT 'a;b'", 'SELECT "x;"']);
  assert.deepEqual(splitSqlStatements("  ;; "), []);
});

test("playground schema mirrors the SQLite export: schemas flattened, junction tables, refs, enums", () => {
  const tables = playgroundTables(shop());
  const by = (label: string) => tables.find((t) => t.label === label)!;
  assert.equal(by("core.products").sqlName, "core_products");
  const junction = tables.find((t) => t.junction);
  assert.ok(junction, "many-to-many adds a junction table");
  assert.equal(junction!.sqlName, "core_products_tags");
  assert.deepEqual(by("orders").columns.find((c) => c.name === "customer_id")!.ref, { table: "customers", column: "id" });
  const email = by("customers").columns.find((c) => c.name === "email")!;
  assert.ok(email.unique && email.notNull);
  assert.deepEqual(by("orders").columns.find((c) => c.name === "status")!.enumValues, ["pending", "paid", "shipped"]);
  assert.ok(by("order_items").columns.every((c) => c.name === "quantity" || c.pk), "composite key from the pk index");
  assert.deepEqual(
    tables.map((t) => t.label),
    [...tables.map((t) => t.label)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
  );
});

test("buildDatabase creates every table with consistent sample rows", async () => {
  const { db, report } = buildDatabase(await engine(), shop());
  assert.deepEqual(report.issues, []);
  assert.equal(report.tables, 8);
  assert.equal(scalar(db, "SELECT COUNT(*) FROM customers"), 5);
  assert.equal(scalar(db, "SELECT COUNT(*) FROM countries"), 2, "the diagram's own records win over generated rows");
  assert.equal(scalar(db, "SELECT COUNT(DISTINCT email) FROM customers"), 5, "unique columns never repeat");
  assert.equal(scalar(db, "SELECT COUNT(*) FROM orders o JOIN customers c ON c.id = o.customer_id"), 5, "foreign keys point at real parents");
  assert.equal(scalar(db, "SELECT COUNT(*) FROM order_items i JOIN orders o ON o.id = i.order_id JOIN core_products p ON p.id = i.product_id"), 5);
  assert.equal(scalar(db, "SELECT COUNT(*) FROM core_products_tags j JOIN tags t ON t.id = j.tags_id"), 5);
  const statuses = db.exec("SELECT DISTINCT status FROM orders")[0].values.map((r) => r[0]);
  assert.ok(statuses.every((s) => ["pending", "paid", "shipped"].includes(String(s))), "enum columns get enum values");
  assert.equal(scalar(db, "SELECT COUNT(*) FROM categories WHERE parent_id IS NULL"), 1, "a self reference starts from a root row");
  assert.equal(scalar(db, "SELECT COUNT(*) FROM categories c JOIN categories p ON p.id = c.parent_id"), 4);
  db.close();
});

test("constraints designed in the diagram are enforced once the database is built", async () => {
  const { db } = buildDatabase(await engine(), shop());
  const bad = runSql(db, "INSERT INTO orders (customer_id, status) VALUES (1, 'lost');");
  assert.match(bad.error!.message, /CHECK constraint failed/);
  const dup = runSql(db, "INSERT INTO customers (email, full_name) VALUES ((SELECT email FROM customers LIMIT 1), 'Dup');");
  assert.match(dup.error!.message, /UNIQUE constraint failed/);
  const orphan = runSql(db, "INSERT INTO orders (customer_id, status) VALUES (999, 'paid');");
  assert.match(orphan.error!.message, /FOREIGN KEY constraint failed/, "relationships are enforced");
  const referenced = runSql(db, "DELETE FROM customers WHERE id = 1;");
  assert.match(referenced.error!.message, /FOREIGN KEY constraint failed/);
  db.close();
});

test("referential actions designed on a relationship run in the playground", async () => {
  const model = shop();
  model.refs.find((r) => r.from.table === "orders" && r.to.table === "customers")!.onDelete = "cascade";
  const { db } = buildDatabase(await engine(), model);
  const before = Number(scalar(db, "SELECT COUNT(*) FROM orders WHERE customer_id = 1"));
  assert.ok(before > 0);
  // order_items still points at those orders (no cascade there), so clear them first
  const r = runSql(db, "DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id = 1);\nDELETE FROM customers WHERE id = 1;");
  assert.equal(r.error, undefined);
  assert.equal(scalar(db, "SELECT COUNT(*) FROM orders WHERE customer_id = 1"), 0, "ON DELETE CASCADE removed the customer's orders");
  db.close();
});

test("a table whose DDL SQLite rejects is still created, without the constraint, and reported", async () => {
  const model = shop();
  model.tables.find((t) => t.name === "tags")!.columns[1].checks = ["label ~* '^[a-z]+$'"]; // a PostgreSQL-only operator
  const { db, report } = buildDatabase(await engine(), model);
  assert.equal(scalar(db, "SELECT COUNT(*) FROM tags"), 5);
  assert.equal(report.issues.length, 1);
  assert.match(report.issues[0], /^tags: created without its constraints/);
  db.close();
});

test("runSql returns every result set and counts affected rows", async () => {
  const { db } = buildDatabase(await engine(), shop());
  const two = runSql(db, "SELECT 1 AS a; SELECT 2 AS b, 3 AS c;");
  assert.equal(two.statements, 2);
  assert.deepEqual(two.resultSets.map((r) => r.columns), [["a"], ["b", "c"]]);
  assert.deepEqual(two.resultSets[1].rows, [[2, 3]]);
  const dml = runSql(db, "INSERT INTO tags (id, label) VALUES (100, 'x');\nUPDATE tags SET label = 'y' WHERE id >= 100;\nCREATE TABLE scratch (x);");
  assert.equal(dml.error, undefined);
  assert.equal(dml.statements, 3);
  assert.equal(dml.rowsAffected, 2);
  assert.equal(dml.resultSets.length, 0);
  assert.equal(runSql(db, "-- nothing to run\n").statements, 0);
  db.close();
});

test("runSql pinpoints the statement that failed — syntax and runtime errors, with an offset", async () => {
  const { db } = buildDatabase(await engine(), shop());
  const sql = "SELECT 1;\n  SELEC * FROM customers;\nSELECT 2;";
  const syntax = runSql(db, sql);
  assert.equal(syntax.resultSets.length, 1, "statements before the error still ran");
  assert.equal(syntax.error!.statementIndex, 1);
  assert.equal(sql.slice(syntax.error!.from, syntax.error!.to), "SELEC * FROM customers");

  const dup = "SELECT 1;\nINSERT INTO customers (id, email, full_name) VALUES (1, 'x@y.z', 'X');";
  const runtime = runSql(db, dup);
  assert.match(runtime.error!.message, /UNIQUE constraint failed|PRIMARY KEY/);
  assert.equal(dup.slice(runtime.error!.from, runtime.error!.to), "INSERT INTO customers (id, email, full_name) VALUES (1, 'x@y.z', 'X')");

  const shifted = runSql(db, "SELEC 1", { offset: 10 });
  assert.deepEqual([shifted.error!.from, shifted.error!.to], [10, 17]);
  db.close();
});

test("runSql caps what it keeps and stops runaway queries", async () => {
  const { db } = buildDatabase(await engine(), shop());
  const r = runSql(db, "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT x FROM c;", { maxRows: 10, maxScanRows: 1000 });
  assert.equal(r.resultSets[0].rows.length, 10);
  assert.equal(r.resultSets[0].totalRows, 1000);
  assert.ok(r.resultSets[0].truncated);
  assert.match(r.notice!, /Stopped reading after 1,000 rows/);
  db.close();
});

test("databaseSignature ignores layout and cosmetics but not structure or sample data", () => {
  const a = shop();
  const moved = shop();
  moved.tables[0].x = 999;
  moved.tables[0].headerColor = "#ff0000";
  assert.equal(databaseSignature(a), databaseSignature(moved));
  const extra = shop();
  extra.tables[0].columns.push({ name: "phone", type: "varchar" });
  assert.notEqual(databaseSignature(a), databaseSignature(extra));
  const reseeded = shop();
  reseeded.tables.find((t) => t.name === "countries")!.records!.rows.push(["FR", "France"]);
  assert.notEqual(databaseSignature(a), databaseSignature(reseeded));
});
