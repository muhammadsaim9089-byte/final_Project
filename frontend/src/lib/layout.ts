/**
 * Auto-arrange algorithms for table nodes (dbdiagram "Auto arrange", ERDLab "Autolayout"). They operate on plain React
 * Flow nodes/edges and return new node positions:
 *
 *   domains    the default: each table group (or cluster of related tables) left to right in a block, the blocks
 *              packed into a widescreen rectangle, related blocks side by side; hub tables (tenants, users) set aside
 *   LR / TB    hierarchical along the relationships (dagre); table groups become clusters
 *   pipeline   left-to-right stages along the data-dependency lineage; a table group is one stage, its tables stacked
 *   snowflake  the most connected tables in the centre, their neighbours in rings around them
 *   compact    everything packed into a tight rectangle
 *
 * Every edge points upstream → downstream: a relationship runs from the referenced (parent) table to the table holding
 * the foreign key, a lineage `Dep` from the source to the derived table.
 *
 * Table groups are kept together: pipeline / snowflake / compact arrange a group's tables inside a block that leaves
 * exactly the room its frame draws around them (GROUP_FRAME_PAD), then arrange the blocks — so a frame never covers a
 * table from outside the group.
 */
import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";
import { estimateNodeSize } from "./nodeSize";
import { detectHubs } from "./model/hubs";

/** "grid" and "radial" are the older names of "compact" and "snowflake". */
export type LayoutKind = "domains" | "LR" | "TB" | "pipeline" | "snowflake" | "compact" | "grid" | "radial";

/** What new, generated and imported diagrams are arranged with. */
export const DEFAULT_LAYOUT: LayoutKind = "domains";

export { NODE_WIDTH, estimateNodeSize } from "./nodeSize";

/** Room a table-group frame draws around its tables (displayGraph uses the same numbers). */
export const GROUP_FRAME_PAD = { x: 28, top: 60, bottom: 28 } as const;

const GAP = 60; // between neighbouring tables / group frames
const INNER_GAP = 44; // between tables inside a group
const STAGE_GAP = 160; // between pipeline stages — room for the relationship lines
const ASPECT = 1.6; // target width / height of packed layouts (a landscape screen)

type Pt = { x: number; y: number };

function tablesOf(nodes: Node[]) {
  return nodes.filter((n) => n.type === "tableMode");
}

export function layoutNodes(nodes: Node[], edges: Edge[], kind: LayoutKind = "LR", onlyIds?: Set<string>): Node[] {
  const tables = tablesOf(nodes);
  if (tables.length === 0) return nodes;
  const targets = onlyIds ? tables.filter((t) => onlyIds.has(t.id)) : tables;
  if (targets.length === 0) return nodes;
  const algo = kind === "grid" ? "compact" : kind === "radial" ? "snowflake" : kind;
  let positions: Map<string, Pt>;
  if (algo === "LR" || algo === "TB") {
    positions = dagreLayout(tables, edges, algo, onlyIds);
  } else {
    const ids = new Set(targets.map((t) => t.id));
    const local = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
    positions =
      algo === "domains" ? domainsLayout(targets, local) : algo === "pipeline" ? pipelineLayout(targets, local) : algo === "snowflake" ? snowflakeLayout(targets, local) : compactLayout(targets, local);
    // when only some tables are (re)positioned, they go to the right of the existing diagram
    const fixed = onlyIds ? tables.filter((t) => !onlyIds.has(t.id)) : [];
    const at = fixed.length ? { x: Math.max(...fixed.map((t) => t.position.x + estimateNodeSize(t).width)) + 120, y: Math.min(...fixed.map((t) => t.position.y)) } : { x: 0, y: 0 };
    positions = moveTo(positions, at);
  }
  const horizontal = algo !== "TB";
  return nodes.map((n) => {
    const p = positions.get(n.id);
    if (!p) return n;
    return {
      ...n,
      position: p,
      sourcePosition: (horizontal ? "right" : "bottom") as any,
      targetPosition: (horizontal ? "left" : "top") as any,
    };
  });
}

function moveTo(positions: Map<string, Pt>, at: Pt): Map<string, Pt> {
  if (!positions.size) return positions;
  let minX = Infinity;
  let minY = Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  const out = new Map<string, Pt>();
  for (const [id, p] of positions) out.set(id, { x: Math.round(p.x - minX + at.x), y: Math.round(p.y - minY + at.y) });
  return out;
}

// ───────────────────────── hierarchical (dagre) ─────────────────────────

function dagreLayout(tables: Node[], edges: Edge[], dir: "LR" | "TB", onlyIds?: Set<string>): Map<string, Pt> {
  const horizontal = dir === "LR";
  const ids = new Set(tables.map((t) => t.id));
  const build = (compound: boolean) => {
    const g = new dagre.graphlib.Graph({ compound });
    g.setDefaultEdgeLabel(() => ({}));
    // cluster frames are drawn with padding around their tables, so leave more air between nodes
    g.setGraph({ rankdir: dir, nodesep: compound ? 110 : 60, ranksep: horizontal ? (compound ? 280 : 220) : compound ? 190 : 140, marginx: 40, marginy: 40 });
    for (const t of tables) {
      const s = estimateNodeSize(t);
      g.setNode(t.id, { width: s.width, height: s.height });
    }
    if (compound) {
      // Table groups become clusters so their frames do not overlap unrelated tables
      const groups = new Map<string, string[]>();
      for (const t of tables) {
        const name = String((t.data as any)?.group || "");
        if (name) groups.set(name, [...(groups.get(name) || []), t.id]);
      }
      for (const [name, members] of groups) {
        if (members.length < 2) continue;
        const cid = `__grp:${name}`;
        g.setNode(cid, {});
        for (const m of members) g.setParent(m, cid);
      }
    }
    for (const e of edges) {
      if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target);
    }
    return g;
  };
  const hasGroups = tables.some((t) => (t.data as any)?.group);
  let g = build(hasGroups);
  try {
    dagre.layout(g);
    // dagre's cluster support can produce NaN for exotic graphs — fall back to the plain layout then
    if (hasGroups && tables.some((t) => !Number.isFinite(g.node(t.id)?.x))) throw new Error("cluster layout failed");
  } catch {
    g = build(false);
    dagre.layout(g);
  }
  const out = new Map<string, Pt>();
  // when only some nodes are (re)positioned, place them to the right of the existing diagram
  let offsetX = 0;
  if (onlyIds) {
    const fixed = tables.filter((t) => !onlyIds.has(t.id));
    if (fixed.length) offsetX = Math.max(...fixed.map((t) => t.position.x + estimateNodeSize(t).width)) + 120;
  }
  const movedMinX = onlyIds ? Math.min(...tables.filter((t) => onlyIds.has(t.id)).map((t) => g.node(t.id).x - g.node(t.id).width / 2)) : 0;
  for (const t of tables) {
    if (onlyIds && !onlyIds.has(t.id)) continue;
    const p = g.node(t.id);
    out.set(t.id, { x: p.x - p.width / 2 - (onlyIds ? movedMinX : 0) + offsetX, y: p.y - p.height / 2 });
  }
  return out;
}

// ───────────────────────── building blocks ─────────────────────────

const labelOf = (n: Node) => String((n.data as any)?.label ?? n.id);
const groupOf = (n: Node) => String((n.data as any)?.group || "");
const sizeOf = (n: Node) => {
  const s = estimateNodeSize(n);
  return { width: Math.ceil(s.width), height: Math.ceil(s.height) };
};

/** A table on its own, or a table group (its tables arranged inside, with room for the frame). */
interface Unit {
  id: string;
  label: string;
  tables: Node[];
  width: number;
  height: number;
  /** table id → top-left inside the unit */
  offset: Map<string, Pt>;
}
interface Arranged {
  offset: Map<string, Pt>;
  width: number;
  height: number;
}
interface Box {
  id: string;
  width: number;
  height: number;
}

function buildUnits(tables: Node[], edges: Edge[], arrangeGroup: (members: Node[], edges: Edge[]) => Arranged) {
  const units: Unit[] = [];
  const groups = new Map<string, Node[]>();
  for (const t of tables) {
    const g = groupOf(t);
    if (g) groups.set(g, [...(groups.get(g) || []), t]);
    else units.push({ id: t.id, label: labelOf(t), tables: [t], ...sizeOf(t), offset: new Map([[t.id, { x: 0, y: 0 }]]) });
  }
  for (const [name, members] of groups) {
    const ids = new Set(members.map((m) => m.id));
    const inner = arrangeGroup(members, edges.filter((e) => ids.has(e.source) && ids.has(e.target)));
    const offset = new Map<string, Pt>();
    for (const [id, p] of inner.offset) offset.set(id, { x: p.x + GROUP_FRAME_PAD.x, y: p.y + GROUP_FRAME_PAD.top });
    units.push({
      id: `\u0000group:${name}`,
      label: name,
      tables: members,
      width: inner.width + GROUP_FRAME_PAD.x * 2,
      height: inner.height + GROUP_FRAME_PAD.top + GROUP_FRAME_PAD.bottom,
      offset,
    });
  }
  units.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const unitOf = new Map<string, Unit>();
  for (const u of units) for (const t of u.tables) unitOf.set(t.id, u);
  return { units, unitOf };
}

function placeUnits(units: Unit[], at: Map<string, Pt>): Map<string, Pt> {
  const out = new Map<string, Pt>();
  for (const u of units) {
    const p = at.get(u.id);
    if (!p) continue;
    for (const [id, o] of u.offset) out.set(id, { x: Math.round(p.x + o.x), y: Math.round(p.y + o.y) });
  }
  return out;
}

/** Links between units (upstream → downstream), one entry per relationship. */
function unitLinks(edges: Edge[], unitOf: Map<string, Unit>): Array<[string, string]> {
  const links: Array<[string, string]> = [];
  for (const e of edges) {
    const a = unitOf.get(e.source);
    const b = unitOf.get(e.target);
    if (a && b && a !== b) links.push([a.id, b.id]);
  }
  return links;
}

/**
 * Bottom-left skyline packing into a strip `maxWidth` wide: every box goes where it sits lowest (then leftmost).
 * Boxes are placed in the order given; `gap` is kept to the right of and below every box.
 */
function skylinePack(boxes: Box[], maxWidth: number, gap: number): { pos: Map<string, Pt>; width: number; height: number } {
  const stripW = Math.max(maxWidth, ...boxes.map((b) => b.width + gap));
  let sky = [{ x: 0, y: 0, w: stripW }];
  const pos = new Map<string, Pt>();
  let width = 0;
  let height = 0;
  for (const b of boxes) {
    const w = b.width + gap;
    let best: Pt | null = null;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + w > stripW + 0.5) break; // segments are sorted by x, so every later start overflows too
      let y = 0;
      let covered = 0;
      for (let j = i; j < sky.length && covered < w - 0.5; j++) {
        y = Math.max(y, sky[j].y);
        covered += sky[j].w;
      }
      if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y };
    }
    const at = best || { x: 0, y: Math.max(...sky.map((s) => s.y)) };
    pos.set(b.id, at);
    width = Math.max(width, at.x + b.width);
    height = Math.max(height, at.y + b.height);
    // raise the skyline under the box
    const end = at.x + w;
    const next: typeof sky = [];
    for (const s of sky) {
      const sEnd = s.x + s.w;
      if (sEnd <= at.x || s.x >= end) next.push(s);
      else {
        if (s.x < at.x) next.push({ x: s.x, y: s.y, w: at.x - s.x });
        if (sEnd > end) next.push({ x: end, y: s.y, w: sEnd - end });
      }
    }
    next.push({ x: at.x, y: at.y + b.height + gap, w });
    next.sort((p, q) => p.x - q.x);
    sky = [];
    for (const s of next) {
      const last = sky[sky.length - 1];
      if (last && last.y === s.y && Math.abs(last.x + last.w - s.x) < 0.5) last.w += s.w;
      else sky.push({ ...s });
    }
  }
  return { pos, width, height };
}

/** Packs boxes into the smallest rectangle close to `aspect` (width / height), tallest boxes first. */
function packCompact(boxes: Box[], aspect: number, gap: number): { pos: Map<string, Pt>; width: number; height: number } {
  if (boxes.length === 0) return { pos: new Map(), width: 0, height: 0 };
  const sorted = [...boxes].sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id));
  const area = sorted.reduce((s, b) => s + (b.width + gap) * (b.height + gap), 0);
  const ideal = Math.sqrt(area * aspect);
  let best: ({ score: number } & ReturnType<typeof skylinePack>) | null = null;
  for (let f = 0.6; f <= 1.8; f += 0.1) {
    const r = skylinePack(sorted, ideal * f, gap);
    const score = r.width * r.height * (1 + 0.6 * Math.abs(Math.log(r.width / Math.max(1, r.height) / aspect)));
    if (!best || score < best.score) best = { ...r, score };
  }
  return best!;
}

const packGroup = (members: Node[]): Arranged => {
  const r = packCompact(members.map((m) => ({ id: m.id, ...sizeOf(m) })), 1.3, INNER_GAP);
  return { offset: r.pos, width: r.width, height: r.height };
};

/**
 * Longest-path layering of a directed graph: sources get layer 0, every other node one more than its furthest
 * predecessor. Edges that close a cycle are ignored. Sources are then pulled right, next to their first consumer, so a
 * lookup table used by a late stage does not sit alone at the far left.
 */
function layersOf(ids: string[], links: Array<[string, string]>): Map<string, number> {
  const succ = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of links) if (a !== b && succ.has(a) && succ.has(b) && !succ.get(a)!.includes(b)) succ.get(a)!.push(b);
  // DFS in a fixed order; an edge back to a node still on the stack closes a cycle and is dropped
  const state = new Map<string, 1 | 2>();
  const kept = new Map(ids.map((id) => [id, [] as string[]]));
  const visit = (v: string) => {
    state.set(v, 1);
    for (const w of succ.get(v)!) {
      if (state.get(w) === 1) continue;
      kept.get(v)!.push(w);
      if (!state.get(w)) visit(w);
    }
    state.set(v, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const w of kept.get(id)!) indeg.set(w, indeg.get(w)! + 1);
  const hasPred = new Set(ids.filter((id) => indeg.get(id)! > 0));
  const layer = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const topo: string[] = [];
  while (queue.length) {
    const v = queue.shift()!;
    topo.push(v);
    for (const w of kept.get(v)!) {
      layer.set(w, Math.max(layer.get(w)!, layer.get(v)! + 1));
      indeg.set(w, indeg.get(w)! - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  for (const v of topo.reverse()) {
    const next = kept.get(v)!;
    if (hasPred.has(v) || !next.length) continue;
    layer.set(v, Math.max(layer.get(v)!, Math.min(...next.map((w) => layer.get(w)!)) - 1));
  }
  return layer;
}

// ───────────────────────── pipeline ─────────────────────────

function pipelineLayout(tables: Node[], edges: Edge[]): Map<string, Pt> {
  // a group is one stage: its tables stacked top to bottom in lineage order
  const stack = (members: Node[], inner: Edge[]): Arranged => {
    const layer = layersOf(members.map((m) => m.id), inner.map((e) => [e.source, e.target] as [string, string]));
    const ordered = [...members].sort((a, b) => layer.get(a.id)! - layer.get(b.id)! || labelOf(a).localeCompare(labelOf(b)));
    const offset = new Map<string, Pt>();
    let y = 0;
    let width = 0;
    for (const m of ordered) {
      const s = sizeOf(m);
      offset.set(m.id, { x: 0, y });
      y += s.height + INNER_GAP;
      width = Math.max(width, s.width);
    }
    return { offset, width, height: y - INNER_GAP };
  };
  const { units, unitOf } = buildUnits(tables, edges, stack);
  const links = unitLinks(edges, unitOf);
  const linked = new Set(links.flat());
  const flowing = units.filter((u) => linked.has(u.id));
  const loose = units.filter((u) => !linked.has(u.id));

  const layer = layersOf(flowing.map((u) => u.id), links);
  const columns: Unit[][] = [];
  for (const u of flowing) (columns[layer.get(u.id)!] ||= []).push(u);
  const cols = columns.filter(Boolean);

  // order each stage by the average position of its neighbours in the stages around it (fewer crossing lines)
  const preds = new Map(flowing.map((u) => [u.id, [] as string[]]));
  const succs = new Map(flowing.map((u) => [u.id, [] as string[]]));
  for (const [a, b] of links) {
    preds.get(b)!.push(a);
    succs.get(a)!.push(b);
  }
  const rank = new Map<string, number>();
  const rerank = () => cols.forEach((col) => col.forEach((u, i) => rank.set(u.id, (i + 0.5) / col.length)));
  const centre = (u: Unit, near: string[]) => (near.length ? near.reduce((s, id) => s + rank.get(id)!, 0) / near.length : rank.get(u.id)!);
  rerank();
  for (let pass = 0; pass < 4; pass++) {
    for (let c = 1; c < cols.length; c++) {
      const key = new Map(cols[c].map((u) => [u.id, centre(u, preds.get(u.id)!)]));
      cols[c].sort((a, b) => key.get(a.id)! - key.get(b.id)!);
      rerank();
    }
    for (let c = cols.length - 2; c >= 0; c--) {
      const key = new Map(cols[c].map((u) => [u.id, centre(u, succs.get(u.id)!)]));
      cols[c].sort((a, b) => key.get(a.id)! - key.get(b.id)!);
      rerank();
    }
  }

  const at = new Map<string, Pt>();
  let x = 0;
  let bottom = 0;
  for (const col of cols) {
    let y = 0;
    let width = 0;
    for (const u of col) {
      at.set(u.id, { x, y });
      y += u.height + GAP;
      width = Math.max(width, u.width);
    }
    bottom = Math.max(bottom, y - GAP);
    x += width + STAGE_GAP;
  }
  // tables without any relationship have no place in the flow: packed underneath it
  if (loose.length) {
    const packed = packCompact(loose.map((u) => ({ id: u.id, width: u.width, height: u.height })), ASPECT, GAP);
    const top = flowing.length ? bottom + GAP * 2 : 0;
    for (const u of loose) {
      const p = packed.pos.get(u.id)!;
      at.set(u.id, { x: p.x, y: p.y + top });
    }
  }
  return placeUnits(units, at);
}

// ───────────────────────── domains (the default for new diagrams) ─────────────────────────

const LAYER_GAP = 110; // between relationship layers inside a block — room for the step lines and their markers
const BLOCK_GAP = 96; // between blocks (group frames, clusters)
const WIDESCREEN = 16 / 9;
const GROUP_BLOCK_ASPECT = 1.1; // target width / height of a group's own arrangement (layer gaps widen it a little)

/**
 * Lays tables out left to right along their relationships. A layer taller than the block's target height wraps into
 * extra columns, so a parent with a dozen children does not become one tall strip; within a layer, tables follow the
 * average height of their parents (fewer crossing lines).
 */
function layeredBlock(members: Node[], inner: Edge[], aspect: number): Arranged {
  if (!inner.length) {
    const r = packCompact(members.map((m) => ({ id: m.id, ...sizeOf(m) })), aspect, INNER_GAP);
    return { offset: r.pos, width: r.width, height: r.height };
  }
  const ids = members.map((m) => m.id);
  const links = inner.map((e) => [e.source, e.target] as [string, string]);
  const layer = layersOf(ids, links);
  const sizes = new Map(members.map((m) => [m.id, sizeOf(m)]));
  const area = members.reduce((s, m) => s + (sizes.get(m.id)!.width + LAYER_GAP) * (sizes.get(m.id)!.height + INNER_GAP), 0);
  const maxH = Math.max(Math.sqrt(area / aspect), ...members.map((m) => sizes.get(m.id)!.height));
  const preds = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of links) if (a !== b && preds.has(b)) preds.get(b)!.push(a);

  const columns: Node[][] = [];
  for (const m of members) (columns[layer.get(m.id)!] ||= []).push(m);
  const centreY = new Map<string, number>();
  const offset = new Map<string, Pt>();
  let x = 0;
  let height = 0;
  for (const col of columns.filter(Boolean)) {
    const key = (m: Node) => {
      const placed = preds.get(m.id)!.filter((p) => centreY.has(p));
      return placed.length ? placed.reduce((s, p) => s + centreY.get(p)!, 0) / placed.length : 1e9;
    };
    col.sort((a, b) => key(a) - key(b) || labelOf(a).localeCompare(labelOf(b)));
    let y = 0;
    let colX = x;
    let colW = 0;
    for (const m of col) {
      const s = sizes.get(m.id)!;
      if (y > 0 && y + s.height > maxH) {
        colX += colW + INNER_GAP; // wrap into the next sub-column
        y = 0;
        colW = 0;
      }
      offset.set(m.id, { x: colX, y });
      centreY.set(m.id, y + s.height / 2);
      height = Math.max(height, y + s.height);
      y += s.height + INNER_GAP;
      colW = Math.max(colW, s.width);
    }
    x = colX + colW + LAYER_GAP;
  }
  return { offset, width: x - LAYER_GAP, height };
}

/** Like packCompact, but keeps the boxes' order: each lands as high (then as far left) as it fits, after the ones before it. */
function packInOrder(boxes: Box[], aspect: number, gap: number): { pos: Map<string, Pt>; width: number; height: number } {
  if (boxes.length === 0) return { pos: new Map(), width: 0, height: 0 };
  const area = boxes.reduce((s, b) => s + (b.width + gap) * (b.height + gap), 0);
  const ideal = Math.sqrt(area * aspect);
  let best: ({ score: number } & ReturnType<typeof skylinePack>) | null = null;
  for (let f = 0.5; f <= 2.01; f += 0.05) {
    const r = skylinePack(boxes, ideal * f, gap);
    // the closest to the target shape, then the least wasted area
    const score = r.width * r.height * (1 + 1.5 * Math.abs(Math.log(r.width / Math.max(1, r.height) / aspect)));
    if (!best || score < best.score) best = { ...r, score };
  }
  return best!;
}

/**
 * Domains: every table group — and, outside groups, every cluster of tables linked by their own relationships — is laid
 * out left to right inside a block; the blocks are packed into a widescreen (16:9) rectangle, the block holding the hub
 * tables first and each next block placed after the ones it shares the most relationships with. Relationships to hub
 * tables (lib/model/hubs: tenants, users …) are left out of the arrangement: a table linked to everything would put
 * every table one step from it and stack the whole diagram into a single tall column.
 */
function domainsLayout(tables: Node[], edges: Edge[]): Map<string, Pt> {
  const hubInfo = detectHubs(tables, edges);
  const local = edges.filter((e) => !hubInfo.hubEdgeIds.has(e.id) && e.source !== e.target);
  const units: Unit[] = [];
  const add = (id: string, label: string, members: Node[], arranged: Arranged, framed: boolean) => {
    const pad = framed ? GROUP_FRAME_PAD : { x: 0, top: 0, bottom: 0 };
    const offset = new Map<string, Pt>();
    for (const [tid, p] of arranged.offset) offset.set(tid, { x: p.x + pad.x, y: p.y + pad.top });
    units.push({ id, label, tables: members, width: arranged.width + pad.x * 2, height: arranged.height + pad.top + pad.bottom, offset });
  };
  const inside = (members: Node[]) => {
    const ids = new Set(members.map((m) => m.id));
    return local.filter((e) => ids.has(e.source) && ids.has(e.target));
  };

  // table groups: one framed block each
  const groups = new Map<string, Node[]>();
  for (const t of tables) if (groupOf(t)) groups.set(groupOf(t), [...(groups.get(groupOf(t)) || []), t]);
  for (const [name, members] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) add(`\u0000group:${name}`, name, members, layeredBlock(members, inside(members), GROUP_BLOCK_ASPECT), true);

  // outside groups: the hubs side by side; the rest clustered by their own relationships (union-find)
  const loose = tables.filter((t) => !groupOf(t));
  const hubs = loose.filter((t) => hubInfo.hubs.has(t.id));
  if (hubs.length) add("\u0000hubs", "", hubs, layeredBlock(hubs, [], 4), false);
  const rest = loose.filter((t) => !hubInfo.hubs.has(t.id));
  const parent = new Map(rest.map((t) => [t.id, t.id]));
  const find = (a: string): string => (parent.get(a) === a ? a : (parent.set(a, find(parent.get(a)!)), parent.get(a)!));
  for (const e of local) if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target));
  const clusters = new Map<string, Node[]>();
  for (const t of rest) clusters.set(find(t.id), [...(clusters.get(find(t.id)) || []), t]);
  const singles: Node[] = [];
  for (const members of [...clusters.values()].sort((a, b) => b.length - a.length || labelOf(a[0]).localeCompare(labelOf(b[0])))) {
    if (members.length === 1) singles.push(members[0]);
    else add(`\u0000cluster:${members[0].id}`, labelOf(members[0]), members, layeredBlock(members, inside(members), 1.6), false);
  }
  if (singles.length) add("\u0000singles", "", singles, layeredBlock(singles, [], 1.6), false);

  // order: the hub block first, then always the block most connected to those already placed
  const unitOf = new Map<string, Unit>();
  for (const u of units) for (const t of u.tables) unitOf.set(t.id, u);
  const weight = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => weight.set(a, new Map(weight.get(a) || []).set(b, (weight.get(a)?.get(b) || 0) + 1));
  for (const [a, b] of unitLinks(local, unitOf)) {
    bump(a, b);
    bump(b, a);
  }
  const hubCount = (u: Unit) => u.tables.filter((t) => hubInfo.hubs.has(t.id)).length;
  const areaOf = (u: Unit) => u.width * u.height;
  const ordered: Unit[] = [];
  const left = new Set(units);
  const first = [...left].sort((a, b) => hubCount(b) - hubCount(a) || areaOf(b) - areaOf(a) || a.label.localeCompare(b.label))[0];
  while (left.size) {
    let next = ordered.length ? null : first;
    if (!next) {
      let bestW = -1;
      for (const u of left) {
        const w = ordered.reduce((s, p) => s + (weight.get(u.id)?.get(p.id) || 0), 0);
        if (w > bestW || (w === bestW && next && (areaOf(u) > areaOf(next) || (areaOf(u) === areaOf(next) && u.label.localeCompare(next.label) < 0)))) {
          bestW = w;
          next = u;
        }
      }
    }
    ordered.push(next!);
    left.delete(next!);
  }

  const packed = packInOrder(ordered.map((u) => ({ id: u.id, width: u.width, height: u.height })), WIDESCREEN, BLOCK_GAP);
  return placeUnits(units, packed.pos);
}

// ───────────────────────── snowflake ─────────────────────────

const RING_STRETCH = 1.3; // rings are ellipses, wider than tall — screens are landscape

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const rectAround = (u: Unit, c: Pt): Rect => ({ x: c.x - u.width / 2, y: c.y - u.height / 2, w: u.width, h: u.height });
const clash = (a: Rect, b: Rect) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

function snowflakeLayout(tables: Node[], edges: Edge[]): Map<string, Pt> {
  const { units, unitOf } = buildUnits(tables, edges, packGroup);
  const byId = new Map(units.map((u) => [u.id, u]));
  const adj = new Map(units.map((u) => [u.id, new Map<string, number>()]));
  for (const [a, b] of unitLinks(edges, unitOf)) {
    adj.get(a)!.set(b, (adj.get(a)!.get(b) || 0) + 1);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) || 0) + 1);
  }
  const degree = (id: string) => [...adj.get(id)!.values()].reduce((s, n) => s + n, 0);
  const byImportance = (a: Unit, b: Unit) => degree(b.id) - degree(a.id) || b.tables.length - a.tables.length || a.label.localeCompare(b.label);

  // every connected part is laid out around its most connected table (or group)
  const seen = new Set<string>();
  const parts: { units: Unit[]; centres: Map<string, Pt> }[] = [];
  for (const hub of [...units].sort(byImportance)) {
    if (seen.has(hub.id)) continue;
    seen.add(hub.id);
    const rings: Unit[][] = [[hub]];
    const parent = new Map<string, string>();
    for (let d = 0; rings[d]?.length; d++) {
      for (const v of rings[d]) {
        const near = [...adj.get(v.id)!.entries()]
          .map(([id, w]) => ({ u: byId.get(id)!, w }))
          .sort((p, q) => q.w - p.w || byImportance(p.u, q.u));
        for (const { u } of near) {
          if (seen.has(u.id)) continue;
          seen.add(u.id);
          parent.set(u.id, v.id);
          (rings[d + 1] ||= []).push(u);
        }
      }
    }
    parts.push({ units: rings.flat(), centres: ringLayout(rings, parent) });
  }

  // the parts (lone tables included) packed side by side, the biggest first
  const boxes: Box[] = [];
  const origin = new Map<string, Pt>();
  parts.forEach((p, i) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const u of p.units) {
      const r = rectAround(u, p.centres.get(u.id)!);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    }
    boxes.push({ id: String(i), width: maxX - minX, height: maxY - minY });
    origin.set(String(i), { x: minX, y: minY });
  });
  const packed = packCompact(boxes, ASPECT, GAP * 2);
  const at = new Map<string, Pt>();
  parts.forEach((p, i) => {
    const o = origin.get(String(i))!;
    const q = packed.pos.get(String(i))!;
    for (const u of p.units) {
      const c = p.centres.get(u.id)!;
      at.set(u.id, { x: q.x + c.x - u.width / 2 - o.x, y: q.y + c.y - u.height / 2 - o.y });
    }
  });
  return placeUnits(units, at);
}

/** Centres for one connected part: the hub at the origin, BFS ring k on the k-th ellipse, children near their parent. */
function ringLayout(rings: Unit[][], parent: Map<string, string>): Map<string, Pt> {
  const centres = new Map<string, Pt>();
  const angle = new Map<string, number>();
  const placed: Rect[] = [];
  const hub = rings[0][0];
  centres.set(hub.id, { x: 0, y: 0 });
  angle.set(hub.id, 0);
  placed.push(rectAround(hub, { x: 0, y: 0 }));
  const TAU = Math.PI * 2;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  let radius = 0;
  for (let k = 1; k < rings.length; k++) {
    const ring = [...rings[k]].sort((a, b) => norm(angle.get(parent.get(a.id)!)!) - norm(angle.get(parent.get(b.id)!)!));
    const n = ring.length;
    const step = TAU / n;
    // rotate the ring so each table sits as close as possible to its parent's direction
    let offset: number;
    if (k === 1) offset = n <= 2 ? 0 : -Math.PI / 2;
    else {
      let sx = 0;
      let sy = 0;
      ring.forEach((u, i) => {
        const a = angle.get(parent.get(u.id)!)! - i * step;
        sx += Math.cos(a);
        sy += Math.sin(a);
      });
      offset = Math.abs(sx) + Math.abs(sy) < 1e-9 ? 0 : Math.atan2(sy, sx);
    }
    // the smallest ellipse on which the ring clears itself and everything inside it
    for (let r = radius + 80; ; r += Math.max(24, r * 0.03)) {
      const cand = ring.map((u, i) => {
        const a = offset + i * step;
        const c = { x: Math.cos(a) * r * RING_STRETCH, y: Math.sin(a) * r };
        return { u, a, c, rect: rectAround(u, c) };
      });
      const free = cand.every((p, i) => !placed.some((q) => clash(p.rect, q)) && !cand.some((q, j) => j > i && clash(p.rect, q.rect)));
      if (!free) continue;
      for (const p of cand) {
        centres.set(p.u.id, p.c);
        angle.set(p.u.id, p.a);
        placed.push(p.rect);
      }
      radius = r;
      break;
    }
  }
  return centres;
}

// ───────────────────────── compact ─────────────────────────

function compactLayout(tables: Node[], edges: Edge[]): Map<string, Pt> {
  const { units } = buildUnits(tables, edges, packGroup);
  const packed = packCompact(units.map((u) => ({ id: u.id, width: u.width, height: u.height })), ASPECT, GAP);
  return placeUnits(units, packed.pos);
}

/** Bounding box of a set of nodes (uses measured sizes when available). */
export function boundsOf(nodes: Node[]): { x: number; y: number; width: number; height: number } | null {
  if (!nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const s = estimateNodeSize(n);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + s.width);
    maxY = Math.max(maxY, n.position.y + s.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
