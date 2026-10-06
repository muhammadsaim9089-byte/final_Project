/**
 * Saved projects, as the dashboard and the editor's save status see them: card metrics, search, sorting, relative
 * times, a thumbnail of the diagram, and the "has this changed since it was saved?" fingerprint. Framework-free.
 */
import type { Edge, Node } from "@xyflow/react";
import { canvasToModel, isDepEdge, isTableNode, modelSignature } from "../model/canvasAdapter";
import { estimateNodeSize } from "../nodeSize";
import { normalizeMeta, type ProjectMeta } from "../model/types";
import { SQL_DIALECTS, dialectFromDbmlName, type SqlDialect } from "../sql/dialects";

/** A project as GET /api/projects returns it. */
export interface StoredProject {
  id: string;
  title: string;
  rawPrompt?: string | null;
  nodesJson: any[];
  edgesJson: any[];
  meta?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  tables: number;
  relationships: number;
  lineage: number;
  views: number;
  groups: number;
  notes: number;
  /** "PostgreSQL", "MySQL / MariaDB"… — null when the diagram doesn't say */
  engine: string | null;
  dialect: SqlDialect | null;
  tableNames: string[];
}

const tableName = (n: any) => {
  const d = n?.data || {};
  const schema = String(d.schema || "");
  return (schema && schema !== "public" ? `${schema}.` : "") + String(d.label || "");
};

export function summarizeProject(p: Pick<StoredProject, "nodesJson" | "edgesJson" | "meta">): ProjectSummary {
  const nodes: any[] = Array.isArray(p.nodesJson) ? p.nodesJson : [];
  const edges: any[] = Array.isArray(p.edgesJson) ? p.edgesJson : [];
  const meta = normalizeMeta(p.meta);
  const tables = nodes.filter((n) => n?.type === "tableMode");
  const groups = new Set<string>([...Object.keys(meta.groups), ...tables.map((t) => String(t.data?.group || "")).filter(Boolean)]);
  const raw = meta.project.databaseType;
  const dialect = dialectFromDbmlName(raw) ?? null;
  return {
    tables: tables.length,
    relationships: edges.filter((e) => !isDepEdge(e)).length,
    lineage: edges.filter((e) => isDepEdge(e)).length,
    views: meta.views.length,
    groups: groups.size,
    notes: nodes.filter((n) => n?.type === "stickyNote").length,
    engine: dialect ? SQL_DIALECTS.find((d) => d.id === dialect)!.label : raw ? String(raw) : null,
    dialect,
    tableNames: tables.map(tableName),
  };
}

/**
 * Does the project match a search? Titles first, then what is inside: table names, then column names.
 * `where` says what matched when it wasn't the title ("table orders", "column orders.customer_id").
 */
export function matchProject(p: StoredProject, query: string): { match: boolean; where?: string } {
  const q = query.trim().toLowerCase();
  if (!q) return { match: true };
  if (p.title.toLowerCase().includes(q)) return { match: true };
  const tables = (Array.isArray(p.nodesJson) ? p.nodesJson : []).filter((n) => n?.type === "tableMode");
  const t = tables.find((n) => tableName(n).toLowerCase().includes(q));
  if (t) return { match: true, where: `table ${tableName(t)}` };
  for (const n of tables) {
    const col = (n.data?.attributes || []).find((a: any) => String(a?.name || "").toLowerCase().includes(q));
    if (col) return { match: true, where: `column ${tableName(n)}.${col.name}` };
  }
  return { match: false };
}

export type ProjectSort = "modified" | "name" | "created" | "tables";

export function sortProjects<T extends StoredProject>(list: T[], sort: ProjectSort): T[] {
  const time = (s: string) => new Date(s).getTime() || 0;
  const tables = (p: T) => (Array.isArray(p.nodesJson) ? p.nodesJson.filter((n) => n?.type === "tableMode").length : 0);
  const byName = (a: T, b: T) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  return [...list].sort((a, b) => {
    switch (sort) {
      case "name":
        return byName(a, b);
      case "created":
        return time(b.createdAt) - time(a.createdAt) || byName(a, b);
      case "tables":
        return tables(b) - tables(a) || time(b.updatedAt) - time(a.updatedAt);
      default:
        return time(b.updatedAt) - time(a.updatedAt) || byName(a, b);
    }
  });
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then a date. */
export function relativeTime(when: string | number | Date, now: number = Date.now()): string {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

// ───────────────────────── thumbnail ─────────────────────────

export interface Thumbnail {
  viewBox: string;
  width: number;
  height: number;
  tables: { x: number; y: number; w: number; h: number; color: string; rows: number }[];
  groups: { x: number; y: number; w: number; h: number; color: string }[];
  notes: { x: number; y: number; w: number; h: number }[];
  links: { x1: number; y1: number; x2: number; y2: number; dep: boolean }[];
}

/**
 * A mini-map of the diagram for a project card: tables (with their header colour and row count), group frames,
 * sticky notes and relationship lines, in diagram coordinates. Null when there is nothing to draw.
 */
export function thumbnailOf(p: Pick<StoredProject, "nodesJson" | "edgesJson" | "meta">): Thumbnail | null {
  const nodes: any[] = (Array.isArray(p.nodesJson) ? p.nodesJson : []).filter((n) => n && n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y));
  const tables = nodes.filter((n) => n.type === "tableMode");
  const notes = nodes.filter((n) => n.type === "stickyNote");
  if (!tables.length && !notes.length) return null;
  const meta = normalizeMeta(p.meta);
  const rect = (n: any) => {
    const s = estimateNodeSize({ ...n, measured: undefined, data: { ...n.data, globalDetailsLevel: "all" } } as Node);
    return { x: n.position.x, y: n.position.y, w: s.width, h: s.height };
  };
  const byId = new Map<string, { x: number; y: number; w: number; h: number }>();
  const outTables = tables.map((n) => {
    const r = rect(n);
    byId.set(n.id, r);
    return { ...r, color: String(n.data?.color || ""), rows: Array.isArray(n.data?.attributes) ? n.data.attributes.length : 0 };
  });
  const groups = new Map<string, { x: number; y: number; r: number; b: number }>();
  for (const n of tables) {
    const g = String(n.data?.group || "");
    if (!g) continue;
    const r = byId.get(n.id)!;
    const cur = groups.get(g) || { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity };
    groups.set(g, { x: Math.min(cur.x, r.x), y: Math.min(cur.y, r.y), r: Math.max(cur.r, r.x + r.w), b: Math.max(cur.b, r.y + r.h) });
  }
  const outGroups = [...groups].map(([name, g]) => ({ x: g.x - 28, y: g.y - 60, w: g.r - g.x + 56, h: g.b - g.y + 88, color: String(meta.groups[name]?.color || "") }));
  const outNotes = notes.map((n) => ({ x: n.position.x, y: n.position.y, w: 208, h: 110 }));
  const links = (Array.isArray(p.edgesJson) ? p.edgesJson : [])
    .map((e: any) => {
      const a = byId.get(e?.source);
      const b = byId.get(e?.target);
      if (!a || !b || a === b) return null;
      // from the side of one table facing the other
      const leftToRight = a.x + a.w / 2 <= b.x + b.w / 2;
      return {
        x1: leftToRight ? a.x + a.w : a.x,
        y1: a.y + Math.min(a.h / 2, 40),
        x2: leftToRight ? b.x : b.x + b.w,
        y2: b.y + Math.min(b.h / 2, 40),
        dep: isDepEdge(e),
      };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);

  const all = [...outTables, ...outGroups, ...outNotes];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.w));
  const maxY = Math.max(...all.map((r) => r.y + r.h));
  const pad = Math.max(40, (maxX - minX) * 0.04);
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  return {
    viewBox: `${Math.round(minX - pad)} ${Math.round(minY - pad)} ${Math.round(width)} ${Math.round(height)}`,
    width,
    height,
    tables: outTables,
    groups: outGroups,
    notes: outNotes,
    links,
  };
}

// ───────────────────────── "unsaved changes" ─────────────────────────

/**
 * A fingerprint of everything a save stores: the schema (modelSignature), where tables and notes sit, the view
 * preferences kept in the project meta, and the title. Selection, hover and measured sizes don't count.
 */
export function saveSignature(nodes: Node[], edges: Edge[], meta: ProjectMeta, title: string): string {
  const model = canvasToModel(nodes, edges, meta);
  const at = (v: number | undefined) => Math.round(v ?? 0);
  const places = [
    ...model.tables.map((t) => `${t.schema || ""}.${t.name}@${at(t.x)},${at(t.y)}`),
    ...model.notes.map((n) => `note:${n.name}@${at(n.x)},${at(n.y)}`),
  ].sort();
  const prefs = {
    collapsed: Object.keys(meta.groups).filter((g) => meta.groups[g]?.collapsed).sort(),
    hiddenColors: [...meta.hiddenColors].sort(),
    activeViewId: meta.activeViewId,
    showRelationships: meta.showRelationships,
  };
  return JSON.stringify([modelSignature(model), places, prefs, title.trim()]);
}

export const hasTables = (nodes: Node[]) => nodes.some(isTableNode);
