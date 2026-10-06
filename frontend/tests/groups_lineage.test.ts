import { test } from "node:test";
import assert from "node:assert/strict";
import type { Node } from "@xyflow/react";
import { parseDbml } from "../src/lib/dbml/parser";
import { canvasToModel, modelToCanvas } from "../src/lib/model/canvasAdapter";
import { modelToDbml } from "../src/lib/dbml/serializer";
import { buildDisplayGraph } from "../src/lib/model/displayGraph";
import { normalizeMeta } from "../src/lib/model/types";
import { estimateNodeSize } from "../src/lib/layout";
import {
  GROUP_COLORS,
  assignGroup,
  createGroup,
  gatherGroup,
  groupFrameAt,
  groupNameProblem,
  groupOf,
  listGroups,
  nextGroupColor,
  patchGroupMeta,
  renameGroup,
  tablesUnderFrame,
  ungroupTables,
} from "../src/lib/model/groups";
import { lineageStages, newDependency } from "../src/lib/model/lineage";

// The Groups and Lineage drawers, the selection bar and drop-onto-frame all go through these helpers.

const SHOP = `
Table customers { id int [pk] }
Table orders { id int [pk]
  customer_id int [ref: > customers.id]
  total decimal }
Table payments { id int [pk]
  order_id int [ref: > orders.id] }
Table products { id int [pk] }
Table daily_revenue { day date [pk]
  amount decimal }
TableGroup sales { customers orders }
`;
const canvasOf = (dbml: string) => modelToCanvas(parseDbml(dbml).model);
const idOf = (nodes: Node[], label: string) => nodes.find((n) => String((n.data as any).label) === label)!.id;

test("listGroups: only groups with tables, alphabetical, with their colour and members", () => {
  const { nodes, meta } = canvasOf(SHOP);
  const groups = listGroups(nodes, meta);
  assert.deepEqual(groups.map((g) => g.name), ["sales"]);
  assert.deepEqual(groups[0].tableIds.sort(), [idOf(nodes, "customers"), idOf(nodes, "orders")].sort());
  // an empty group left in meta (its last table moved out) is not listed
  const emptied = assignGroup(nodes, groups[0].tableIds, "");
  assert.deepEqual(listGroups(emptied, meta), []);
});

test("createGroup: moves the tables in, picks an unused colour, and refuses bad names or no tables", () => {
  const { nodes, meta } = canvasOf(SHOP);
  const ids = [idOf(nodes, "payments"), idOf(nodes, "orders")];
  const res = createGroup(nodes, meta, "  billing ", ids)!;
  assert.ok(res);
  const billing = listGroups(res.nodes, res.meta).find((g) => g.name === "billing")!;
  assert.deepEqual(billing.tableIds.sort(), ids.sort());
  // orders left "sales" (a table is in one group)
  assert.deepEqual(listGroups(res.nodes, res.meta).find((g) => g.name === "sales")!.tableIds, [idOf(nodes, "customers")]);
  assert.ok(GROUP_COLORS.includes(res.meta.groups.billing.color!));
  assert.notEqual(res.meta.groups.billing.color, listGroups(nodes, meta)[0].color);

  assert.equal(createGroup(nodes, meta, "", ids), null);
  assert.equal(createGroup(nodes, meta, "SALES", ids), null, "names are case-insensitive");
  assert.equal(createGroup(nodes, meta, "empty", []), null);
  assert.equal(groupNameProblem(nodes, meta, "Sales"), "A group named “Sales” already exists");
  assert.equal(groupNameProblem(nodes, meta, "sales", "sales"), null, "renaming to itself is fine");
});

test("createGroup / assignGroup round-trip through DBML as a TableGroup", () => {
  const { nodes, edges, meta } = canvasOf(SHOP);
  const res = createGroup(nodes, meta, "billing", [idOf(nodes, "payments")])!;
  const dbml = modelToDbml(canvasToModel(res.nodes, edges, res.meta));
  assert.match(dbml, /TableGroup billing[^{]*\{\s*payments\s*\}/);
  assert.match(dbml, /TableGroup sales[^{]*\{[^}]*customers[^}]*orders[^}]*\}/);
});

test("renameGroup: renames tables, settings and views; refuses a taken name", () => {
  const { nodes, meta: m0 } = canvasOf(SHOP);
  const meta = { ...patchGroupMeta(m0, "sales", { color: "#10B981", note: "Orders and who placed them" }), views: [{ id: "v1", name: "Sales view", tables: [], groups: ["sales"] }] } as any;
  const r = renameGroup(nodes, meta, "sales", "commerce")!;
  assert.ok(r);
  assert.deepEqual(listGroups(r.nodes, r.meta).map((g) => g.name), ["commerce"]);
  assert.equal(r.meta.groups.commerce.color, "#10B981");
  assert.equal(r.meta.groups.commerce.note, "Orders and who placed them");
  assert.equal(r.meta.groups.sales, undefined);
  assert.deepEqual(r.meta.views[0].groups, ["commerce"]);

  const two = createGroup(nodes, meta, "billing", [idOf(nodes, "payments")])!;
  assert.equal(renameGroup(two.nodes, two.meta, "sales", "Billing"), null);
});

test("patchGroupMeta drops empty fields; nextGroupColor skips used colours", () => {
  const { nodes, meta } = canvasOf(SHOP);
  const m = patchGroupMeta(meta, "sales", { collapsed: true, note: "" });
  assert.equal(m.groups.sales.collapsed, true);
  assert.equal("note" in m.groups.sales, false);
  assert.equal("collapsed" in patchGroupMeta(m, "sales", { collapsed: false }).groups.sales, false);
  const used = listGroups(nodes, meta)[0].color.toLowerCase();
  assert.notEqual(nextGroupColor(nodes, meta).toLowerCase(), used);
});

test("assignGroup leaves non-tables and unchanged tables alone", () => {
  const { nodes } = canvasOf(SHOP);
  const note: Node = { id: "note_1", type: "stickyNote", position: { x: 0, y: 0 }, data: { text: "hi" } };
  const all = [...nodes, note];
  const out = assignGroup(all, [note.id, idOf(nodes, "customers"), idOf(nodes, "products")], "sales");
  assert.equal(out.find((n) => n.id === note.id), note);
  assert.equal(out.find((n) => n.id === idOf(nodes, "customers")), all.find((n) => n.id === idOf(nodes, "customers")), "already in sales: same object");
  assert.equal(groupOf(out.find((n) => n.id === idOf(nodes, "products"))!), "sales");
});

test("groupFrameAt: finds the expanded frame under a point, skipping the table's own group and collapsed cards", () => {
  const { nodes: raw, edges, meta } = canvasOf(SHOP);
  const nodes = raw.map((n, i) => ({ ...n, position: { x: i * 600, y: 0 } })); // apart, so frames don't overlap
  const two = createGroup(nodes, meta, "billing", [idOf(nodes, "payments")])!;
  const frames = buildDisplayGraph(two.nodes, edges, two.meta).nodes.filter((n) => n.type === "tableGroup");
  const sales = frames.find((f) => (f.data as any).label === "sales")!;
  const inside = { x: sales.position.x + 10, y: sales.position.y + 10 };
  assert.equal(groupFrameAt(frames, inside), "sales");
  assert.equal(groupFrameAt(frames, inside, "sales"), null, "a table's own frame grows to follow it: not a target");
  assert.equal(groupFrameAt(frames, { x: sales.position.x - 500, y: sales.position.y - 500 }), null);
  const collapsed = buildDisplayGraph(two.nodes, edges, patchGroupMeta(two.meta, "sales", { collapsed: true })).nodes.filter((n) => n.type === "tableGroup");
  assert.equal(groupFrameAt(collapsed, inside), null, "a collapsed group is a card, not a drop target");
});

test("gatherGroup: a frame that would cover other tables gets its tables gathered somewhere free; otherwise nothing moves", () => {
  const { nodes: raw, meta } = canvasOf(SHOP);
  // customers and payments far apart with orders between them, as auto arrange might leave them
  const at: Record<string, { x: number; y: number }> = { customers: { x: 0, y: 0 }, orders: { x: 400, y: 0 }, payments: { x: 800, y: 0 }, order_items: { x: 0, y: 600 }, products: { x: 400, y: 600 }, daily_revenue: { x: 800, y: 600 } };
  const nodes = raw.map((n) => ({ ...n, position: at[String((n.data as any).label)] ?? n.position, data: { ...n.data, group: "" } }));
  const ids = [idOf(nodes, "customers"), idOf(nodes, "payments")];
  const grouped = createGroup(nodes, meta, "edges", ids)!;
  assert.deepEqual(tablesUnderFrame(grouped.nodes, "edges"), [idOf(nodes, "orders")], "orders sits between them");

  const gathered = gatherGroup(grouped.nodes, grouped.meta, "edges");
  assert.deepEqual(tablesUnderFrame(gathered, "edges"), [], "after gathering the frame holds only its own tables");
  const moved = gathered.filter((n, i) => n.position !== grouped.nodes[i].position).map((n) => String((n.data as any).label)).sort();
  assert.deepEqual(moved, ["customers", "payments"], "only the group's tables move");
  // the gathered block's frame doesn't touch any other table either
  const others = gathered.filter((n) => !ids.includes(n.id) && n.type === "tableMode");
  const frame = buildDisplayGraph(gathered, [], grouped.meta).nodes.find((n) => n.id === "grp:edges")!;
  for (const o of others) {
    const s = { w: estimateNodeSize(o).width, h: estimateNodeSize(o).height };
    const clear = o.position.x >= frame.position.x + Number(frame.width) || o.position.x + s.w <= frame.position.x || o.position.y >= frame.position.y + Number(frame.height) || o.position.y + s.h <= frame.position.y;
    assert.ok(clear, `${(o.data as any).label} is clear of the gathered frame`);
  }

  // neighbours already side by side: untouched
  const tidy = createGroup(nodes, meta, "pair", [idOf(nodes, "orders"), idOf(nodes, "payments")])!;
  assert.equal(tablesUnderFrame(tidy.nodes, "pair").length, 0);
  assert.equal(gatherGroup(tidy.nodes, tidy.meta, "pair"), tidy.nodes);
  // a collapsed group is a card: never moved
  assert.equal(gatherGroup(grouped.nodes, patchGroupMeta(grouped.meta, "edges", { collapsed: true }), "edges"), grouped.nodes);
});

test("ungroupTables: a table taken out of the middle of a group moves clear of the frame; one at the edge stays", () => {
  const { nodes: raw, meta } = canvasOf(SHOP);
  const at: Record<string, { x: number; y: number }> = { customers: { x: 0, y: 0 }, orders: { x: 400, y: 0 }, payments: { x: 800, y: 0 }, order_items: { x: 0, y: 900 }, products: { x: 400, y: 900 }, daily_revenue: { x: 800, y: 900 } };
  const nodes = raw.map((n) => ({ ...n, position: at[String((n.data as any).label)] ?? n.position, data: { ...n.data, group: "" } }));
  const row = createGroup(nodes, meta, "row", [idOf(nodes, "customers"), idOf(nodes, "orders"), idOf(nodes, "payments")])!;
  const out = ungroupTables(row.nodes, [idOf(nodes, "orders")]);
  const orders = out.find((n) => n.id === idOf(nodes, "orders"))!;
  assert.equal(groupOf(orders), "");
  assert.notDeepEqual(orders.position, at.orders, "orders was in the middle: it moves");
  assert.deepEqual(tablesUnderFrame(out, "row"), [], "the frame no longer covers it");
  const edge = ungroupTables(row.nodes, [idOf(nodes, "payments")]);
  assert.deepEqual(edge.find((n) => n.id === idOf(nodes, "payments"))!.position, at.payments, "payments was at the end: the frame shrinks away from it");
});

test("newDependency: builds a Dep edge, column to column or whole table, and refuses duplicates and self-loops", () => {
  const { nodes, edges } = canvasOf(SHOP);
  const orders = idOf(nodes, "orders");
  const rev = idOf(nodes, "daily_revenue");
  const res = newDependency(nodes, edges, { from: orders, fromColumn: "total", to: rev, toColumn: "amount" });
  assert.ok("edge" in res);
  if (!("edge" in res)) return;
  assert.equal(res.edge.type, "depEdge");
  assert.equal(res.edge.source, orders);
  assert.equal(res.edge.target, rev);
  assert.deepEqual([(res.edge.data as any).kind, (res.edge.data as any).fromColumn, (res.edge.data as any).toColumn], ["dep", "total", "amount"]);
  // it exports as DBML Dep
  const dbml = modelToDbml(canvasToModel(nodes, [...edges, res.edge], normalizeMeta({})));
  assert.match(dbml, /Dep: orders\.total -> daily_revenue\.amount/);

  assert.deepEqual(newDependency(nodes, [...edges, res.edge], { from: orders, fromColumn: "total", to: rev, toColumn: "amount" }), { error: "That dependency already exists" });
  assert.deepEqual(newDependency(nodes, edges, { from: orders, to: orders }), { error: "A dependency needs two different ends" });
  assert.ok("edge" in newDependency(nodes, edges, { from: orders, fromColumn: "id", to: orders, toColumn: "total" }), "two columns of one table is fine");
  assert.deepEqual(newDependency(nodes, edges, { from: "", to: rev }), { error: "Pick the upstream and downstream tables" });
});

test("lineageStages: sources left, outputs right, a fan-in ordered to avoid crossings, cycles cut", () => {
  const { nodes, edges } = canvasOf(`
    Table raw_orders { id int }
    Table raw_payments { id int }
    Table stg_orders { id int }
    Table stg_payments { id int }
    Table revenue { id int }
    Table loop_a { id int }
    Table loop_b { id int }
    Dep: raw_payments -> stg_payments
    Dep: raw_orders -> stg_orders
    Dep: stg_orders -> revenue
    Dep: stg_payments -> revenue
    Dep: loop_a -> loop_b
    Dep: loop_b -> loop_a
  `);
  const name = (id: string) => String((nodes.find((n) => n.id === id)!.data as any).label);
  const map = lineageStages(edges);
  const stages = map.stages.map((s) => s.map(name));
  // the loop is cut where it closes: one of its tables starts it, the other follows
  const loopStart = stages[0].filter((t) => t.startsWith("loop_"));
  assert.equal(loopStart.length, 1);
  assert.deepEqual(stages[0].filter((t) => !t.startsWith("loop_")).sort(), ["raw_orders", "raw_payments"]);
  assert.ok(stages[1].includes(loopStart[0] === "loop_a" ? "loop_b" : "loop_a"));
  assert.deepEqual(stages[stages.length - 1], ["revenue"]);
  // stage 2 follows the order of what feeds it: stg_payments sits level with raw_payments
  const s0 = map.stages[0].map(name);
  const s1 = map.stages[1].map(name).filter((t) => t.startsWith("stg_"));
  assert.ok(s0.indexOf("raw_payments") < s0.indexOf("raw_orders") === s1.indexOf("stg_payments") < s1.indexOf("stg_orders"));
  // the loop is cut: both tables appear exactly once
  const flat = stages.flat();
  assert.equal(flat.filter((t) => t === "loop_a").length, 1);
  assert.equal(flat.filter((t) => t === "loop_b").length, 1);
  assert.equal(map.links.length, 6);
  assert.deepEqual(lineageStages([]).stages, []);
});
