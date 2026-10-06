import { test } from "node:test";
import assert from "node:assert/strict";
import type { Edge, Node } from "@xyflow/react";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToCanvas } from "../src/lib/model/canvasAdapter";
import { buildDisplayGraph } from "../src/lib/model/displayGraph";
import { DEFAULT_LAYOUT, GROUP_FRAME_PAD, estimateNodeSize, layoutNodes, type LayoutKind } from "../src/lib/layout";
import { layoutModel } from "../src/lib/model/autoLayout";
import { detectHubs, hubStructureKey, HUB_MIN_TABLES } from "../src/lib/model/hubs";
import { normalizeMeta, tableKey } from "../src/lib/model/types";
import { cardDetail, lodForZoom } from "../src/lib/lod";
import { SAAS_DBML } from "./fixtures/saasSchema";

// Large generated schemas: the "domains" default layout, hub-table de-cluttering and semantic zoom.

const canvasOf = (dbml: string) => modelToCanvas(parseDbml(dbml).model);
const tablesIn = (nodes: Node[]) => nodes.filter((n) => n.type === "tableMode");
const label = (n: Node) => String((n.data as any).label);
const byLabel = (nodes: Node[], l: string) => nodes.find((n) => label(n) === l)!;
const UNGROUPED = SAAS_DBML.replace(/TableGroup [\s\S]*$/m, "");

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxOf = (n: Node): Box => {
  const s = estimateNodeSize(n);
  return { x0: n.position.x, y0: n.position.y, x1: n.position.x + s.width, y1: n.position.y + s.height };
};

/** bounding box (frames included), how much of a 1920×1080 screen it fills when fitted, and the zoom that takes */
function shapeOf(laid: Node[]) {
  const tables = tablesIn(laid);
  const frames = new Map<string, Box>();
  for (const n of tables) {
    const g = (n.data as any).group;
    if (!g) continue;
    const b = boxOf(n);
    const f = frames.get(g) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    frames.set(g, { x0: Math.min(f.x0, b.x0 - GROUP_FRAME_PAD.x), y0: Math.min(f.y0, b.y0 - GROUP_FRAME_PAD.top), x1: Math.max(f.x1, b.x1 + GROUP_FRAME_PAD.x), y1: Math.max(f.y1, b.y1 + GROUP_FRAME_PAD.bottom) });
  }
  const all = [...tables.map(boxOf), ...frames.values()];
  const w = Math.max(...all.map((b) => b.x1)) - Math.min(...all.map((b) => b.x0));
  const h = Math.max(...all.map((b) => b.y1)) - Math.min(...all.map((b) => b.y0));
  const zoom = Math.min(1920 / w, 1080 / h);
  return { aspect: w / h, fill: (w * h * zoom * zoom) / (1920 * 1080), zoom, frames, tables };
}

// ─── hub detection ──────────────────────────────────────────────────────────────────────────────────────────────────

test("hubs: tenants and users are found in the SaaS schema, with every referencing table's columns", () => {
  const { nodes, edges } = canvasOf(SAAS_DBML);
  const h = detectHubs(nodes, edges);
  assert.deepEqual([...h.hubs.values()].map((x) => [x.label, x.kind]).sort(), [["tenants", "tenant"], ["users", "user"]]);
  assert.equal(h.hubs.get(byLabel(nodes, "tenants").id)!.referencedBy, 29);
  assert.equal(h.hubEdgeIds.size, 71, "71 of the 89 relationships end at a hub");
  const tasks = h.refsByTable.get(byLabel(nodes, "tasks").id)!;
  assert.deepEqual(tasks.map((r) => `${r.hub}.${r.column}`).sort(), ["tenants.tenant_id", "users.assignee_id", "users.created_by_id"]);
  assert.equal(h.refsByTable.has(byLabel(nodes, "tenants").id), false, "the tenant table itself references nothing");
});

test("hubs: small diagrams keep every line; an ordinary popular table is not a hub", () => {
  const small = canvasOf(`
    Table users { id int [pk] }
    ${Array.from({ length: HUB_MIN_TABLES - 2 }, (_, i) => `Table t${i} { id int [pk]  user_id int [ref: > users.id] }`).join("\n")}
  `);
  assert.equal(detectHubs(small.nodes, small.edges).hubs.size, 0, `${HUB_MIN_TABLES - 1} tables is too few to bother`);
  const popular = canvasOf(`
    Table products { id int [pk] }
    ${Array.from({ length: 7 }, (_, i) => `Table p${i} { id int [pk]  product_id int [ref: > products.id] }`).join("\n")}
    ${Array.from({ length: 8 }, (_, i) => `Table x${i} { id int [pk] }`).join("\n")}
  `);
  assert.equal(detectHubs(popular.nodes, popular.edges).hubs.size, 0, "7 referrers is below the threshold for a non-tenant table");
});

test("hubs: a tenant-like table is a hub from 4 referrers, recognised by its name or its tenant_id columns", () => {
  const filler = Array.from({ length: 9 }, (_, i) => `Table f${i} { id int [pk] }`).join("\n");
  const byName = canvasOf(`Table workspaces { id int [pk] }\n${Array.from({ length: 4 }, (_, i) => `Table w${i} { id int [pk]  ws int [ref: > workspaces.id] }`).join("\n")}\n${filler}`);
  assert.equal([...detectHubs(byName.nodes, byName.edges).hubs.values()][0]?.kind, "tenant");
  const byColumn = canvasOf(`Table clients { id int [pk] }\n${Array.from({ length: 4 }, (_, i) => `Table c${i} { id int [pk]  tenant_id int [ref: > clients.id] }`).join("\n")}\n${filler}`);
  assert.equal([...detectHubs(byColumn.nodes, byColumn.edges).hubs.values()][0]?.label, "clients");
});

test("hubs: the structure key ignores positions but notices renames and new relationships", () => {
  const { nodes, edges } = canvasOf(SAAS_DBML);
  const key = hubStructureKey(nodes, edges);
  assert.equal(hubStructureKey(nodes.map((n) => ({ ...n, position: { x: 999, y: 999 } })), edges), key);
  assert.notEqual(hubStructureKey(nodes.map((n, i) => (i === 0 ? { ...n, data: { ...n.data, label: "renamed" } } : n)), edges), key);
  assert.notEqual(hubStructureKey(nodes, edges.slice(1)), key);
});

// ─── the domains layout ─────────────────────────────────────────────────────────────────────────────────────────────

test("domains is the default for new, generated and imported diagrams", () => {
  assert.equal(DEFAULT_LAYOUT, "domains");
  const model = parseDbml(SAAS_DBML).model;
  const { nodes, edges } = modelToCanvas(model);
  const expected = new Map(tablesIn(layoutNodes(nodes, edges, "domains")).map((n) => [label(n), n.position]));
  for (const t of layoutModel(model).tables) assert.deepEqual({ x: t.x, y: t.y }, expected.get(t.name), t.name);
});

test("domains: 30 grouped tables fill a widescreen instead of a tall column — three times the zoom of the old default", () => {
  const { nodes, edges } = canvasOf(SAAS_DBML);
  const domains = shapeOf(layoutNodes(nodes, edges, "domains"));
  const lr = shapeOf(layoutNodes(nodes, edges, "LR"));
  assert.ok(lr.aspect < 0.6, `the old default is a tall column (${lr.aspect.toFixed(2)})`);
  assert.ok(domains.aspect > 1.4 && domains.aspect < 2.4, `widescreen shape (${domains.aspect.toFixed(2)})`);
  assert.ok(domains.fill > 0.75, `fills ${Math.round(domains.fill * 100)}% of a 16:9 screen`);
  assert.ok(domains.zoom > lr.zoom * 3, `zoom-to-fit ${Math.round(domains.zoom * 100)}% vs ${Math.round(lr.zoom * 100)}%`);
});

test("domains: group blocks form a grid (more than one row and column), tightly framed, with nothing overlapping", () => {
  const { nodes, edges } = canvasOf(SAAS_DBML);
  const { frames, tables } = shapeOf(layoutNodes(nodes, edges, "domains"));
  const rows = new Set([...frames.values()].map((f) => Math.round(f.y0 / 100)));
  const cols = new Set([...frames.values()].map((f) => Math.round(f.x0 / 100)));
  assert.ok(rows.size >= 2 && cols.size >= 2, `${rows.size} rows × ${cols.size} columns of groups`);
  for (const [g, f] of frames) {
    const members = tables.filter((n) => (n.data as any).group === g);
    const area = members.reduce((s, n) => s + (boxOf(n).x1 - boxOf(n).x0) * (boxOf(n).y1 - boxOf(n).y0), 0);
    assert.ok(area / ((f.x1 - f.x0) * (f.y1 - f.y0)) > 0.35, `${g}: tables fill its frame`);
    for (const n of tables) if ((n.data as any).group !== g) assert.ok(!hit(f, boxOf(n)), `${g}'s frame covers ${label(n)}`);
  }
  for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) assert.ok(!hit(boxOf(tables[i]), boxOf(tables[j])), `${label(tables[i])} overlaps ${label(tables[j])}`);
});

test("domains: the block holding the hub tables (tenants, users) is placed first, top left", () => {
  const { nodes, edges } = canvasOf(SAAS_DBML);
  const { frames } = shapeOf(layoutNodes(nodes, edges, "domains"));
  const identity = frames.get("identity")!;
  for (const [g, f] of frames) if (g !== "identity") assert.ok(f.y0 >= identity.y0 && (f.y0 > identity.y0 || f.x0 > identity.x0), `identity (tenants, users) is placed before ${g}`);
});

test("domains without table groups: clusters of related tables stay together; lines are the shortest of any layout", () => {
  const { nodes, edges } = canvasOf(UNGROUPED);
  const hubs = detectHubs(nodes, edges);
  const lineLength = (kind: LayoutKind) => {
    const laid = layoutNodes(nodes, edges, kind);
    const c = new Map(tablesIn(laid).map((n) => [n.id, { x: boxOf(n).x0 + 130, y: boxOf(n).y0 + 100 }]));
    return edges.filter((e) => !hubs.hubEdgeIds.has(e.id)).reduce((s, e) => s + Math.hypot(c.get(e.source)!.x - c.get(e.target)!.x, c.get(e.source)!.y - c.get(e.target)!.y), 0);
  };
  const domains = lineLength("domains");
  for (const kind of ["LR", "compact", "pipeline"] as LayoutKind[]) assert.ok(domains < lineLength(kind), `shorter than ${kind}`);
  const shape = shapeOf(layoutNodes(nodes, edges, "domains"));
  assert.ok(shape.aspect > 1.3 && shape.aspect < 2.2, `widescreen (${shape.aspect.toFixed(2)})`);
  // projects → tasks → task_comments stay a left-to-right chain
  const laid = layoutNodes(nodes, edges, "domains");
  assert.ok(byLabel(laid, "projects").position.x < byLabel(laid, "tasks").position.x && byLabel(laid, "tasks").position.x < byLabel(laid, "task_comments").position.x);
});

test("domains: a table with many children wraps them into columns instead of one tall stack", () => {
  const { nodes, edges } = canvasOf(`
    Table orders { id int [pk] }
    ${Array.from({ length: 14 }, (_, i) => `Table part${i} { id int [pk]  order_id int [ref: > orders.id]  a int  b int }`).join("\n")}
  `);
  const shape = shapeOf(layoutNodes(nodes, edges, "domains"));
  assert.ok(shape.aspect > 0.8, `not a tall column (${shape.aspect.toFixed(2)})`);
});

// ─── hub connections on the canvas ──────────────────────────────────────────────────────────────────────────────────

const visibleIds = (g: { edges: Edge[] }) => new Set(g.edges.filter((e) => !e.hidden).map((e) => e.id));

test("hub lines are hidden by default and counted; turning them on shows every line", () => {
  const { nodes, edges, meta } = canvasOf(SAAS_DBML);
  const hubs = detectHubs(nodes, edges);
  const off = buildDisplayGraph(nodes, edges, meta, { hubs });
  assert.equal(off.hiddenHubEdges, 71);
  assert.equal(visibleIds(off).size, 89 - 71);
  for (const id of hubs.hubEdgeIds) assert.ok(!visibleIds(off).has(id));
  const on = buildDisplayGraph(nodes, edges, { ...meta, showHubEdges: true }, { hubs });
  assert.equal(on.hiddenHubEdges, 0);
  assert.equal(visibleIds(on).size, 89);
  assert.equal(buildDisplayGraph(nodes, edges, meta).hiddenHubEdges, 71, "detects hubs itself when not given them");
});

test("selecting a table shows its own hub lines; selecting a hub shows all of its lines", () => {
  const { nodes, edges, meta } = canvasOf(SAAS_DBML);
  const tasks = byLabel(nodes, "tasks").id;
  const withTasks = buildDisplayGraph(nodes.map((n) => (n.id === tasks ? { ...n, selected: true } : n)), edges, meta);
  assert.equal(withTasks.hiddenHubEdges, 71 - 3, "tasks' tenant, creator and assignee lines");
  const tenants = byLabel(nodes, "tenants").id;
  const withTenants = buildDisplayGraph(nodes.map((n) => (n.id === tenants ? { ...n, selected: true } : n)), edges, meta);
  assert.equal(withTenants.hiddenHubEdges, 71 - 29);
});

test("with relationships switched off nothing is counted as a hidden hub line", () => {
  const { nodes, edges, meta } = canvasOf(SAAS_DBML);
  const g = buildDisplayGraph(nodes, edges, { ...meta, showRelationships: false });
  assert.equal(visibleIds(g).size, 0);
  assert.equal(g.hiddenHubEdges, 0);
});

test("the setting is saved with the diagram: off unless explicitly on", () => {
  assert.equal(normalizeMeta({}).showHubEdges, false);
  assert.equal(normalizeMeta({ showHubEdges: true }).showHubEdges, true);
  assert.equal(normalizeMeta({ showHubEdges: "yes" }).showHubEdges, false);
});

// ─── semantic zoom ──────────────────────────────────────────────────────────────────────────────────────────────────

test("zoom levels: overview below 35 %, keys below 70 %, full from 70 %", () => {
  assert.equal(lodForZoom(0.1), "overview");
  assert.equal(lodForZoom(0.349), "overview");
  assert.equal(lodForZoom(0.35), "keys");
  assert.equal(lodForZoom(0.699), "keys");
  assert.equal(lodForZoom(0.7), "full");
  assert.equal(lodForZoom(2), "full");
});

test("zoom caps the user's detail level but never raises it", () => {
  assert.equal(cardDetail("all", "overview"), "overview");
  assert.equal(cardDetail("all", "keys"), "keys");
  assert.equal(cardDetail("all", "full"), "all");
  assert.equal(cardDetail("keys", "full"), "keys");
  assert.equal(cardDetail("headers", "keys"), "headers");
  assert.equal(cardDetail("headers", "full"), "headers");
  assert.equal(cardDetail("headers", "overview"), "overview");
});

test("fixture sanity: the SaaS schema parses into 30 tables in 5 groups", () => {
  const r = parseDbml(SAAS_DBML);
  assert.equal(r.ok, true);
  assert.equal(r.model.tables.length, 30);
  assert.equal(r.model.groups.length, 5);
  assert.ok(r.model.tables.every((t) => tableKey(t.schema, t.name)));
});
