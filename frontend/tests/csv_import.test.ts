import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_SAMPLE_ROWS, detectDelimiter, inferColumnType, parseCsv, parseCsvTables, toIdentifier } from "../src/lib/import/csv";
import { detectFormat, importText } from "../src/lib/import";
import { modelToDbml } from "../src/lib/dbml/serializer";
import { parseDbml } from "../src/lib/dbml/parser";
import { buildDatabase, type SqlJsStatic } from "../src/lib/sandbox/engine";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js") as () => Promise<SqlJsStatic>;

test("parseCsv handles quotes, escaped quotes, line breaks in fields, CRLF, a BOM and blank lines", () => {
  const rows = parseCsv('﻿name,quote\r\n"Smith, Alice","She said ""hi""\r\nand left"\r\n\r\nBob,plain\r\n');
  assert.deepEqual(rows, [
    ["name", "quote"],
    ["Smith, Alice", 'She said "hi"\r\nand left'],
    ["Bob", "plain"],
  ]);
  assert.deepEqual(parseCsv("a;b\n1;2", ";"), [["a", "b"], ["1", "2"]]);
});

test("detectDelimiter picks the separator that splits every line the same way", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2,5;3\n4;5;6"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2"), "\t");
  assert.equal(detectDelimiter('a,b\n"x;y",2'), ",");
  assert.equal(detectDelimiter("a|b|c\n1|2|3"), "|");
});

test("inferColumnType finds the narrowest type the values fit", () => {
  assert.equal(inferColumnType(["1", "42", ""]).type, "integer");
  assert.equal(inferColumnType(["1", "9000000000"]).type, "bigint");
  assert.equal(inferColumnType(["19.99", "5", "1200.5"]).type, "decimal(10,2)");
  assert.equal(inferColumnType(["true", "FALSE", "yes"]).type, "boolean");
  assert.equal(inferColumnType(["2024-01-31", "2023-12-01"]).type, "date");
  assert.equal(inferColumnType(["2024-01-31 10:15:00", "2024-02-01T08:00:00Z", "2024-02-02"]).type, "timestamp");
  assert.equal(inferColumnType(["08:30", "17:45:10"]).type, "time");
  assert.equal(inferColumnType(["3f2504e0-4f89-11d3-9a0c-0305e82c3301"]).type, "uuid");
  assert.equal(inferColumnType(['{"a":1}', "[1,2]"]).type, "json");
  assert.equal(inferColumnType(["00123", "04567"]).type, "varchar(50)", "leading zeros (zip codes) stay text");
  assert.equal(inferColumnType(["x".repeat(80)]).type, "varchar(100)");
  assert.equal(inferColumnType(["x".repeat(300)]).type, "text");
  assert.equal(inferColumnType(["", " "]).type, "varchar(255)");
  assert.equal(inferColumnType(["1.5e3", "2"]).type, "double");
});

test("toIdentifier makes snake_case identifiers", () => {
  assert.equal(toIdentifier("Full Name"), "full_name");
  assert.equal(toIdentifier("orderId"), "order_id");
  assert.equal(toIdentifier("Prénom"), "prenom");
  assert.equal(toIdentifier("Price ($)"), "price");
  assert.equal(toIdentifier("2021 Sales"), "col_2021_sales");
});

const TWO_FILES = `-- table: Customers
id,Email,Full Name,Signed Up
1,alice@example.com,Alice Smith,2024-01-05
2,bob@example.com,Bob Johnson,2024-02-11

-- table: orders
id,customer_id,total,paid
10,1,59.90,true
11,2,12.5,false
12,1,7,true
`;

test("parseCsvTables: one table per block, primary keys, relationships between the files, typed sample rows", () => {
  const { model, warnings } = parseCsvTables(TWO_FILES);
  assert.deepEqual(warnings, []);
  assert.deepEqual(model.tables.map((t) => t.name), ["customers", "orders"]);
  const customers = model.tables[0];
  assert.deepEqual(customers.columns.map((c) => `${c.name}:${c.type}${c.pk ? ":pk" : ""}`), ["id:integer:pk", "email:varchar(50)", "full_name:varchar(50)", "signed_up:date"]);
  assert.equal(customers.columns[0].increment, true);
  const orders = model.tables[1];
  assert.equal(orders.columns.find((c) => c.name === "total")!.type, "decimal(10,2)");
  assert.equal(orders.columns.find((c) => c.name === "paid")!.type, "boolean");
  assert.deepEqual(model.refs, [{ from: { table: "orders", columns: ["customer_id"] }, to: { table: "customers", columns: ["id"] }, type: "many-to-one" }]);
  assert.deepEqual(orders.records!.rows[0], [10, 1, 59.9, true]);
  assert.deepEqual(customers.records!.rows[1], [2, "bob@example.com", "Bob Johnson", "2024-02-11"]);
});

test("parseCsvTables reports what it had to guess", () => {
  const many = ["code,label", ...Array.from({ length: CSV_SAMPLE_ROWS + 5 }, (_, i) => `C${i},Item ${i}`)].join("\n");
  const r = parseCsvTables(many, { defaultName: "Product Codes.csv" });
  assert.equal(r.model.tables[0].name, "product_codes");
  assert.equal(r.model.tables[0].records!.rows.length, CSV_SAMPLE_ROWS);
  assert.ok(r.warnings.some((w) => /no id column/.test(w)));
  assert.ok(r.warnings.some((w) => /kept the first 100 of 105 rows/.test(w)));
  const ragged = parseCsvTables("a,a,b\n1,2\n3,4,5,6", { defaultName: "t" });
  assert.deepEqual(ragged.model.tables[0].columns.map((c) => c.name), ["a", "a_2", "b"]);
  assert.ok(ragged.warnings.some((w) => /2 rows have a different number of fields/.test(w)));
});

test("CSV is auto-detected, named after the file, and survives a DBML round trip", () => {
  assert.equal(detectFormat("", "people.csv"), "csv");
  assert.equal(detectFormat("name,age\nAlice,30\nBob,41"), "csv");
  assert.equal(detectFormat("CREATE TABLE t (a int);"), "sql");
  const r = importText("name,age\nAlice,30\nBob,41", "auto", { filename: "Team Members.csv" });
  assert.equal(r.format, "csv");
  assert.deepEqual(r.errors, []);
  assert.equal(r.model.tables[0].name, "team_members");
  const back = parseDbml(modelToDbml(parseCsvTables(TWO_FILES).model));
  assert.ok(back.ok, JSON.stringify(back.diagnostics));
  assert.equal(back.model.tables.find((t) => t.name === "orders")!.records!.rows.length, 3);
  assert.equal(back.model.refs.length, 1);
});

test("imported CSV data is queryable in the SQL playground", async () => {
  const { db } = buildDatabase(await initSqlJs(), parseCsvTables(TWO_FILES).model);
  const total = db.exec("SELECT c.full_name, SUM(o.total) FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.full_name ORDER BY c.full_name")[0].values;
  assert.deepEqual(total, [["Alice Smith", 66.9], ["Bob Johnson", 12.5]]);
  db.close();
});
