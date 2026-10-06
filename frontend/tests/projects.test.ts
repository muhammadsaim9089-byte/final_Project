import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToCanvas } from "../src/lib/model/canvasAdapter";
import { layoutNodes } from "../src/lib/layout";
import { matchProject, relativeTime, saveSignature, sortProjects, summarizeProject, thumbnailOf, type StoredProject } from "../src/lib/projects";

const DBML = `
Project shop { database_type: 'MySQL' }
Table customers { id int [pk]  email varchar }
Table orders { id int [pk]  customer_id int [ref: > customers.id]  total_cents int }
Table raw_events { id int }
Table daily { id int }
Dep: raw_events.id -> daily.id
TableGroup sales { customers orders }
`;

function stored(dbml: string, over: Partial<StoredProject> = {}): StoredProject {
  const res = modelToCanvas(parseDbml(dbml).model);
  const nodes = layoutNodes(res.nodes, res.edges, "LR");
  return { id: "p1", title: "Shop", nodesJson: nodes, edgesJson: res.edges, meta: res.meta, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", ...over };
}

test("a project card's facts: tables, relationships, lineage, groups and the engine", () => {
  const s = summarizeProject(stored(DBML));
  assert.equal(s.tables, 4);
  assert.equal(s.relationships, 1);
  assert.equal(s.lineage, 1);
  assert.equal(s.groups, 1);
  assert.equal(s.engine, "MySQL / MariaDB");
  assert.equal(s.dialect, "mysql");
  assert.deepEqual(s.tableNames.sort(), ["customers", "daily", "orders", "raw_events"]);
  const bare = summarizeProject({ nodesJson: [], edgesJson: [], meta: {} });
  assert.deepEqual([bare.tables, bare.engine], [0, null]);
  assert.equal(summarizeProject({ nodesJson: [], edgesJson: [], meta: { project: { databaseType: "CockroachDB" } } }).engine, "CockroachDB", "unknown engines are shown as written");
});

test("search looks in the name, then table names, then column names — and says where it matched", () => {
  const p = stored(DBML);
  assert.deepEqual(matchProject(p, "sho"), { match: true });
  assert.deepEqual(matchProject(p, "ORDERS"), { match: true, where: "table orders" });
  assert.deepEqual(matchProject(p, "total_c"), { match: true, where: "column orders.total_cents" });
  assert.deepEqual(matchProject(p, "invoices"), { match: false });
  assert.deepEqual(matchProject(p, "  "), { match: true });
});

test("sorting: last modified, name (natural), recently created, most tables", () => {
  const a = stored(DBML, { id: "a", title: "Diagram 10", updatedAt: "2026-03-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" });
  const b = stored("Table t { id int }", { id: "b", title: "diagram 9", updatedAt: "2026-03-05T00:00:00Z", createdAt: "2026-02-01T00:00:00Z" });
  const c = stored("Table x { id int }\nTable y { id int }", { id: "c", title: "Alpha", updatedAt: "2026-02-01T00:00:00Z", createdAt: "2026-03-01T00:00:00Z" });
  const ids = (sort: Parameters<typeof sortProjects>[1]) => sortProjects([a, b, c], sort).map((p) => p.id);
  assert.deepEqual(ids("modified"), ["b", "a", "c"]);
  assert.deepEqual(ids("name"), ["c", "b", "a"], "case-insensitive, 9 before 10");
  assert.deepEqual(ids("created"), ["c", "b", "a"]);
  assert.deepEqual(ids("tables"), ["a", "c", "b"]);
});

test("relative times read like a person wrote them", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const ago = (ms: number) => relativeTime(now - ms, now);
  assert.equal(ago(10_000), "just now");
  assert.equal(ago(60_000), "1 minute ago");
  assert.equal(ago(5 * 60_000), "5 minutes ago");
  assert.equal(ago(2 * 3600_000), "2 hours ago");
  assert.equal(ago(30 * 3600_000), "yesterday");
  assert.equal(ago(3 * 86400_000), "3 days ago");
  assert.equal(ago(20 * 86400_000), "Sep 7");
  assert.equal(relativeTime("2025-03-04T12:00:00Z", now), "Mar 4, 2025");
  assert.equal(relativeTime("not a date", now), "");
});

test("the thumbnail draws every table, the group frame, and the relationship and lineage lines", () => {
  const t = thumbnailOf(stored(DBML))!;
  assert.equal(t.tables.length, 4);
  assert.equal(t.groups.length, 1);
  assert.equal(t.links.length, 2);
  assert.deepEqual(t.links.map((l) => l.dep).sort(), [false, true]);
  const [x, y, w, h] = t.viewBox.split(" ").map(Number);
  for (const r of [...t.tables, ...t.groups]) assert.ok(r.x >= x && r.y >= y && r.x + r.w <= x + w && r.y + r.h <= y + h, "everything fits in the view box");
  assert.equal(thumbnailOf({ nodesJson: [], edgesJson: [], meta: {} }), null);
});

test("the save fingerprint changes with content, positions and the title — not with selection or measuring", () => {
  const p = stored(DBML);
  const nodes = p.nodesJson as any[];
  const meta = p.meta;
  const base = saveSignature(nodes, p.edgesJson as any, meta, "Shop");
  const touched = nodes.map((n, i) => (i === 0 ? { ...n, selected: true, measured: { width: 300, height: 180 }, dragging: false } : n));
  assert.equal(saveSignature(touched, p.edgesJson as any, meta, "Shop"), base, "selecting / measuring isn't an edit");
  const moved = nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 40, y: n.position.y } } : n));
  assert.notEqual(saveSignature(moved, p.edgesJson as any, meta, "Shop"), base, "moving a table is");
  assert.notEqual(saveSignature(nodes, p.edgesJson as any, meta, "Shop 2"), base, "renaming is");
  assert.notEqual(saveSignature(nodes, [], meta, "Shop"), base, "deleting relationships is");
  assert.notEqual(saveSignature(nodes, p.edgesJson as any, { ...meta, hiddenColors: ["#ff0000"] }, "Shop"), base, "view preferences are saved too");
});
