/**
 * Table groups (DBML `TableGroup`) as plain data operations: a table's group is `data.group`, a group's colour / note /
 * collapsed state live in `meta.groups[name]`. The Groups drawer, the canvas selection bar (Ctrl+G) and dropping a table
 * onto a group frame all go through these, so they agree on naming rules and leave views pointing at the right groups.
 */
import type { Node } from "@xyflow/react";
import { isTableNode } from "./canvasAdapter";
import type { GroupMeta, ProjectMeta } from "./types";
import { GROUP_FRAME_PAD, estimateNodeSize } from "../layout";

/** The swatches offered for a group (the same set as the frame's own colour picker). */
export const GROUP_COLORS = ["#4A90D9", "#8B5CF6", "#10B981", "#F87171", "#F59E0B", "#06B6D4", "#EC4899", "#84CC16"];

export interface GroupSummary {
  name: string;
  color: string;
  note: string;
  collapsed: boolean;
  tableIds: string[];
}

export const groupOf = (n: Node): string => String((n.data as any)?.group || "");

/** Every group that has at least one table, alphabetically, with its members in canvas order. */
export function listGroups(nodes: Node[], meta: ProjectMeta): GroupSummary[] {
  const members = new Map<string, string[]>();
  for (const n of nodes) {
    if (!isTableNode(n)) continue;
    const g = groupOf(n);
    if (!g) continue;
    if (!members.has(g)) members.set(g, []);
    members.get(g)!.push(n.id);
  }
  return [...members.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, tableIds]) => {
      const gm: GroupMeta = meta.groups[name] || {};
      return { name, color: gm.color || GROUP_COLORS[0], note: gm.note || "", collapsed: !!gm.collapsed, tableIds };
    });
}

/** Group names compare case-insensitively ("Billing" and "billing" would export as one TableGroup). */
export function isGroupNameTaken(nodes: Node[], meta: ProjectMeta, name: string, except?: string): boolean {
  const want = name.trim().toLowerCase();
  if (except && except.toLowerCase() === want) return false;
  return listGroups(nodes, meta).some((g) => g.name.toLowerCase() === want);
}

/** Why a name can't be used, or null when it can. */
export function groupNameProblem(nodes: Node[], meta: ProjectMeta, name: string, except?: string): string | null {
  const t = name.trim();
  if (!t) return "Name the group";
  if (t.length > 64) return "Keep the name under 64 characters";
  if (isGroupNameTaken(nodes, meta, t, except)) return `A group named “${t}” already exists`;
  return null;
}

/** The next colour no group uses yet (cycling once every swatch is taken). */
export function nextGroupColor(nodes: Node[], meta: ProjectMeta): string {
  const used = new Set(listGroups(nodes, meta).map((g) => g.color.toLowerCase()));
  return GROUP_COLORS.find((c) => !used.has(c.toLowerCase())) || GROUP_COLORS[listGroups(nodes, meta).length % GROUP_COLORS.length];
}

/** Puts tables into `group` ("" takes them out of any group). Nodes that are not tables, or already there, are kept as-is. */
export function assignGroup(nodes: Node[], ids: Iterable<string>, group: string): Node[] {
  const want = new Set(ids);
  return nodes.map((n) => (want.has(n.id) && isTableNode(n) && groupOf(n) !== group ? { ...n, data: { ...n.data, group } } : n));
}

/** A new group with these tables (moved out of any group they were in). Returns null when the name or selection is not usable. */
export function createGroup(nodes: Node[], meta: ProjectMeta, name: string, ids: string[], color?: string): { nodes: Node[]; meta: ProjectMeta } | null {
  const t = name.trim();
  if (groupNameProblem(nodes, meta, t)) return null;
  const tables = ids.filter((id) => nodes.some((n) => n.id === id && isTableNode(n)));
  if (!tables.length) return null;
  const gm: GroupMeta = { ...(meta.groups[t] || {}), color: color || nextGroupColor(nodes, meta) };
  return { nodes: assignGroup(nodes, tables, t), meta: { ...meta, groups: { ...meta.groups, [t]: gm } } };
}

/** Renames a group everywhere: its tables, its settings and the diagram views that list it. */
export function renameGroup(nodes: Node[], meta: ProjectMeta, from: string, to: string): { nodes: Node[]; meta: ProjectMeta } | null {
  const t = to.trim();
  if (!t || t === from || groupNameProblem(nodes, meta, t, from)) return null;
  const { [from]: settings, ...rest } = meta.groups;
  return {
    nodes: nodes.map((n) => (isTableNode(n) && groupOf(n) === from ? { ...n, data: { ...n.data, group: t } } : n)),
    meta: { ...meta, groups: { ...rest, [t]: settings || {} }, views: meta.views.map((v) => ({ ...v, groups: v.groups.map((g) => (g === from ? t : g)) })) },
  };
}

/** Changes a group's colour / note / collapsed state, dropping empty fields so saved meta stays small. */
export function patchGroupMeta(meta: ProjectMeta, name: string, patch: Partial<GroupMeta>): ProjectMeta {
  const next: GroupMeta = { ...(meta.groups[name] || {}), ...patch };
  if (!next.color) delete next.color;
  if (!next.note) delete next.note;
  if (!next.collapsed) delete next.collapsed;
  return { ...meta, groups: { ...meta.groups, [name]: next } };
}

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect, margin = 0) => a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
const rectOf = (n: Node): Rect => {
  const s = estimateNodeSize(n);
  return { x: n.position.x, y: n.position.y, w: s.width, h: s.height };
};
/** The frame drawn around these tables (the same box displayGraph draws). */
function frameAround(members: Node[]): Rect {
  const rs = members.map(rectOf);
  const x = Math.min(...rs.map((r) => r.x)) - GROUP_FRAME_PAD.x;
  const y = Math.min(...rs.map((r) => r.y)) - GROUP_FRAME_PAD.top;
  const right = Math.max(...rs.map((r) => r.x + r.w)) + GROUP_FRAME_PAD.x;
  const bottom = Math.max(...rs.map((r) => r.y + r.h)) + GROUP_FRAME_PAD.bottom;
  return { x, y, w: right - x, h: bottom - y };
}

/** Tables (ids) that sit under a group's frame without being in the group — it would look as if they belonged to it. */
export function tablesUnderFrame(nodes: Node[], group: string): string[] {
  const members = nodes.filter((n) => isTableNode(n) && groupOf(n) === group);
  if (!members.length) return [];
  const frame = frameAround(members);
  return nodes.filter((n) => isTableNode(n) && groupOf(n) !== group && overlaps(frame, rectOf(n))).map((n) => n.id);
}

const GATHER_GAP_X = 72;
const GATHER_GAP_Y = 56;
const GATHER_CLEARANCE = 40;

/**
 * Grouping tables that are spread across the canvas would draw a frame over everything between them. When that happens
 * the group's tables are gathered into a compact block (in their reading order) — where the group already starts if
 * that spot is free, else beside the diagram — so the frame only ever contains its own tables. Untouched when the
 * frame covers nothing else, or when the group is collapsed into a card.
 */
export function gatherGroup(nodes: Node[], meta: ProjectMeta, group: string): Node[] {
  if (meta.groups[group]?.collapsed || !tablesUnderFrame(nodes, group).length) return nodes;
  const members = nodes.filter((n) => isTableNode(n) && groupOf(n) === group).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const sizes = members.map((m) => estimateNodeSize(m));
  const cols = Math.max(1, Math.min(members.length, Math.ceil(Math.sqrt(members.length * 1.6))));
  const offsets: { x: number; y: number }[] = [];
  let y = 0;
  let blockW = 0;
  for (let r = 0; r * cols < members.length; r++) {
    let x = 0;
    let rowH = 0;
    for (let c = 0; c < cols && r * cols + c < members.length; c++) {
      const s = sizes[r * cols + c];
      offsets.push({ x, y });
      x += s.width + GATHER_GAP_X;
      rowH = Math.max(rowH, s.height);
    }
    blockW = Math.max(blockW, x - GATHER_GAP_X);
    y += rowH + GATHER_GAP_Y;
  }
  const blockH = y - GATHER_GAP_Y;

  // everything the gathered frame must stay clear of: other tables, and the frames of other groups
  const memberIds = new Set(members.map((m) => m.id));
  const others = nodes.filter((n) => isTableNode(n) && !memberIds.has(n.id));
  const obstacles: Rect[] = others.map(rectOf);
  const otherGroups = new Set(others.map(groupOf).filter(Boolean));
  for (const g of otherGroups) obstacles.push(frameAround(others.filter((n) => groupOf(n) === g)));
  const frameAt = (p: { x: number; y: number }): Rect => ({ x: p.x - GROUP_FRAME_PAD.x, y: p.y - GROUP_FRAME_PAD.top, w: blockW + GROUP_FRAME_PAD.x * 2, h: blockH + GROUP_FRAME_PAD.top + GROUP_FRAME_PAD.bottom });
  const free = (p: { x: number; y: number }) => !obstacles.some((o) => overlaps(frameAt(p), o, GATHER_CLEARANCE));

  const start = { x: Math.min(...members.map((m) => m.position.x)), y: Math.min(...members.map((m) => m.position.y)) };
  const all = obstacles.length ? obstacles : [frameAt(start)];
  const right = Math.max(...all.map((o) => o.x + o.w)) + GATHER_CLEARANCE + GROUP_FRAME_PAD.x + 40;
  const below = Math.max(...all.map((o) => o.y + o.h)) + GATHER_CLEARANCE + GROUP_FRAME_PAD.top + 40;
  const candidates = [start, { x: right, y: start.y }, { x: start.x, y: below }, { x: right, y: Math.min(...all.map((o) => o.y)) + GROUP_FRAME_PAD.top }];
  const at = candidates.find(free) ?? candidates[1];
  const placed = new Map(members.map((m, i) => [m.id, { x: Math.round(at.x + offsets[i].x), y: Math.round(at.y + offsets[i].y) }]));
  return nodes.map((n) => (placed.has(n.id) ? { ...n, position: placed.get(n.id)! } : n));
}

/**
 * Takes tables out of their groups. A table that would still sit under its old group's frame (it was in the middle of
 * the group) is moved just below the frame, so it no longer looks like a member.
 */
export function ungroupTables(nodes: Node[], ids: string[]): Node[] {
  const leaving = nodes.filter((n) => ids.includes(n.id) && isTableNode(n) && groupOf(n));
  let out = assignGroup(nodes, ids, "");
  for (const t of leaving) {
    const from = groupOf(t);
    const rest = out.filter((n) => isTableNode(n) && groupOf(n) === from);
    const me = out.find((n) => n.id === t.id)!;
    if (!rest.length) continue;
    const frame = frameAround(rest);
    const r = rectOf(me);
    if (!overlaps(frame, r)) continue;
    const blockers = out.filter((n) => isTableNode(n) && n.id !== t.id).map(rectOf);
    const fits = (p: { x: number; y: number }) => !blockers.some((b) => overlaps({ ...r, ...p }, b, GATHER_CLEARANCE / 2)) && !overlaps({ ...r, ...p }, frame, GATHER_CLEARANCE / 2);
    let spot: { x: number; y: number } | undefined;
    for (let i = 0; i < 8 && !spot; i++) {
      const p = { x: Math.round(frame.x + i * (r.w + GATHER_GAP_X)), y: Math.round(frame.y + frame.h + GATHER_CLEARANCE) };
      if (fits(p)) spot = p;
    }
    spot ??= { x: Math.round(frame.x), y: Math.round(Math.max(...blockers.map((b) => b.y + b.h), frame.y + frame.h) + GATHER_CLEARANCE * 2) };
    out = out.map((n) => (n.id === t.id ? { ...n, position: spot! } : n));
  }
  return out;
}

/**
 * The expanded group frame under a canvas point (a table being dragged), ignoring `except` — the table's own group,
 * whose frame grows to follow it. When frames overlap the smallest wins, as it is the one drawn on top visually.
 */
export function groupFrameAt(frames: Node[], point: { x: number; y: number }, except?: string): string | null {
  let best: { name: string; area: number } | null = null;
  for (const f of frames) {
    if (f.type !== "tableGroup" || (f.data as any)?.collapsed) continue;
    const name = String((f.data as any)?.label || "");
    if (!name || name === except) continue;
    const w = Number((f as any).width ?? (f.style as any)?.width ?? 0);
    const h = Number((f as any).height ?? (f.style as any)?.height ?? 0);
    const { x, y } = f.position;
    if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) continue;
    if (!best || w * h < best.area) best = { name, area: w * h };
  }
  return best?.name ?? null;
}
