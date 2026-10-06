import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToDbml } from "../src/lib/dbml/serializer";
import { canvasToModel, modelToCanvas, modelSignature } from "../src/lib/model/canvasAdapter";
import { buildDisplayGraph, hiddenTableIds } from "../src/lib/model/displayGraph";
import { traceLineage } from "../src/lib/model/lineage";
import { layoutNodes } from "../src/lib/layout";
import { normalizeMeta } from "../src/lib/model/types";

const SRC = `
Project shop { database_type: 'PostgreSQL' Note: 'demo' }
enum status { active inactive }
Table users [headercolor: #d35400] {
  id integer [pk, increment]
  email varchar(255) [unique, not null, note: 'Login']
  status status [default: 'active']
  created_at timestamp [default: \`now()\`]
  Note: 'App users'
  indexes { (email, status) [name: 'idx_es'] }
}
Table core.orders {
  id integer [pk]
  user_id integer [not null]
  editor_id integer
  records (id, user_id) {
    1, 10
  }
}
Table lines { order_id int  line int  qty int
  indexes { (order_id, line) [pk] } }
Table raw { id int amount decimal }
Table stg { id int revenue decimal }
Ref: core.orders.user_id > users.id [delete: cascade, color: #aabbcc]
Ref: core.orders.editor_id >? users.id
Ref: lines.order_id > core.orders.id
TableGroup sales [color: #1E69FD] { users core.orders Note: 'Sales tables' }
Note todo { 'remember this' }
Dep: raw.amount -> stg.revenue [note: 'sum']
DiagramView Sales { Tables { users } TableGroups { sales } }
`;

function load() {
  const { model, ok } = parseDbml(SRC);
  assert.ok(ok);
  return modelToCanvas(model);
}

test("model → canvas creates tables, edges (parent → child), sticky notes, deps and meta", () => {
  const { nodes, edges, meta, newNodeIds } = load();
  const tables = nodes.filter((n) => n.type === "tableMode");
  assert.equal(tables.length, 5);
  assert.equal(newNodeIds.length, 6); // 5 tables + 1 note have no position yet
  const users = tables.find((n) => (n.data as any).label === "users")!;
  const orders = tables.find((n) => (n.data as any).label === "orders")!;
  assert.equal((orders.data as any).schema, "core");
  assert.equal((users.data as any).color, "#d35400");
  assert.equal((users.data as any).group, "sales");
  const attrs = (users.data as any).attributes;
  assert.equal(attrs[0].isPk, true);
  assert.equal(attrs[0].autoIncrement, true);
  assert.equal(attrs[1].allowNull, false);
  assert.equal(attrs[2].defaultVal, "'active'");
  assert.equal(attrs[3].defaultVal, "now()");
  assert.equal((users.data as any).indexes[0].name, "idx_es");

  const refEdges = edges.filter((e) => (e.data as any).kind === "ref");
  assert.equal(refEdges.length, 3);
  const e1 = refEdges.find((e) => (e.data as any).targetColumn === "user_id")!;
  assert.equal(e1.source, users.id); // parent
  assert.equal(e1.target, orders.id); // child
  assert.equal((e1.data as any).relationshipType, "one-to-many");
  assert.equal((e1.data as any).onDelete, "CASCADE");
  assert.equal((e1.data as any).color, "#aabbcc");
  const e2 = refEdges.find((e) => (e.data as any).targetColumn === "editor_id")!;
  assert.equal((e2.data as any).optionalSource, true);
  // FK flags + editor helper fields so the table editor keeps the edges when saving
  const oAttrs = (orders.data as any).attributes;
  assert.equal(oAttrs.find((a: any) => a.name === "user_id").isFk, true);
  assert.equal(oAttrs.find((a: any) => a.name === "user_id").fkRefTable, "users");
  assert.equal((orders.data as any).seedData[0].user_id, 10);
  // composite pk from index form
  const lines = tables.find((n) => (n.data as any).label === "lines")!;
  assert.deepEqual((lines.data as any).attributes.filter((a: any) => a.isPk).map((a: any) => a.name), ["order_id", "line"]);
  assert.equal(nodes.filter((n) => n.type === "stickyNote").length, 1);
  const dep = edges.find((e) => e.type === "depEdge")!;
  assert.equal((dep.data as any).fromColumn, "amount");
  assert.equal((dep.data as any).note, "sum");
  assert.equal(meta.enums[0].name, "status");
  assert.equal(meta.groups.sales.color, "#1E69FD");
  assert.equal(meta.groups.sales.note, "Sales tables");
  assert.equal(meta.views[0].name, "Sales");
  assert.equal(meta.project.databaseType, "PostgreSQL");
});

test("canvas → model → dbml → canvas is lossless for everything DBML can express", () => {
  const first = load();
  const model1 = canvasToModel(first.nodes, first.edges, first.meta);
  const dbml = modelToDbml(model1);
  const reparsed = parseDbml(dbml);
  assert.deepEqual(reparsed.diagnostics.filter((d) => d.severity === "error"), [], dbml);
  const second = modelToCanvas(reparsed.model);
  const model2 = canvasToModel(second.nodes, second.edges, second.meta);
  assert.equal(modelSignature(model2), modelSignature(model1));
  assert.match(dbml, /\(order_id, line\) \[pk\]/);
  assert.match(dbml, /Ref: core\.orders\.editor_id >\? users\.id/);
  assert.match(dbml, /TableGroup sales \[color: #1E69FD\]/);
  assert.match(dbml, /Dep: raw\.amount -> stg\.revenue \[note: 'sum'\]/);
  assert.match(dbml, /database_type: 'PostgreSQL'/);
});

test("applying edited DBML keeps ids, positions and UI-only fields of surviving tables", () => {
  const first = load();
  const laid = layoutNodes(first.nodes, first.edges, "LR");
  const users = laid.find((n) => (n.data as any).label === "users")!;
  const withUi = laid.map((n) => (n.id === users.id ? { ...n, data: { ...n.data, isCollapsed: true, attributes: (n.data as any).attributes.map((a: any, i: number) => (i === 1 ? { ...a, color: "#ff0000" } : a)) } } : n));
  const edited = parseDbml(SRC.replace("email varchar(255)", "email varchar(300)").replace("Table raw {", "Table extra { id int }\nTable raw {")).model;
  const second = modelToCanvas(edited, { prevNodes: withUi, prevEdges: first.edges, prevMeta: first.meta });
  const usersAfter = second.nodes.find((n) => (n.data as any).label === "users")!;
  assert.equal(usersAfter.id, users.id);
  assert.deepEqual(usersAfter.position, users.position);
  assert.equal((usersAfter.data as any).isCollapsed, true); // UI flag survived
  assert.equal((usersAfter.data as any).attributes[1].color, "#ff0000"); // column colour survived
  assert.equal((usersAfter.data as any).attributes[1].type, "varchar(300)"); // DBML wins for real schema fields
  assert.equal(second.newNodeIds.length, 1); // only the new table needs a position
  // edge ids are stable
  const oldEdge = first.edges.find((e) => (e.data as any).targetColumn === "user_id")!;
  assert.ok(second.edges.some((e) => e.id === oldEdge.id));
});

test("hand-drawn edges without column info get inferred columns", () => {
  const { nodes } = modelToCanvas(parseDbml(`Table users { id int [pk] }\nTable posts { id int [pk] user_id int }`).model);
  const [users, posts] = [nodes.find((n) => (n.data as any).label === "users")!, nodes.find((n) => (n.data as any).label === "posts")!];
  const model = canvasToModel(nodes, [{ id: "x", source: users.id, target: posts.id, type: "crowsFoot", data: { relationshipType: "many-to-one" } } as any]);
  assert.equal(model.refs.length, 1);
  assert.deepEqual(model.refs[0].from.columns, ["user_id"]);
  assert.deepEqual(model.refs[0].to.columns, ["id"]);
  assert.equal(model.refs[0].type, "many-to-one");
});

test("sticky notes never leak into tables (regression: old serializer treated every node as a table)", () => {
  const { nodes, edges, meta } = load();
  const model = canvasToModel(nodes, edges, meta);
  assert.equal(model.tables.length, 5);
  assert.equal(model.notes[0].text, "remember this");
});

test("display graph: views, hidden colours, group frames, collapse + edge re-routing", () => {
  const { nodes, edges, meta } = load();
  const id = (label: string) => nodes.find((n) => (n.data as any).label === label)!.id;

  // default: all visible, one dashed frame for the group
  let g = buildDisplayGraph(nodes, edges, meta);
  assert.equal(g.nodes.filter((n) => n.type === "tableGroup").length, 1);
  assert.equal(g.nodes.filter((n) => n.type === "tableMode" && n.hidden).length, 0);

  // frames are rebuilt on every change; React Flow renders a node with no dimensions `visibility: hidden` (invisible and
  // click-through — the title-bar buttons stop working) until it is measured, so each frame must ship with its own size
  const frame = g.nodes.find((n) => n.type === "tableGroup")!;
  assert.equal(frame.width, Number((frame.style as any).width));
  assert.equal(frame.height, Number((frame.style as any).height));

  // collapsed group: members hidden, internal edges hidden, outside edges re-routed to the card
  const collapsed = { ...meta, groups: { ...meta.groups, sales: { ...meta.groups.sales, collapsed: true } } };
  g = buildDisplayGraph(nodes, edges, collapsed);
  const card = g.nodes.find((n) => n.id === "grp:sales")!;
  assert.equal((card.data as any).collapsed, true);
  assert.ok(card.initialWidth && card.initialHeight, "collapsed card needs an initial size too");
  assert.equal(g.nodes.find((n) => n.id === id("users"))!.hidden, true);
  const linesEdge = g.edges.find((e) => (e.data as any).targetColumn === "order_id")!;
  assert.equal(linesEdge.source, "grp:sales"); // orders is folded into the card, lines stays visible
  assert.equal(linesEdge.target, id("lines"));
  const internal = g.edges.find((e) => (e.data as any).targetColumn === "user_id")!;
  assert.equal(internal.hidden, true);

  // named view restricts the visible tables
  const viewMeta = normalizeMeta({ ...meta, activeViewId: "sales" });
  const hidden = hiddenTableIds(nodes, viewMeta);
  assert.equal(hidden.has(id("raw")), true);
  assert.equal(hidden.has(id("users")), false);
  assert.equal(hidden.has(id("orders")), false); // via its table group

  // hide by colour
  const colorMeta = normalizeMeta({ ...meta, hiddenColors: ["#d35400"] });
  assert.equal(hiddenTableIds(nodes, colorMeta).has(id("users")), true);
  // relationship toggle
  g = buildDisplayGraph(nodes, edges, { ...meta, showRelationships: false });
  assert.equal(g.edges.filter((e) => (e.data as any).kind === "ref" && !e.hidden).length, 0);
  assert.equal(g.edges.filter((e) => e.type === "depEdge" && !e.hidden).length, 1);
});

test("lineage tracing follows Dep edges upstream and downstream", () => {
  const model = parseDbml(`
    Table a { id int  x int }
    Table b { id int  y int }
    Table c { id int  z int }
    Table d { id int }
    Dep: a.x -> b.y
    Dep: b.y -> c.z
    Dep: a.id -> d.id
  `).model;
  const { nodes, edges } = modelToCanvas(model);
  const id = (l: string) => nodes.find((n) => (n.data as any).label === l)!.id;
  const t = traceLineage(edges, { tableId: id("b"), column: "y" });
  assert.equal(t.edgeIds.size, 2);
  assert.deepEqual([...t.columns.get(id("a"))!], ["x"]);
  assert.deepEqual([...t.columns.get(id("c"))!], ["z"]);
  assert.equal(t.columns.has(id("d")), false);
  const whole = traceLineage(edges, { tableId: id("a") });
  assert.equal(whole.edgeIds.size, 3);
});

test("layout algorithms position every table without overlaps in the same cell", () => {
  const { nodes, edges } = load();
  for (const kind of ["LR", "TB", "grid", "radial"] as const) {
    const laid = layoutNodes(nodes, edges, kind).filter((n) => n.type === "tableMode");
    const seen = new Set(laid.map((n) => `${Math.round(n.position.x)},${Math.round(n.position.y)}`));
    assert.equal(seen.size, laid.length, `${kind}: duplicate positions`);
  }
  // only new tables are placed, existing ones stay put
  const laid = layoutNodes(nodes, edges, "LR");
  const partial = layoutNodes(laid, edges, "LR", new Set([laid[0].id]));
  assert.deepEqual(partial[1].position, laid[1].position);
});

test("group-aware layout: table-group frames never overlap tables from other groups", async () => {
  const { TEMPLATES } = await import("../src/lib/templates");
  for (const id of ["ecommerce", "data-lineage-warehouse"]) {
    const t = TEMPLATES.find((x) => x.id === id)!;
    const { nodes, edges, meta } = modelToCanvas(parseDbml(t.dbml).model);
    const laid = layoutNodes(nodes, edges, "LR");
    const g = buildDisplayGraph(laid, edges, meta);
    const frames = g.nodes.filter((n) => n.type === "tableGroup");
    assert.ok(frames.length >= 2, `${id}: expected group frames`);
    for (const f of frames) {
      const fw = Number((f.style as any).width);
      const fh = Number((f.style as any).height);
      for (const n of laid.filter((x) => x.type === "tableMode" && (x.data as any).group !== (f.data as any).label)) {
        const w = 250;
        const h = 60 + (n.data as any).attributes.length * 30;
        const overlap = n.position.x < f.position.x + fw && n.position.x + w > f.position.x && n.position.y < f.position.y + fh && n.position.y + h > f.position.y;
        assert.ok(!overlap, `${id}: frame "${(f.data as any).label}" overlaps table ${(n.data as any).label}`);
      }
    }
  }
});
