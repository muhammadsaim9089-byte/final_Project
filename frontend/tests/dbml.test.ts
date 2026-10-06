import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToDbml, formatDbmlText } from "../src/lib/dbml/serializer";

const DOC_EXAMPLE = `
Project ecommerce {
  database_type: 'PostgreSQL'
  Note: 'Description of the project'
}

enum job_status {
  created [note: 'Waiting to be processed']
  running
  done
  failure
}

enum grade {
  "A+"
  "A"
  "Not Yet Set"
}

TablePartial base_template [headerColor: #ff0000] {
  id int [pk, not null]
  created_at timestamp [default: \`now()\`]
  updated_at timestamp [default: \`now()\`]
}

TablePartial soft_delete_template {
  delete_status boolean [not null]
  deleted_at timestamp [default: \`now()\`]
}

Table users as U [headercolor: #d35400] {
  ~base_template
  username varchar(255) [not null, unique]
  full_name varchar(255) [not null, note: 'to include unit number']
  gender varchar(1) [not null]
  source varchar(255) [default: 'direct']
  rating integer [default: 10, check: \`rating > 0\`]
  balance decimal(10,2) [default: -1.5]
  status job_status
  ~soft_delete_template
  Note: 'User accounts'
}

Table ecommerce.order_items {
  id integer [pk, increment]
  order_id integer [ref: > core.orders.id]
  product_id integer [ref: >? products.id]
  qty int

  indexes {
    (order_id, product_id) [unique, name: 'uniq_line']
    qty [type: hash]
    (\`qty*2\`)
  }

  checks {
    \`qty > 0\` [name: 'chk_qty']
  }
}

Table core.orders {
  id integer [pk]
  user_id integer
  records (id, user_id) {
    1, 10
    2, 11
  }
}

Table products { id integer [pk] name "double precision" }

Table merchants { id int country_code varchar }
Table merchant_periods { merchant_id int country_code varchar }

Ref: users.id < ecommerce.order_items.order_id [delete: cascade, update: no action, color: #aabbcc]
Ref named_ref { U.id - core.orders.user_id }
Ref: merchant_periods.(merchant_id, country_code) > merchants.(id, country_code)
Ref: products.id <> users.id

TableGroup "User Wishlist System" [color: #1E69FD] {
  users
  core.orders
  Note: '''
    This group manages the user wishlist.
    - wishlists: stores lists.
  '''
}

Note todoNote {
'''
TODO 1: add rating
'''
}

Records products(id, name) {
  1, 'Anvil'
  2, 'It''s a "thing"'
  3, null
}

Dep: users -> core.orders [note: 'Aggregates users']
Dep monthly {
  users.id -> core.orders.user_id
  users.username -> core.orders.id
  note: 'Sums things'
  color: #ff00ff
}

DiagramView "Sales Team" {
  Tables { users core.orders }
  TableGroups { "User Wishlist System" }
}
DiagramView Default { Tables { * } }
`;

test("parses the dbdiagram doc example without errors", () => {
  const { model, diagnostics, ok } = parseDbml(DOC_EXAMPLE);
  assert.deepEqual(
    diagnostics.filter((d) => d.severity === "error"),
    [],
    JSON.stringify(diagnostics)
  );
  assert.ok(ok);
  assert.equal(model.project.name, "ecommerce");
  assert.equal(model.project.databaseType, "PostgreSQL");
  assert.equal(model.enums.length, 2);
  assert.equal(model.enums[0].values[0].note, "Waiting to be processed");
  assert.equal(model.enums[1].values[0].name, "A+");
});

test("table partial injection with conflict resolution", () => {
  const { model } = parseDbml(DOC_EXAMPLE);
  const users = model.tables.find((t) => t.name === "users")!;
  assert.equal(users.alias, "U");
  assert.equal(users.headerColor, "#d35400"); // local wins over partial's #ff0000
  const names = users.columns.map((c) => c.name);
  assert.deepEqual(names, ["id", "created_at", "updated_at", "username", "full_name", "gender", "source", "rating", "balance", "status", "delete_status", "deleted_at"]);
  assert.equal(users.columns[0].pk, true);
  assert.equal(users.columns[1].default?.kind, "expression");
  assert.equal(users.columns[1].default?.value, "now()");
  assert.equal(users.columns.find((c) => c.name === "balance")!.default?.value, "-1.5");
  assert.equal(users.columns.find((c) => c.name === "rating")!.checks?.[0], "rating > 0");
  assert.equal(users.note, "User accounts");
});

test("columns, indexes, checks, schema-qualified names", () => {
  const { model } = parseDbml(DOC_EXAMPLE);
  const oi = model.tables.find((t) => t.name === "order_items")!;
  assert.equal(oi.schema, "ecommerce");
  assert.equal(oi.indexes.length, 3);
  assert.deepEqual(oi.indexes[0], { columns: ["order_id", "product_id"], unique: true, name: "uniq_line" });
  assert.equal(oi.indexes[1].type, "hash");
  assert.equal(oi.indexes[2].columns[0], "`qty*2`");
  assert.equal(oi.checks[0].name, "chk_qty");
  assert.equal(model.tables.find((t) => t.name === "products")!.columns[1].type, "double precision");
});

test("relationships: inline, optional, composite, alias, settings", () => {
  const { model } = parseDbml(DOC_EXAMPLE);
  const inline = model.refs.filter((r) => r.from.table === "order_items");
  assert.equal(inline.length, 2);
  assert.equal(inline[0].type, "many-to-one");
  assert.equal(inline[0].to.schema, "core");
  const optional = inline.find((r) => r.to.table === "products")!;
  assert.equal(optional.toOptional, true);
  const explicit = model.refs.find((r) => r.type === "one-to-many")!;
  assert.equal(explicit.onDelete, "cascade");
  assert.equal(explicit.onUpdate, "no action");
  assert.equal(explicit.color, "#aabbcc");
  const aliased = model.refs.find((r) => r.name === "named_ref")!;
  assert.equal(aliased.from.table, "users"); // alias U resolved
  assert.equal(aliased.type, "one-to-one");
  const composite = model.refs.find((r) => r.from.columns.length === 2)!;
  assert.deepEqual(composite.to.columns, ["id", "country_code"]);
  assert.equal(model.refs.find((r) => r.type === "many-to-many")!.from.table, "products");
});

test("table groups, notes, records, deps, views", () => {
  const { model } = parseDbml(DOC_EXAMPLE);
  const g = model.groups[0];
  assert.equal(g.name, "User Wishlist System");
  assert.equal(g.color, "#1E69FD");
  assert.deepEqual(g.tables, ["users", "core.orders"]);
  assert.match(g.note!, /wishlist/);
  assert.equal(model.notes[0].name, "todoNote");
  assert.equal(model.notes[0].text, "TODO 1: add rating");
  const products = model.tables.find((t) => t.name === "products")!;
  assert.deepEqual(products.records?.rows, [[1, "Anvil"], [2, `It's a "thing"`], [3, null]]);
  const orders = model.tables.find((t) => t.name === "orders")!;
  assert.deepEqual(orders.records?.rows, [[1, 10], [2, 11]]);
  assert.equal(model.deps.length, 3);
  assert.equal(model.deps[0].note, "Aggregates users");
  assert.equal(model.deps[0].from.table, "users");
  assert.equal(model.deps[1].from.column, "id");
  assert.equal(model.deps[1].note, "Sums things");
  assert.equal(model.views.length, 2);
  assert.deepEqual(model.views[0].tables, ["users", "core.orders"]);
  assert.equal(model.views[1].tables, "*");
});

test("table group members and enum values tolerate commas (a common LLM slip)", () => {
  const src = `
Enum status {
  active,
  inactive,
  pending
}

Table a { id int [pk] }
Table b { id int [pk] }

TableGroup ops [color: #1E69FD] {
  a,
  b,
}
`;
  const { model, ok, diagnostics } = parseDbml(src);
  assert.equal(ok, true, JSON.stringify(diagnostics));
  assert.deepEqual(model.enums[0].values.map((v) => v.name), ["active", "inactive", "pending"]);
  assert.deepEqual(model.groups[0].tables, ["a", "b"]);
});

test("round trip: model → dbml → model is stable", () => {
  const first = parseDbml(DOC_EXAMPLE).model;
  const text = modelToDbml(first);
  const second = parseDbml(text);
  assert.deepEqual(second.diagnostics.filter((d) => d.severity === "error"), [], text);
  const strip = (m: any) => JSON.parse(JSON.stringify(m, (k, v) => (k === "loc" ? undefined : v)));
  assert.deepEqual(strip(second.model.tables), strip(first.tables));
  assert.deepEqual(strip(second.model.refs), strip(first.refs));
  assert.deepEqual(strip(second.model.groups), strip(first.groups));
  assert.deepEqual(strip(second.model.enums), strip(first.enums));
  assert.deepEqual(strip(second.model.deps), strip(first.deps));
  assert.deepEqual(strip(second.model.views), strip(first.views));
  assert.deepEqual(strip(second.model.notes), strip(first.notes));
});

test("error recovery keeps valid statements and reports line numbers", () => {
  const src = `Table a {\n  id int [pk]\n}\n\nTable broken {\n  id int [pk\n}\n\nTable c {\n  id int\n}\n`;
  const { model, diagnostics, ok } = parseDbml(src);
  assert.equal(ok, false);
  assert.ok(diagnostics.some((d) => d.severity === "error" && d.line >= 5));
  assert.deepEqual(model.tables.map((t) => t.name), ["a", "c"]);
});

test("unknown table in ref is a warning, not an error", () => {
  const { diagnostics, ok } = parseDbml(`Table a { id int }\nRef: a.id > ghost.id`);
  assert.ok(ok);
  assert.ok(diagnostics.some((d) => d.severity === "warning" && /ghost/.test(d.message)));
});

test("format keeps comments and re-indents", () => {
  const out = formatDbmlText("// hi\nTable a {\nid int // c\n  indexes {\nid\n}\n}\n");
  assert.equal(out, "// hi\nTable a {\n  id int // c\n  indexes {\n    id\n  }\n}\n");
});

test("empty and whitespace input", () => {
  assert.equal(parseDbml("").model.tables.length, 0);
  assert.ok(parseDbml("   \n\n").ok);
});
