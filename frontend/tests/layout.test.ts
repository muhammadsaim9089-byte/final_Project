import { test } from "node:test";
import assert from "node:assert/strict";
import type { Node } from "@xyflow/react";
import { parseDbml } from "../src/lib/dbml/parser";
import { modelToCanvas } from "../src/lib/model/canvasAdapter";
import { buildDisplayGraph } from "../src/lib/model/displayGraph";
import { estimateNodeSize, layoutNodes, type LayoutKind } from "../src/lib/layout";
import { TEMPLATES } from "../src/lib/templates";

const KINDS: LayoutKind[] = ["domains", "LR", "TB", "pipeline", "snowflake", "compact"];

const canvasOf = (dbml: string) => modelToCanvas(parseDbml(dbml).model);
const tablesIn = (nodes: Node[]) => nodes.filter((n) => n.type === "tableMode");
const named = (nodes: Node[], label: string) => nodes.find((n) => (n.data as any).label === label)!;
type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (n: Node): Rect => {
  const s = estimateNodeSize(n);
  return { x: n.position.x, y: n.position.y, w: s.width, h: s.height };
};
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const centre = (n: Node) => {
  const r = rectOf(n);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

test("every arrange algorithm places every template's tables without overlaps, group frames included", () => {
  for (const t of TEMPLATES) {
    const { nodes, edges, meta } = canvasOf(t.dbml);
    for (const kind of KINDS) {
      const laid = layoutNodes(nodes, edges, kind);
      const tables = tablesIn(laid);
      const at = `${t.id} / ${kind}`;
      for (const n of tables) assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `${at}: ${(n.data as any).label} has no position`);
      for (let i = 0; i < tables.length; i++)
        for (let j = i + 1; j < tables.length; j++)
          assert.ok(!overlap(rectOf(tables[i]), rectOf(tables[j])), `${at}: ${(tables[i].data as any).label} overlaps ${(tables[j].data as any).label}`);
      const frames = buildDisplayGraph(laid, edges, meta).nodes.filter((n) => n.type === "tableGroup");
      for (const f of frames) {
        const fr = { x: f.position.x, y: f.position.y, w: Number((f.style as any).width), h: Number((f.style as any).height) };
        for (const n of tables.filter((x) => (x.data as any).group !== (f.data as any).label))
          assert.ok(!overlap(fr, rectOf(n)), `${at}: frame "${(f.data as any).label}" covers table ${(n.data as any).label}`);
      }
    }
  }
});

test("pipeline: tables flow left to right along their references; unrelated tables sit below the flow", () => {
  const { nodes, edges } = canvasOf(`
    Table raw { id int [pk] }
    Table clean { id int [pk]  raw_id int [ref: > raw.id] }
    Table report { id int [pk]  clean_id int [ref: > clean.id]  country_id int [ref: > countries.id] }
    Table countries { id int [pk] }
    Table settings { id int [pk] }
  `);
  const laid = layoutNodes(nodes, edges, "pipeline");
  const x = (l: string) => named(laid, l).position.x;
  assert.ok(x("raw") < x("clean") && x("clean") < x("report"), "stages follow the lineage");
  assert.equal(x("countries"), x("clean"), "a lookup table sits next to the stage that uses it, not at the far left");
  const flowBottom = Math.max(...["raw", "clean", "report", "countries"].map((l) => rectOf(named(laid, l))).map((r) => r.y + r.h));
  assert.ok(named(laid, "settings").position.y > flowBottom, "a table without relationships goes below the flow");
});

test("pipeline: each table group is one stage with its tables stacked vertically", () => {
  const { nodes, edges } = canvasOf(`
    Table s1 { id int [pk] }
    Table s2 { id int [pk] }
    Table m1 { id int [pk]  s1_id int [ref: > s1.id]  s2_id int [ref: > s2.id] }
    Table m2 { id int [pk]  m1_id int [ref: > m1.id] }
    TableGroup staging { s1 s2 }
    TableGroup marts { m1 m2 }
  `);
  const laid = layoutNodes(nodes, edges, "pipeline");
  const p = (l: string) => named(laid, l).position;
  assert.equal(p("s1").x, p("s2").x, "staging tables share a column");
  assert.equal(p("m1").x, p("m2").x, "mart tables share a column");
  assert.ok(p("s1").x < p("m1").x, "the upstream group comes first");
  assert.ok(p("m1").y < p("m2").y, "inside a stage, tables follow the lineage top to bottom");
});

test("pipeline survives reference cycles", () => {
  const { nodes, edges } = canvasOf(`
    Table a { id int [pk]  c_id int [ref: > c.id] }
    Table b { id int [pk]  a_id int [ref: > a.id] }
    Table c { id int [pk]  b_id int [ref: > b.id] }
  `);
  const laid = tablesIn(layoutNodes(nodes, edges, "pipeline"));
  assert.equal(new Set(laid.map((n) => n.position.x)).size, 3, "three stages, one per table");
});

test("snowflake: the most connected table is in the middle, its neighbours all around it", () => {
  const dims = Array.from({ length: 8 }, (_, i) => `dim_${i}`);
  const { nodes, edges } = canvasOf(`
    ${dims.map((d) => `Table ${d} { id int [pk]  name varchar }`).join("\n")}
    Table fact { id int [pk]\n ${dims.map((d) => `${d}_id int [ref: > ${d}.id]`).join("\n")} }
    Table lonely { id int [pk] }
  `);
  const laid = layoutNodes(nodes, edges, "snowflake");
  const hub = centre(named(laid, "fact"));
  const around = dims.map((d) => centre(named(laid, d)));
  assert.ok(around.some((c) => c.x < hub.x) && around.some((c) => c.x > hub.x), "dimensions left and right of the fact table");
  assert.ok(around.some((c) => c.y < hub.y) && around.some((c) => c.y > hub.y), "dimensions above and below the fact table");
  const xs = around.map((c) => c.x);
  const ys = around.map((c) => c.y);
  assert.ok(Math.abs(hub.x - (Math.min(...xs) + Math.max(...xs)) / 2) < 200, "horizontally centred");
  assert.ok(Math.abs(hub.y - (Math.min(...ys) + Math.max(...ys)) / 2) < 200, "vertically centred");
});

test("compact: unrelated tables are packed into a tight, landscape rectangle", () => {
  const sizes = [3, 12, 5, 8, 2, 9, 4, 6, 10, 3, 7, 5];
  const { nodes, edges } = canvasOf(sizes.map((n, i) => `Table t${i} { ${Array.from({ length: n }, (_, c) => `c${c} int`).join("\n")} }`).join("\n"));
  const laid = tablesIn(layoutNodes(nodes, edges, "compact"));
  const rects = laid.map(rectOf);
  const w = Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x));
  const h = Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y));
  const used = rects.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(used / (w * h) > 0.55, `packing density ${(used / (w * h)).toFixed(2)}`);
  assert.ok(w / h > 0.9 && w / h < 3, `aspect ${(w / h).toFixed(2)}`);
});

test("arranging only new tables leaves the others in place, for every algorithm", () => {
  const { nodes, edges } = canvasOf(`
    Table a { id int [pk] }
    Table b { id int [pk]  a_id int [ref: > a.id] }
    Table c { id int [pk]  b_id int [ref: > b.id] }
    Table d { id int [pk]  c_id int [ref: > c.id] }
  `);
  const base = layoutNodes(nodes, edges, "LR");
  const fresh = new Set([named(base, "c").id, named(base, "d").id]);
  for (const kind of KINDS) {
    const laid = layoutNodes(base, edges, kind, fresh);
    assert.deepEqual(named(laid, "a").position, named(base, "a").position, kind);
    assert.deepEqual(named(laid, "b").position, named(base, "b").position, kind);
    const tables = tablesIn(laid);
    for (let i = 0; i < tables.length; i++)
      for (let j = i + 1; j < tables.length; j++) assert.ok(!overlap(rectOf(tables[i]), rectOf(tables[j])), `${kind}: overlap after a partial arrange`);
  }
});

test("the old names still work: grid → compact, radial → snowflake", () => {
  const t = TEMPLATES.find((x) => x.id === "ecommerce")!;
  const { nodes, edges } = canvasOf(t.dbml);
  const pos = (k: LayoutKind) => tablesIn(layoutNodes(nodes, edges, k)).map((n) => n.position);
  assert.deepEqual(pos("grid"), pos("compact"));
  assert.deepEqual(pos("radial"), pos("snowflake"));
});
