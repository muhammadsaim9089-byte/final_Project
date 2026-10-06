import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml } from "../src/lib/dbml/parser";
import { applyAllFixes, applyFix, auditModel, type AuditRule } from "../src/lib/audit";
import type { DiagramModel } from "../src/lib/model/types";

const model = (dbml: string): DiagramModel => {
  const r = parseDbml(dbml);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), [], "fixture parses");
  return r.model;
};
const rules = (m: DiagramModel) => auditModel(m).map((f) => f.rule);
const find = (m: DiagramModel, rule: AuditRule) => auditModel(m).find((f) => f.rule === rule)!;
const table = (m: DiagramModel, name: string) => m.tables.find((t) => t.name === name)!;

const MESSY = `
Table customers {
  id integer [pk, increment]
  name varchar
  email varchar
}
Table orders {
  id integer [pk]
  customer_id varchar(36) [ref: > customers.id]
  customer_email varchar
  customer_name varchar
  total int
}
Table contacts {
  id int [pk]
  phone1 varchar
  phone2 varchar
  phone3 varchar
  address_line_1 varchar
  address_line_2 varchar
}
Table logs {
  message text
}
Table payments {
  id int [pk]
  order_id int
  amount decimal
}
Table profiles {
  id int [pk]
  displayName varchar
  customer_id int [ref: - customers.id]
}
`;

test("finds every kind of issue, most severe first", () => {
  const m = model(MESSY);
  const found = auditModel(m);
  const ids = found.map((f) => f.id);
  assert.ok(ids.includes("no-primary-key:logs"));
  assert.ok(ids.includes("fk-type-mismatch:orders.customer_id"));
  assert.ok(ids.includes("repeating-group:contacts:phone"));
  assert.ok(ids.includes("copied-parent-columns:orders.customer_id"));
  assert.ok(ids.includes("unindexed-foreign-keys"));
  assert.equal(found.filter((f) => f.rule === "unindexed-foreign-keys").length, 1, "one finding for the whole diagram");
  assert.deepEqual(found.find((f) => f.rule === "unindexed-foreign-keys")!.tables, ["orders", "profiles"]);
  assert.ok(ids.includes("undeclared-relationship:payments.order_id"));
  assert.ok(ids.includes("missing-timestamps"));
  assert.ok(ids.includes("mixed-naming"));
  const order = found.map((f) => f.severity);
  assert.deepEqual(order, [...order].sort((a, b) => ["critical", "warning", "suggestion"].indexOf(a) - ["critical", "warning", "suggestion"].indexOf(b)));
  assert.ok(!ids.some((id) => id.includes("address_line")), "address_line_1/_2 is not a repeating group");
});

test("each finding says what it's about, in plain words, and which tables to focus", () => {
  const m = model(MESSY);
  const mismatch = find(m, "fk-type-mismatch");
  assert.equal(mismatch.title, "Type mismatch: orders.customer_id → customers.id");
  assert.match(mismatch.description, /varchar\(36\) but the key it references is integer/);
  assert.deepEqual(mismatch.tables, ["orders", "customers"]);
  assert.equal(mismatch.fixLabel, "Change customer_id to integer");
  const copied = find(m, "copied-parent-columns");
  assert.match(copied.description, /customer_email, customer_name depend on customer_id/);
});

test("fixes: primary key, type, repeating group, copied columns, index, relationship, timestamps, naming", () => {
  const m = model(MESSY);
  const fix = (rule: AuditRule, from = m) => applyFix(from, find(from, rule))!;

  const pk = fix("no-primary-key");
  assert.deepEqual(table(pk.model, "logs").columns[0], { name: "id", type: "integer", pk: true, increment: true, notNull: true });

  const type = fix("fk-type-mismatch");
  assert.equal(table(type.model, "orders").columns.find((c) => c.name === "customer_id")!.type, "integer");

  const group = fix("repeating-group");
  assert.deepEqual(table(group.model, "contacts").columns.map((c) => c.name), ["id", "address_line_1", "address_line_2"]);
  const child = table(group.model, "contact_phones");
  assert.deepEqual(child.columns.map((c) => c.name), ["id", "contact_id", "phone"]);
  assert.ok(group.model.refs.some((r) => r.from.table === "contact_phones" && r.to.table === "contacts" && r.type === "many-to-one"));

  const copied = fix("copied-parent-columns");
  assert.deepEqual(table(copied.model, "orders").columns.map((c) => c.name), ["id", "customer_id", "total"]);

  const idx = fix("unindexed-foreign-keys");
  assert.deepEqual(table(idx.model, "orders").indexes.map((i) => i.columns), [["customer_id"]]);

  const rel = fix("undeclared-relationship");
  assert.ok(rel.model.refs.some((r) => r.from.table === "payments" && r.from.columns[0] === "order_id" && r.to.table === "orders"));

  const ts = fix("missing-timestamps");
  assert.ok(table(ts.model, "orders").columns.some((c) => c.name === "created_at"));

  const naming = fix("mixed-naming");
  assert.ok(table(naming.model, "profiles").columns.some((c) => c.name === "display_name"));

  assert.ok(m.tables.find((t) => t.name === "logs")!.columns.every((c) => c.name !== "id"), "the input model is never modified");
});

test("fixing everything leaves a clean audit, and a fix that no longer applies returns null", () => {
  const m = model(MESSY);
  const all = applyAllFixes(m, auditModel(m));
  assert.ok(all.summaries.length >= 8);
  assert.deepEqual(rules(all.model), [], "nothing left to fix");
  assert.equal(applyFix(all.model, { id: "no-primary-key:logs", rule: "no-primary-key" }), null);
});

test("a tidy schema has no findings", () => {
  const m = model(`
    Table users { id integer [pk, increment]  email varchar [unique]  created_at timestamp }
    Table posts {
      id integer [pk, increment]
      user_id integer [ref: > users.id]
      title varchar
      created_at timestamp
      indexes { user_id }
    }
  `);
  assert.deepEqual(auditModel(m), []);
});

test("link tables need no timestamps, and many-to-many relationships aren't checked as foreign keys", () => {
  const m = model(`
    Table tags { id int [pk]  created_at timestamp }
    Table posts { id int [pk]  created_at timestamp }
    Table post_tags { post_id int [ref: > posts.id]  tag_id int [ref: > tags.id]  indexes { (post_id, tag_id) [pk]  tag_id } }
    Ref: tags.id <> posts.id
  `);
  assert.deepEqual(rules(m), []);
});

test("MySQL / MariaDB index foreign keys by themselves, so that check is skipped there", () => {
  const dbml = (type: string) => `Project p { database_type: '${type}' }
    Table users { id int [pk]  created_at timestamp }
    Table posts { id int [pk]  user_id int [ref: > users.id]  created_at timestamp }`;
  assert.deepEqual(rules(model(dbml("MySQL"))), []);
  assert.deepEqual(rules(model(dbml("PostgreSQL"))), ["unindexed-foreign-keys"]);
});
