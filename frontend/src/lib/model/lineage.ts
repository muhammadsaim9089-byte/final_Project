/**
 * Data-lineage tracing over `Dep` edges (dbdiagram "Dependencies").
 * Given a focused column (or whole table) it returns everything upstream and downstream of it.
 */
import type { Edge, Node } from "@xyflow/react";
import { isDepEdge } from "./canvasAdapter";

export interface LineageFocus {
  tableId: string;
  column?: string;
}

export interface LineageResult {
  /** dep edge ids on the traced path */
  edgeIds: Set<string>;
  /** table id → columns involved ("*" = whole table) */
  columns: Map<string, Set<string>>;
}

export const WHOLE_TABLE = "*";

export function traceLineage(edges: Edge[], focus: LineageFocus): LineageResult {
  const deps = edges.filter(isDepEdge);
  const edgeIds = new Set<string>();
  const columns = new Map<string, Set<string>>();
  const add = (table: string, col: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(col);
  };
  const start = focus.column || WHOLE_TABLE;
  add(focus.tableId, start);

  const walk = (dir: "down" | "up") => {
    const seen = new Set<string>();
    const queue: { table: string; col: string }[] = [{ table: focus.tableId, col: start }];
    while (queue.length) {
      const cur = queue.shift()!;
      const key = `${cur.table}|${cur.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const e of deps) {
        const d = (e.data as any) || {};
        const here = dir === "down" ? e.source : e.target;
        const there = dir === "down" ? e.target : e.source;
        const hereCol: string = (dir === "down" ? d.fromColumn : d.toColumn) || "";
        const thereCol: string = (dir === "down" ? d.toColumn : d.fromColumn) || "";
        if (here !== cur.table) continue;
        // a column-level edge only continues the trace for that same column; table-level edges always do
        if (cur.col !== WHOLE_TABLE && hereCol && hereCol !== cur.col) continue;
        edgeIds.add(e.id);
        add(here, hereCol || cur.col);
        add(there, thereCol || WHOLE_TABLE);
        queue.push({ table: there, col: thereCol || WHOLE_TABLE });
      }
    }
  };
  walk("down");
  walk("up");
  return { edgeIds, columns };
}

export interface LineageStageMap {
  /** table ids per stage, sources first, outputs last */
  stages: string[][];
  /** the dependencies between different tables, for drawing the map's lines */
  links: { id: string; source: string; target: string }[];
}

/**
 * The Lineage drawer's map: every table that takes part in a dependency, in stages. A table's stage is the length of
 * the longest chain of dependencies feeding it (a cycle is cut where it closes), so sources sit on the left and the
 * tables everything flows into on the right. Within a stage, tables follow the average position of what feeds them,
 * which keeps the lines from crossing in the usual fan-in / fan-out shapes.
 */
export function lineageStages(edges: Edge[]): LineageStageMap {
  const all = edges.filter(isDepEdge);
  const deps = all.filter((e) => e.source !== e.target);
  const order: string[] = [];
  const preds = new Map<string, string[]>();
  for (const e of all) {
    for (const t of [e.source, e.target]) {
      if (preds.has(t)) continue;
      preds.set(t, []);
      order.push(t);
    }
  }
  for (const e of deps) if (!preds.get(e.target)!.includes(e.source)) preds.get(e.target)!.push(e.source);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (t: string): number => {
    const known = depth.get(t);
    if (known !== undefined) return known;
    visiting.add(t);
    let d = 0;
    for (const p of preds.get(t)!) if (!visiting.has(p)) d = Math.max(d, depthOf(p) + 1);
    visiting.delete(t);
    depth.set(t, d);
    return d;
  };
  for (const t of order) depthOf(t);

  const stages: string[][] = [];
  for (const t of order) (stages[depth.get(t)!] ||= []).push(t);
  const rowOf = new Map<string, number>();
  stages.forEach((stage, i) => {
    if (i > 0) {
      const key = (t: string) => {
        const rows = preds.get(t)!.map((p) => rowOf.get(p)).filter((r): r is number => r !== undefined);
        return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity;
      };
      const pos = new Map(stage.map((t, k) => [t, k]));
      stage.sort((a, b) => key(a) - key(b) || pos.get(a)! - pos.get(b)!);
    }
    stage.forEach((t, row) => rowOf.set(t, row));
  });
  return { stages: stages.filter(Boolean), links: deps.map((e) => ({ id: e.id, source: e.source, target: e.target })) };
}

export interface DependencyDraft {
  from: string;
  fromColumn?: string;
  to: string;
  toColumn?: string;
}

/**
 * A new dependency edge (DBML `Dep`: data flows from `from` to `to`, optionally column to column), or why it can't be
 * added. Used by the Lineage drawer's form, its "Draw dependency" mode and the selection bar.
 */
export function newDependency(nodes: Node[], edges: Edge[], d: DependencyDraft): { edge: Edge } | { error: string } {
  const a = nodes.find((n) => n.id === d.from);
  const b = nodes.find((n) => n.id === d.to);
  if (!a || !b) return { error: "Pick the upstream and downstream tables" };
  const fromColumn = d.fromColumn || "";
  const toColumn = d.toColumn || "";
  if (a.id === b.id && fromColumn === toColumn) return { error: "A dependency needs two different ends" };
  const dup = edges.some((e) => isDepEdge(e) && e.source === a.id && e.target === b.id && ((e.data as any)?.fromColumn || "") === fromColumn && ((e.data as any)?.toColumn || "") === toColumn);
  if (dup) return { error: "That dependency already exists" };
  const id = `dep_${a.id}_${b.id}_${fromColumn}_${toColumn}_${Date.now().toString(36)}`;
  return { edge: { id, source: a.id, target: b.id, type: "depEdge", data: { kind: "dep", fromColumn, toColumn, note: "", color: "", name: "" } } };
}

export function hasLineage(edges: Edge[]): boolean {
  return edges.some(isDepEdge);
}

export function tablesWithDeps(nodes: Node[], edges: Edge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    if (!isDepEdge(e)) continue;
    s.add(e.source);
    s.add(e.target);
  }
  return s;
}
