/**
 * Display layer: turns the persisted graph (nodes/edges = source of truth) into what React Flow renders.
 *
 * It applies, without mutating the source graph:
 *   - Diagram Views (named subsets of tables/groups/schemas)
 *   - "hide by colour" (ERDLab)
 *   - relationship visibility toggle
 *   - hub connections: lines to hub tables (tenants, users — lib/model/hubs) hidden unless meta.showHubEdges, except
 *     for a selected table, whose own lines always show
 *   - Table Groups: dashed frames around members, or a single collapsed card with re-routed edges
 */
import type { Edge, Node } from "@xyflow/react";
import { DiagramViewModel, ProjectMeta, normalizeMeta, tableKey } from "./types";
import { GROUP_FRAME_PAD, estimateNodeSize } from "../layout";
import { isDepEdge, isTableNode, nodeKey } from "./canvasAdapter";
import { HubInfo, detectHubs } from "./hubs";

export const GROUP_NODE_PREFIX = "grp:";
export const NO_COLOR_TOKEN = "none";

export function isGroupNodeId(id: string): boolean {
  return id.startsWith(GROUP_NODE_PREFIX);
}
export function groupNameFromId(id: string): string {
  return id.slice(GROUP_NODE_PREFIX.length);
}

export function activeView(meta: ProjectMeta): DiagramViewModel | null {
  if (!meta.activeViewId) return null;
  return meta.views.find((v) => v.id === meta.activeViewId) || null;
}

export function isTableInView(view: DiagramViewModel | null, node: Node): boolean {
  if (!view) return true;
  if (view.tables === "*") return true;
  const d = node.data as any;
  const tables = view.tables as string[];
  if (!tables.length && !view.groups.length && !view.schemas.length) return true; // an empty view shows everything
  const key = nodeKey(node);
  if (tables.includes(key) || tables.includes(String(d.label))) return true;
  if (d.group && view.groups.includes(d.group)) return true;
  if (view.schemas.includes(d.schema || "public")) return true;
  return false;
}

export function colorKey(node: Node): string {
  const c = String((node.data as any).color || "").trim().toLowerCase();
  return c || NO_COLOR_TOKEN;
}

/** Table ids that should be hidden because of the active view or hidden colours. */
export function hiddenTableIds(nodes: Node[], meta: ProjectMeta): Set<string> {
  const view = activeView(meta);
  const hiddenColors = new Set(meta.hiddenColors.map((c) => c.toLowerCase()));
  const hidden = new Set<string>();
  for (const n of nodes) {
    if (!isTableNode(n)) continue;
    if (!isTableInView(view, n)) hidden.add(n.id);
    else if (hiddenColors.size && hiddenColors.has(colorKey(n))) hidden.add(n.id);
    else if (n.hidden) hidden.add(n.id); // legacy per-node flag
  }
  return hidden;
}

export interface DisplayGraph {
  nodes: Node[];
  edges: Edge[];
  /** table id → group card id it is currently folded into */
  foldedInto: Map<string, string>;
  /** relationship lines to hub tables currently hidden (0 when hub connections are shown) */
  hiddenHubEdges: number;
}

// Frame nodes are re-created on every nodes/meta change (selection included). React Flow drops `measured` on a new node
// object and renders it `visibility: hidden` — invisible AND click-through, so the title-bar buttons (edit / ungroup /
// collapse) were dead for a few seconds after almost any interaction — until it is measured again. Giving each frame
// dimensions up front means it is never in that state.
const COLLAPSED_CARD_W = 320;
const COLLAPSED_CARD_H = 44; // title bar; the real height is measured afterwards

// shared with the auto-arrange algorithms, which leave exactly this much room around a group's tables
const { x: PAD_X, top: PAD_TOP, bottom: PAD_BOTTOM } = GROUP_FRAME_PAD;

/** `opts.hubs` can be passed in when the caller keeps it memoised (it only changes when tables or relationships do). */
export function buildDisplayGraph(nodes: Node[], edges: Edge[], metaInput: Partial<ProjectMeta> | null | undefined, opts: { hubs?: HubInfo } = {}): DisplayGraph {
  const meta = normalizeMeta(metaInput ?? {});
  const hubs = opts.hubs ?? detectHubs(nodes, edges);
  const selected = new Set(nodes.filter((n) => n.selected && isTableNode(n)).map((n) => n.id));
  const hidden = hiddenTableIds(nodes, meta);
  const outNodes: Node[] = [];
  const foldedInto = new Map<string, string>();

  // members per group (visible ones only)
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    if (!isTableNode(n) || hidden.has(n.id)) continue;
    const g = String((n.data as any).group || "");
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(n);
  }

  const frames: Node[] = [];
  for (const [name, members] of groups) {
    const gm = meta.groups[name] || {};
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const s = estimateNodeSize(m);
      minX = Math.min(minX, m.position.x);
      minY = Math.min(minY, m.position.y);
      maxX = Math.max(maxX, m.position.x + s.width);
      maxY = Math.max(maxY, m.position.y + s.height);
    }
    const tableNames = members.map((m) => String((m.data as any).label));
    const base = { label: name, color: gm.color || "", note: gm.note || "", count: members.length, tables: tableNames };
    if (gm.collapsed) {
      for (const m of members) foldedInto.set(m.id, GROUP_NODE_PREFIX + name);
      frames.push({
        id: GROUP_NODE_PREFIX + name,
        type: "tableGroup",
        position: { x: minX, y: minY },
        style: { width: COLLAPSED_CARD_W },
        initialWidth: COLLAPSED_CARD_W,
        initialHeight: COLLAPSED_CARD_H,
        data: { ...base, collapsed: true },
        deletable: false,
        selectable: true,
        draggable: true,
      } as Node);
    } else {
      const width = maxX - minX + PAD_X * 2;
      const height = maxY - minY + PAD_TOP + PAD_BOTTOM;
      frames.push({
        id: GROUP_NODE_PREFIX + name,
        type: "tableGroup",
        position: { x: minX - PAD_X, y: minY - PAD_TOP },
        style: { width, height },
        width,
        height,
        data: { ...base, collapsed: false },
        zIndex: -1,
        deletable: false,
        selectable: true,
        draggable: true,
      } as Node);
    }
  }

  for (const n of nodes) {
    if (isTableNode(n)) {
      const hide = hidden.has(n.id) || foldedInto.has(n.id);
      outNodes.push(!!n.hidden === hide ? n : { ...n, hidden: hide });
    } else outNodes.push(n);
  }
  // frames first so they render underneath their tables
  const nodesOut = [...frames.filter((f) => !(f.data as any).collapsed), ...outNodes, ...frames.filter((f) => (f.data as any).collapsed)];

  // edges
  const showRefs = meta.showRelationships;
  let hiddenHubEdges = 0;
  const visible = (id: string) => !hidden.has(id);
  const outEdges: Edge[] = [];
  for (const e of edges) {
    const dep = isDepEdge(e);
    let source = e.source;
    let target = e.target;
    let rerouted = false;
    if (foldedInto.has(source)) {
      source = foldedInto.get(source)!;
      rerouted = true;
    }
    if (foldedInto.has(target)) {
      target = foldedInto.get(target)!;
      rerouted = true;
    }
    const endpointsVisible = visible(e.source) && visible(e.target);
    const internal = source === target; // both ends live inside the same collapsed group
    const hubHidden = !dep && !meta.showHubEdges && hubs.hubEdgeIds.has(e.id) && !selected.has(e.source) && !selected.has(e.target);
    if (hubHidden && endpointsVisible && showRefs) hiddenHubEdges++;
    const hide = !endpointsVisible || internal || (!dep && !showRefs) || hubHidden;
    if (!rerouted && !!e.hidden === hide) {
      outEdges.push(e);
      continue;
    }
    outEdges.push({ ...e, source, target, hidden: hide, sourceHandle: rerouted ? undefined : e.sourceHandle, targetHandle: rerouted ? undefined : e.targetHandle });
  }

  return { nodes: nodesOut, edges: outEdges, foldedInto, hiddenHubEdges };
}

const LEGACY_GROUP_COLORS = ["#4A90D9", "#8B5CF6", "#10B981", "#F87171", "#F59E0B"];

/**
 * Old versions drew a "group" as a free-floating outline rectangle (type "tableGroup" with a uuid id).
 * Convert those into real groups: tables whose centre sits inside the outline join the group, and the
 * outline node is dropped. Idempotent — diagrams without legacy outlines are returned untouched.
 */
export function migrateLegacyGroups(nodes: Node[], metaInput: Partial<ProjectMeta> | null | undefined): { nodes: Node[]; meta: ProjectMeta; migrated: boolean } {
  const meta = normalizeMeta(metaInput ?? {});
  const legacy = nodes.filter((n) => n.type === "tableGroup" && !isGroupNodeId(n.id));
  if (!legacy.length) return { nodes, meta, migrated: false };
  let out = nodes.filter((n) => !legacy.includes(n));
  const groups = { ...meta.groups };
  for (const g of legacy) {
    const name = String((g.data as any)?.label || "Group").trim() || "Group";
    const w = Number((g.style as any)?.width ?? (g as any).width ?? 450);
    const h = Number((g.style as any)?.height ?? (g as any).height ?? 350);
    out = out.map((n) => {
      if (!isTableNode(n) || (n.data as any).group) return n;
      const s = estimateNodeSize(n);
      const cx = n.position.x + s.width / 2;
      const cy = n.position.y + s.height / 2;
      const inside = cx >= g.position.x && cx <= g.position.x + w && cy >= g.position.y && cy <= g.position.y + h;
      return inside ? { ...n, data: { ...n.data, group: name } } : n;
    });
    if (!groups[name]) groups[name] = { color: LEGACY_GROUP_COLORS[Number((g.data as any)?.colorIndex || 0) % LEGACY_GROUP_COLORS.length] };
  }
  return { nodes: out, meta: { ...meta, groups }, migrated: true };
}

/** Moves every visible member of a group by (dx, dy) — used when a group frame/card is dragged. */
export function moveGroupMembers(nodes: Node[], groupName: string, dx: number, dy: number): Node[] {
  return nodes.map((n) => {
    if (!isTableNode(n) || String((n.data as any).group || "") !== groupName) return n;
    return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
  });
}

export function tableKeyOfNode(n: Node): string {
  const d = n.data as any;
  return tableKey(d.schema, String(d.label));
}
