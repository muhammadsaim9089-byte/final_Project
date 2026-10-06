/**
 * Diffing: structural (model vs model, for version history) and textual (line diff, for the AI/DBML diff viewer).
 */
import { DiagramModel, TableModel, tableKey, tableKeyOf } from "./types";

// ───────────────────────────── structural diff ─────────────────────────────

export interface TableChange {
  table: string;
  addedColumns: string[];
  removedColumns: string[];
  changedColumns: { name: string; changes: string[] }[];
  other: string[]; // notes, colours, indexes …
}

export interface SchemaDiff {
  addedTables: string[];
  removedTables: string[];
  changedTables: TableChange[];
  addedRefs: string[];
  removedRefs: string[];
  addedEnums: string[];
  removedEnums: string[];
  isEmpty: boolean;
  summary: string;
}

const refKey = (r: DiagramModel["refs"][number]) => {
  const a = `${tableKey(r.from.schema, r.from.table)}(${r.from.columns.join(",")})`;
  const b = `${tableKey(r.to.schema, r.to.table)}(${r.to.columns.join(",")})`;
  return `${a} ${r.type} ${b}`;
};

function diffTable(a: TableModel, b: TableModel): TableChange | null {
  const name = tableKeyOf(b);
  const aCols = new Map(a.columns.map((c) => [c.name, c]));
  const bCols = new Map(b.columns.map((c) => [c.name, c]));
  const addedColumns = b.columns.filter((c) => !aCols.has(c.name)).map((c) => c.name);
  const removedColumns = a.columns.filter((c) => !bCols.has(c.name)).map((c) => c.name);
  const changedColumns: TableChange["changedColumns"] = [];
  for (const c of b.columns) {
    const o = aCols.get(c.name);
    if (!o) continue;
    const changes: string[] = [];
    if (o.type !== c.type) changes.push(`type ${o.type} → ${c.type}`);
    if (!!o.pk !== !!c.pk) changes.push(c.pk ? "became primary key" : "no longer primary key");
    if (!!o.notNull !== !!c.notNull) changes.push(c.notNull ? "now NOT NULL" : "now nullable");
    if (!!o.unique !== !!c.unique) changes.push(c.unique ? "now UNIQUE" : "no longer UNIQUE");
    if (JSON.stringify(o.default || null) !== JSON.stringify(c.default || null)) changes.push("default changed");
    if ((o.note || "") !== (c.note || "")) changes.push("note changed");
    if (changes.length) changedColumns.push({ name: c.name, changes });
  }
  const other: string[] = [];
  if ((a.note || "") !== (b.note || "")) other.push("table note changed");
  if ((a.headerColor || "") !== (b.headerColor || "")) other.push("header colour changed");
  if (JSON.stringify(a.indexes) !== JSON.stringify(b.indexes)) other.push("indexes changed");
  if (JSON.stringify(a.checks) !== JSON.stringify(b.checks)) other.push("check constraints changed");
  if (JSON.stringify(a.records || null) !== JSON.stringify(b.records || null)) other.push("sample data changed");
  if (!addedColumns.length && !removedColumns.length && !changedColumns.length && !other.length) return null;
  return { table: name, addedColumns, removedColumns, changedColumns, other };
}

/** Diff from `a` (older) to `b` (newer). */
export function diffModels(a: DiagramModel, b: DiagramModel): SchemaDiff {
  const aT = new Map(a.tables.map((t) => [tableKeyOf(t), t]));
  const bT = new Map(b.tables.map((t) => [tableKeyOf(t), t]));
  const addedTables = [...bT.keys()].filter((k) => !aT.has(k));
  const removedTables = [...aT.keys()].filter((k) => !bT.has(k));
  const changedTables: TableChange[] = [];
  for (const [k, t] of bT) {
    const o = aT.get(k);
    if (!o) continue;
    const c = diffTable(o, t);
    if (c) changedTables.push(c);
  }
  const aR = new Set(a.refs.map(refKey));
  const bR = new Set(b.refs.map(refKey));
  const addedRefs = [...bR].filter((k) => !aR.has(k));
  const removedRefs = [...aR].filter((k) => !bR.has(k));
  const aE = new Set(a.enums.map((e) => `${e.name}:${e.values.map((v) => v.name).join("|")}`));
  const bE = new Set(b.enums.map((e) => `${e.name}:${e.values.map((v) => v.name).join("|")}`));
  const addedEnums = [...bE].filter((k) => !aE.has(k)).map((k) => k.split(":")[0]);
  const removedEnums = [...aE].filter((k) => !bE.has(k)).map((k) => k.split(":")[0]);
  const isEmpty = !addedTables.length && !removedTables.length && !changedTables.length && !addedRefs.length && !removedRefs.length && !addedEnums.length && !removedEnums.length;
  const parts: string[] = [];
  if (addedTables.length) parts.push(`+${addedTables.length} table${addedTables.length > 1 ? "s" : ""}`);
  if (removedTables.length) parts.push(`−${removedTables.length} table${removedTables.length > 1 ? "s" : ""}`);
  if (changedTables.length) parts.push(`~${changedTables.length} changed`);
  if (addedRefs.length) parts.push(`+${addedRefs.length} ref${addedRefs.length > 1 ? "s" : ""}`);
  if (removedRefs.length) parts.push(`−${removedRefs.length} ref${removedRefs.length > 1 ? "s" : ""}`);
  return {
    addedTables,
    removedTables,
    changedTables,
    addedRefs,
    removedRefs,
    addedEnums,
    removedEnums,
    isEmpty,
    summary: isEmpty ? "No schema changes" : parts.join(" · "),
  };
}

export function modelStats(m: DiagramModel): { tables: number; columns: number; refs: number } {
  return { tables: m.tables.length, columns: m.tables.reduce((n, t) => n + t.columns.length, 0), refs: m.refs.length };
}

/** Turns a structural diff into the plain-English bullets shown next to an AI proposal ("Schema changes"). */
export function schemaDiffToLines(d: SchemaDiff): string[] {
  const lines: string[] = [];
  for (const t of d.addedTables) lines.push(`+ ${t}: new table`);
  for (const c of d.changedTables) {
    const parts: string[] = [];
    if (c.addedColumns.length) parts.push(`added ${c.addedColumns.join(", ")}`);
    if (c.removedColumns.length) parts.push(`removed ${c.removedColumns.join(", ")}`);
    if (c.changedColumns.length) parts.push(`changed ${c.changedColumns.map((x) => x.name).join(", ")}`);
    if (c.other.length) parts.push(c.other.join(", "));
    if (parts.length) lines.push(`${c.table}: ${parts.join("; ")}`);
  }
  for (const t of d.removedTables) lines.push(`− ${t}: removed`);
  for (const r of d.addedRefs) lines.push(`+ relationship ${r}`);
  for (const r of d.removedRefs) lines.push(`− relationship ${r}`);
  for (const e of d.addedEnums) lines.push(`+ enum ${e}`);
  for (const e of d.removedEnums) lines.push(`− enum ${e}`);
  return lines;
}

/** The table keys touched by a proposal, tagged "added"/"modified" — for `CanvasApi.highlightTables`. */
export function schemaDiffTouchedKeys(d: SchemaDiff): Record<string, "added" | "modified"> {
  const out: Record<string, "added" | "modified"> = {};
  for (const t of d.addedTables) out[t] = "added";
  for (const c of d.changedTables) out[c.table] = "modified";
  return out;
}

/**
 * Table groups aren't part of `TableModel`, so `diffModels` never sees them — a table gaining a header colour
 * from a new group wouldn't otherwise register as "changed". Call alongside `schemaDiffTouchedKeys` so grouping
 * an existing table still highlights it as touched.
 */
export function groupsTouchedKeys(a: DiagramModel, b: DiagramModel): Record<string, "added" | "modified"> {
  const out: Record<string, "added" | "modified"> = {};
  const before = new Map(a.groups.map((g) => [g.name, g]));
  for (const g of b.groups) {
    const prev = before.get(g.name);
    const prevTables = new Set(prev?.tables || []);
    for (const k of g.tables) if (!prevTables.has(k)) out[k] = out[k] || "modified";
  }
  return out;
}

// ───────────────────────────── line diff ─────────────────────────────

export type DiffOp = { type: "same" | "add" | "del"; text: string; aLine?: number; bLine?: number };

/** Line-based diff (LCS). Falls back to a whole-block replace for very large inputs. */
export function diffLines(a: string, b: string): DiffOp[] {
  const A = a.replace(/\r\n/g, "\n").split("\n");
  const B = b.replace(/\r\n/g, "\n").split("\n");
  // trim common prefix / suffix
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = A.slice(start, endA);
  const midB = B.slice(start, endB);
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) ops.push({ type: "same", text: A[i], aLine: i + 1, bLine: i + 1 });

  if (midA.length * midB.length > 6_000_000) {
    midA.forEach((t, i) => ops.push({ type: "del", text: t, aLine: start + i + 1 }));
    midB.forEach((t, i) => ops.push({ type: "add", text: t, bLine: start + i + 1 }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ type: "same", text: midA[i], aLine: start + i + 1, bLine: start + j + 1 });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: "del", text: midA[i], aLine: start + i + 1 });
        i++;
      } else {
        ops.push({ type: "add", text: midB[j], bLine: start + j + 1 });
        j++;
      }
    }
    while (i < n) {
      ops.push({ type: "del", text: midA[i], aLine: start + i + 1 });
      i++;
    }
    while (j < m) {
      ops.push({ type: "add", text: midB[j], bLine: start + j + 1 });
      j++;
    }
  }
  for (let k = endA; k < A.length; k++) ops.push({ type: "same", text: A[k], aLine: k + 1, bLine: endB + (k - endA) + 1 });
  return ops;
}

export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  return { added: ops.filter((o) => o.type === "add").length, removed: ops.filter((o) => o.type === "del").length };
}
