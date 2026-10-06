/**
 * Canvas ⇄ DiagramModel adapter.
 *
 * Conventions (shared by every part of the app):
 *  - Table node:  { id, type: "tableMode", data: { label, schema?, alias?, color?, group?, comment?, attributes[], indexes[], constraints[], seedData[] } }
 *  - Ref edge:    source = PARENT (referenced / "one" side), target = CHILD (holds the FK / "many" side)
 *                 data.relationshipType ∈ one-to-many | one-to-one | many-to-many (legacy many-to-one is normalised)
 *  - Dep edge:    type "depEdge", data.kind = "dep", source = upstream, target = downstream (data lineage)
 *  - Sticky note: type "stickyNote", data { text, colorIndex, name? }
 */
import type { Edge, Node } from "@xyflow/react";
import {
  ColumnModel,
  DepModel,
  DiagramModel,
  EnumModel,
  IndexModel,
  ProjectMeta,
  RecordValue,
  RefModel,
  ReferentialAction,
  TableGroupModel,
  TableModel,
  defaultMeta,
  emptyModel,
  normalizeMeta,
  slugify,
  tableKey,
  tablePkColumns,
} from "./types";
import { canonicalType } from "../sql/dialects";
import { parseDefaultText } from "../sql/parser";

export const REF_EDGE_TYPES = ["crowsFoot", "pulseMode"];

export interface AttrData {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  size?: string;
  defaultVal?: string;
  allowNull?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  color?: string;
  comment?: string;
  checks?: string[];
  meta?: Record<string, string>;
  fkRefTable?: string;
  fkRefField?: string;
  fkRelationType?: string;
}

// ───────────────────────────── small helpers ─────────────────────────────

const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(ss|us)$/i, "$1").replace(/s$/i, "");

export function nodeKey(n: Node): string {
  const d = n.data as any;
  return tableKey(d.schema, String(d.label ?? ""));
}

export function isTableNode(n: Node): boolean {
  return n.type === "tableMode";
}

export function isDepEdge(e: Edge): boolean {
  return (e.data as any)?.kind === "dep" || e.type === "depEdge";
}

export function normalizeRelType(t: unknown): "one-to-many" | "one-to-one" | "many-to-many" {
  if (t === "one-to-one" || t === "1-1") return "one-to-one";
  if (t === "many-to-many" || t === "N-N") return "many-to-many";
  return "one-to-many"; // legacy "many-to-one" edges are stored parent → child, i.e. one-to-many
}

function defaultToRaw(d: ColumnModel["default"]): string {
  if (!d) return "";
  switch (d.kind) {
    case "string":
      return `'${d.value.replace(/'/g, "''")}'`;
    case "null":
      return "NULL";
    default:
      return d.value;
  }
}

function rawToDefault(raw: string | undefined | null): ColumnModel["default"] {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const p = parseDefaultText(String(raw));
  return p === "increment" ? undefined : p;
}

const upper = (a?: ReferentialAction) => (a ? (a.toUpperCase() as any) : undefined);
const lower = (a?: string): ReferentialAction | undefined => {
  if (!a) return undefined;
  const v = String(a).toLowerCase();
  return v === "cascade" || v === "restrict" || v === "set null" || v === "set default" || v === "no action" ? (v as ReferentialAction) : undefined;
};

function typeWithSize(a: any): string {
  const t = String(a.type || "varchar").trim();
  const size = a.size !== undefined && a.size !== null ? String(a.size).trim() : "";
  if (size && !t.includes("(") && /^(\d+|\d+\s*,\s*\d+|max)$/i.test(size)) return `${t}(${size.replace(/\s+/g, "")})`;
  return t;
}

function coerceRecordValue(v: unknown, type: string): RecordValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  if (s === "") return null;
  const kind = canonicalType(type).kind;
  if (["smallint", "integer", "bigint", "decimal", "float", "double"].includes(kind) && /^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);
  if (kind === "boolean" && /^(true|false)$/i.test(s.trim())) return s.trim().toLowerCase() === "true";
  return s;
}

// ───────────────────────────── canvas → model ─────────────────────────────

export function canvasToModel(nodes: Node[], edges: Edge[], meta?: Partial<ProjectMeta> | null): DiagramModel {
  const m = normalizeMeta(meta ?? {});
  const model = emptyModel();
  model.project = { ...m.project };

  const tableNodes = nodes.filter(isTableNode);
  const byId = new Map(tableNodes.map((n) => [n.id, n]));

  for (const n of tableNodes) {
    const d = n.data as any;
    const attrs: AttrData[] = Array.isArray(d.attributes) ? d.attributes : [];
    const indexes: IndexModel[] = [];
    const pkNames = attrs.filter((a) => a.isPk).map((a) => a.name);
    for (const ix of (d.indexes as any[]) || []) {
      const cols = (ix.columns as string[]) || [];
      if (!cols.length) continue;
      const type = String(ix.type || "").toLowerCase();
      const unique = !!ix.isUnique || type === "unique";
      indexes.push({
        columns: cols,
        name: ix.name || undefined,
        unique: unique || undefined,
        type: type && type !== "unique" && type !== "btree" ? type : undefined, // btree is the default → keep DBML quiet
      });
    }
    if (pkNames.length > 1) indexes.unshift({ columns: pkNames, pk: true });

    const columns: ColumnModel[] = attrs.map((a) => {
      const col: ColumnModel = { name: a.name, type: typeWithSize(a) };
      const isPk = !!a.isPk && pkNames.length === 1;
      if (isPk) col.pk = true;
      // a primary key is implicitly NOT NULL — don't repeat it in DBML/SQL
      if (a.allowNull === false && !a.isPk) col.notNull = true;
      if (a.unique && !a.isPk) col.unique = true;
      if (a.autoIncrement) col.increment = true;
      const def = rawToDefault(a.defaultVal);
      if (def) col.default = def;
      if (a.comment) col.note = a.comment;
      if (a.checks && a.checks.length) col.checks = [...a.checks];
      if (a.meta && Object.keys(a.meta).length) col.meta = { ...a.meta };
      return col;
    });

    const checks = ((d.constraints as any[]) || [])
      .filter((c) => (!c.type || String(c.type).toUpperCase() === "CHECK") && c.expression)
      .map((c) => ({ expression: String(c.expression), name: c.name || undefined }));

    const table: TableModel = {
      schema: d.schema || undefined,
      name: String(d.label ?? ""),
      alias: d.alias || undefined,
      headerColor: d.color || undefined,
      note: d.comment || undefined,
      columns,
      indexes,
      checks,
      meta: d.meta && Object.keys(d.meta).length ? { ...d.meta } : undefined,
      x: Math.round(n.position?.x ?? 0),
      y: Math.round(n.position?.y ?? 0),
    };
    const seed = Array.isArray(d.seedData) ? (d.seedData as Record<string, unknown>[]) : [];
    if (seed.length) {
      const names = attrs.map((a) => a.name);
      const used = names.filter((c) => seed.some((r) => r[c] !== undefined && r[c] !== ""));
      if (used.length) {
        table.records = {
          columns: used,
          rows: seed.map((r) => used.map((c) => coerceRecordValue(r[c], attrs.find((a) => a.name === c)?.type || ""))),
        };
      }
    }
    model.tables.push(table);
  }

  // relationships
  const tableOf = (id: string) => model.tables[tableNodes.findIndex((n) => n.id === id)];
  for (const e of edges) {
    if (isDepEdge(e)) continue;
    const parentNode = byId.get(e.source);
    const childNode = byId.get(e.target);
    if (!parentNode || !childNode) continue;
    const parent = tableOf(parentNode.id);
    const child = tableOf(childNode.id);
    const d = (e.data as any) || {};
    const type = normalizeRelType(d.relationshipType);

    let parentCols: string[] = d.sourceColumns || [d.sourceColumn || d.sourceField || d.referencedKey].filter(Boolean);
    let childCols: string[] = d.targetColumns || [d.targetColumn || d.targetField || d.foreignKey].filter(Boolean);
    if (type !== "many-to-many") {
      if (!parentCols.length) parentCols = tablePkColumns(parent).slice(0, 1);
      if (!childCols.length) childCols = inferFkColumns(childNode, parentNode, parentCols);
      if (!childCols.length || !parentCols.length) continue;
    }
    const parentEp = { schema: parent.schema, table: parent.name, columns: parentCols };
    const childEp = { schema: child.schema, table: child.name, columns: childCols };
    const optP = !!d.optionalSource;
    const optC = !!d.optionalTarget;
    const base = { name: d.name || undefined, onDelete: lower(d.onDelete), onUpdate: lower(d.onUpdate), color: d.color || undefined };
    let ref: RefModel;
    if (type === "one-to-one") ref = { ...base, from: parentEp, to: childEp, type: "one-to-one", fromOptional: optP || undefined, toOptional: optC || undefined };
    else if (type === "many-to-many") ref = { ...base, from: parentEp, to: childEp, type: "many-to-many", fromOptional: optP || undefined, toOptional: optC || undefined };
    else ref = { ...base, from: childEp, to: parentEp, type: "many-to-one", fromOptional: optC || undefined, toOptional: optP || undefined };
    model.refs.push(ref);
  }

  // lineage
  for (const e of edges) {
    if (!isDepEdge(e)) continue;
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const d = (e.data as any) || {};
    const dep: DepModel = {
      name: d.name || undefined,
      from: { schema: (a.data as any).schema || undefined, table: String((a.data as any).label), column: d.fromColumn || undefined },
      to: { schema: (b.data as any).schema || undefined, table: String((b.data as any).label), column: d.toColumn || undefined },
      note: d.note || undefined,
      color: d.color || undefined,
    };
    model.deps.push(dep);
  }

  // table groups (membership lives on the table nodes, styling in meta)
  const groupNames = new Set<string>(Object.keys(m.groups));
  for (const n of tableNodes) if ((n.data as any).group) groupNames.add(String((n.data as any).group));
  for (const name of groupNames) {
    const members = tableNodes.filter((n) => (n.data as any).group === name).map((n) => nodeKey(n));
    const gm = m.groups[name] || {};
    if (!members.length && !gm.note) continue;
    const g: TableGroupModel = { name, tables: members, color: gm.color || undefined, note: gm.note || undefined, collapsed: gm.collapsed || undefined };
    model.groups.push(g);
  }

  // sticky notes
  const usedNoteNames = new Set<string>();
  nodes
    .filter((n) => n.type === "stickyNote")
    .forEach((n, i) => {
      const d = n.data as any;
      let name = slugify(d.name || `note_${i + 1}`) || `note_${i + 1}`;
      while (usedNoteNames.has(name)) name += "_";
      usedNoteNames.add(name);
      model.notes.push({ name, text: String(d.text || ""), colorIndex: d.colorIndex, x: Math.round(n.position.x), y: Math.round(n.position.y) });
    });

  model.enums = m.enums.map((e) => ({ ...e, values: e.values.map((v) => ({ ...v })) }));
  model.views = m.views.map((v) => ({ ...v, tables: v.tables === "*" ? "*" : [...v.tables], groups: [...v.groups], schemas: [...v.schemas] }));
  return model;
}

/** Finds the FK column on `child` that most plausibly references `parent` (used for edges drawn by hand). */
function inferFkColumns(child: Node, parent: Node, parentCols: string[]): string[] {
  const attrs: AttrData[] = ((child.data as any).attributes as AttrData[]) || [];
  const pLabel = String((parent.data as any).label);
  const byRef = attrs.filter((a) => a.fkRefTable === pLabel);
  if (byRef.length) return [byRef[0].name];
  const pk = parentCols[0] || "id";
  const candidates = [`${pLabel}_${pk}`, `${singular(pLabel)}_${pk}`, `${pLabel}${cap(pk)}`, `${singular(pLabel)}${cap(pk)}`, `${singular(pLabel)}_id`, `${singular(pLabel)}Id`].map((s) => s.toLowerCase());
  const hit = attrs.find((a) => candidates.includes(a.name.toLowerCase()));
  if (hit) return [hit.name];
  const fk = attrs.find((a) => a.isFk && !a.isPk);
  return fk ? [fk.name] : [];
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────────────────────── model → canvas ─────────────────────────────

export interface ModelToCanvasOptions {
  /** Existing nodes/edges: ids, positions and UI-only fields of matching tables are preserved. */
  prevNodes?: Node[];
  prevEdges?: Edge[];
  prevMeta?: Partial<ProjectMeta> | null;
  edgeType?: string;
  /** Tables/notes without a known position get this marker so callers can lay them out. */
  unpositioned?: string[];
}

export interface ModelToCanvasResult {
  nodes: Node[];
  edges: Edge[];
  meta: ProjectMeta;
  /** ids of nodes that had no previous position */
  newNodeIds: string[];
}

export function modelToCanvas(model: DiagramModel, opts: ModelToCanvasOptions = {}): ModelToCanvasResult {
  const prevNodes = opts.prevNodes || [];
  const prevMeta = normalizeMeta(opts.prevMeta ?? defaultMeta());
  const edgeType = opts.edgeType || "crowsFoot";
  const prevByKey = new Map<string, Node>();
  for (const n of prevNodes) if (isTableNode(n)) prevByKey.set(nodeKey(n), n);
  const usedIds = new Set(prevNodes.map((n) => n.id));
  const newNodeIds: string[] = [];

  const uniqueId = (base: string) => {
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}_${i++}`;
    usedIds.add(id);
    return id;
  };

  const groupOf = new Map<string, string>();
  for (const g of model.groups) for (const key of g.tables) if (!groupOf.has(key)) groupOf.set(key, g.name);

  // foreign-key lookup for column flags
  const fkInfo = new Map<string, { table: string; col: string; rel: string }>(); // `${childKey}|${col}`
  const tableByKey = new Map(model.tables.map((t) => [tableKey(t.schema, t.name), t]));
  const findTable = (ep: { schema?: string; table: string }) => tableByKey.get(tableKey(ep.schema, ep.table)) || model.tables.find((t) => t.name === ep.table);
  type Oriented = { ref: RefModel; parent: TableModel; child: TableModel; parentCols: string[]; childCols: string[]; type: "one-to-many" | "one-to-one" | "many-to-many"; optParent: boolean; optChild: boolean };
  const oriented: Oriented[] = [];
  for (const r of model.refs) {
    const a = findTable(r.from);
    const b = findTable(r.to);
    if (!a || !b) continue;
    if (r.type === "many-to-many") {
      oriented.push({ ref: r, parent: a, child: b, parentCols: r.from.columns, childCols: r.to.columns, type: "many-to-many", optParent: !!r.fromOptional, optChild: !!r.toOptional });
      continue;
    }
    const childIsFrom = r.type === "many-to-one";
    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const childEp = childIsFrom ? r.from : r.to;
    const parentEp = childIsFrom ? r.to : r.from;
    const parentCols = parentEp.columns.length ? parentEp.columns : tablePkColumns(parent).slice(0, 1);
    oriented.push({
      ref: r,
      parent,
      child,
      parentCols,
      childCols: childEp.columns,
      type: r.type === "one-to-one" ? "one-to-one" : "one-to-many",
      optParent: childIsFrom ? !!r.toOptional : !!r.fromOptional,
      optChild: childIsFrom ? !!r.fromOptional : !!r.toOptional,
    });
    childEp.columns.forEach((c, i) => fkInfo.set(`${tableKey(child.schema, child.name)}|${c}`, { table: parent.name, col: parentCols[i] || parentCols[0] || "id", rel: r.type === "one-to-one" ? "One to One" : "Many to One" }));
  }

  // nodes
  const nodes: Node[] = [];
  const idByKey = new Map<string, string>();
  model.tables.forEach((t) => {
    const key = tableKey(t.schema, t.name);
    const prev = prevByKey.get(key);
    const prevData = (prev?.data as any) || {};
    const prevAttrs = new Map<string, AttrData>(((prevData.attributes as AttrData[]) || []).map((a) => [a.name, a]));
    const pk = tablePkColumns(t);
    const attributes: AttrData[] = t.columns.map((c) => {
      const p = prevAttrs.get(c.name);
      const fk = fkInfo.get(`${key}|${c.name}`);
      const isPk = pk.includes(c.name);
      const attr: AttrData = {
        ...(p || {}),
        name: c.name,
        type: c.type,
        isPk,
        isFk: !!fk,
        size: "",
        defaultVal: defaultToRaw(c.default),
        allowNull: !(c.notNull || isPk),
        unique: !!c.unique,
        autoIncrement: !!c.increment,
        comment: c.note || "",
        checks: c.checks,
        meta: c.meta,
        fkRefTable: fk?.table || "",
        fkRefField: fk?.col || "",
        fkRelationType: fk?.rel || "Many to One",
      };
      if (!attr.checks) delete attr.checks;
      if (!attr.meta) delete attr.meta;
      return attr;
    });
    const indexes = t.indexes
      .filter((ix) => !ix.pk)
      .map((ix) => ({ name: ix.name || `idx_${t.name}_${ix.columns.map((c) => c.replace(/[^A-Za-z0-9_]/g, "")).join("_")}`, columns: ix.columns, type: ix.type ? ix.type.toUpperCase() : "BTREE", isUnique: !!ix.unique }));
    const otherConstraints = ((prevData.constraints as any[]) || []).filter((c) => c.type && String(c.type).toUpperCase() !== "CHECK");
    const constraints = [...t.checks.map((c, i) => ({ name: c.name || `chk_${t.name}_${i + 1}`, type: "CHECK", expression: c.expression })), ...otherConstraints];
    const seedData = t.records
      ? t.records.rows.map((r) => {
          const row: Record<string, any> = {};
          t.records!.columns.forEach((c, i) => {
            row[c] = r[i] === undefined ? null : r[i];
          });
          return row;
        })
      : [];

    const id = prev ? prev.id : uniqueId(`tbl_${slugify(t.schema ? `${t.schema}_${t.name}` : t.name) || "table"}`);
    idByKey.set(key, id);
    const group = groupOf.get(key);
    const data = {
      ...prevData,
      label: t.name,
      schema: t.schema || "",
      alias: t.alias || "",
      icon: prevData.icon || "server",
      color: t.headerColor || "",
      group: group || "",
      comment: t.note || "",
      attributes,
      indexes,
      constraints,
      seedData,
      meta: t.meta,
    };
    if (!data.meta) delete data.meta;
    const hasPos = !!prev || (t.x !== undefined && t.y !== undefined);
    const node: Node = {
      ...(prev || {}),
      id,
      type: "tableMode",
      position: prev ? prev.position : { x: t.x ?? 0, y: t.y ?? 0 },
      sourcePosition: "right" as any,
      targetPosition: "left" as any,
      data,
    };
    if (!hasPos) newNodeIds.push(id);
    nodes.push(node);
  });

  // sticky notes (keep existing ones by name; DBML notes are authoritative for text)
  const prevNotes = prevNodes.filter((n) => n.type === "stickyNote");
  const usedNotePrev = new Set<string>();
  model.notes.forEach((nt, i) => {
    const match = prevNotes.find((p) => !usedNotePrev.has(p.id) && slugify((p.data as any).name || "") === nt.name) || prevNotes.find((p) => !usedNotePrev.has(p.id) && (p.data as any).text === nt.text);
    if (match) usedNotePrev.add(match.id);
    const id = match ? match.id : uniqueId(`note_${slugify(nt.name) || i + 1}`);
    const hasPos = !!match || (nt.x !== undefined && nt.y !== undefined);
    if (!hasPos) newNodeIds.push(id);
    nodes.push({
      ...(match || {}),
      id,
      type: "stickyNote",
      position: match ? match.position : { x: nt.x ?? 0, y: nt.y ?? 0 },
      data: { ...((match?.data as any) || {}), name: nt.name, text: nt.text, colorIndex: nt.colorIndex ?? (match?.data as any)?.colorIndex ?? 0 },
    });
  });

  // edges
  const edges: Edge[] = [];
  const usedEdgeIds = new Set<string>();
  const prevEdgeByKey = new Map<string, Edge>();
  for (const e of opts.prevEdges || []) if (!isDepEdge(e)) prevEdgeByKey.set(`${e.source}|${e.target}|${(e.data as any)?.targetColumn || (e.data as any)?.foreignKey || ""}`, e);
  for (const o of oriented) {
    const source = idByKey.get(tableKey(o.parent.schema, o.parent.name));
    const target = idByKey.get(tableKey(o.child.schema, o.child.name));
    if (!source || !target) continue;
    const prevE = prevEdgeByKey.get(`${source}|${target}|${o.childCols[0] || ""}`);
    let id = prevE?.id || `e_${source}_${target}_${o.childCols.join("-") || "m2m"}`;
    while (usedEdgeIds.has(id)) id += "_";
    usedEdgeIds.add(id);
    edges.push({
      ...(prevE || {}),
      id,
      source,
      target,
      type: prevE?.type && REF_EDGE_TYPES.includes(prevE.type) ? prevE.type : edgeType,
      data: {
        ...((prevE?.data as any) || {}),
        kind: "ref",
        relationshipType: o.type,
        foreignKey: o.childCols[0] || "",
        referencedKey: o.parentCols[0] || "",
        sourceColumn: o.parentCols[0] || "",
        targetColumn: o.childCols[0] || "",
        sourceColumns: o.parentCols.length > 1 ? o.parentCols : undefined,
        targetColumns: o.childCols.length > 1 ? o.childCols : undefined,
        onDelete: upper(o.ref.onDelete),
        onUpdate: upper(o.ref.onUpdate),
        color: o.ref.color || "",
        name: o.ref.name || "",
        optionalSource: o.optParent,
        optionalTarget: o.optChild,
      },
    } as Edge);
  }

  // lineage edges
  const prevDeps = (opts.prevEdges || []).filter(isDepEdge);
  model.deps.forEach((dp, i) => {
    const source = idByKey.get(tableKey(dp.from.schema, dp.from.table)) || [...idByKey.entries()].find(([k]) => k.split(".").pop() === dp.from.table)?.[1];
    const target = idByKey.get(tableKey(dp.to.schema, dp.to.table)) || [...idByKey.entries()].find(([k]) => k.split(".").pop() === dp.to.table)?.[1];
    if (!source || !target) return;
    const prevE = prevDeps.find((e) => e.source === source && e.target === target && (e.data as any)?.fromColumn === dp.from.column && (e.data as any)?.toColumn === dp.to.column);
    let id = prevE?.id || `dep_${source}_${target}_${dp.from.column || ""}_${dp.to.column || ""}`;
    while (usedEdgeIds.has(id)) id += `_${i}`;
    usedEdgeIds.add(id);
    edges.push({
      ...(prevE || {}),
      id,
      source,
      target,
      type: "depEdge",
      data: { ...((prevE?.data as any) || {}), kind: "dep", fromColumn: dp.from.column || "", toColumn: dp.to.column || "", note: dp.note || "", color: dp.color || "", name: dp.name || "" },
    } as Edge);
  });

  // meta: DBML is authoritative for what it can express; view preferences survive
  const groups: ProjectMeta["groups"] = {};
  for (const g of model.groups) {
    const pg = prevMeta.groups[g.name] || {};
    groups[g.name] = { color: g.color ?? undefined, note: g.note ?? undefined, collapsed: pg.collapsed };
    if (groups[g.name].color === undefined) delete groups[g.name].color;
    if (groups[g.name].note === undefined) delete groups[g.name].note;
    if (groups[g.name].collapsed === undefined) delete groups[g.name].collapsed;
  }
  const meta: ProjectMeta = {
    ...prevMeta,
    project: { ...model.project },
    enums: model.enums.map((e: EnumModel) => ({ ...e })),
    groups,
    views: model.views,
    activeViewId: prevMeta.activeViewId && (prevMeta.activeViewId === "default" || model.views.some((v) => v.id === prevMeta.activeViewId)) ? prevMeta.activeViewId : null,
  };

  return { nodes, edges, meta, newNodeIds };
}

/** Content-only fingerprint (ignores positions/selection) — used to detect "did the schema really change?". */
export function modelSignature(model: DiagramModel): string {
  const clean = (v: any): any => {
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) {
        if (k === "x" || k === "y" || k === "loc" || v[k] === undefined || v[k] === "" || v[k] === false) continue;
        out[k] = clean(v[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(clean(model));
}

export function newRefEdgeId(source: string, target: string, col = ""): string {
  return `e_${source}_${target}_${col || Date.now().toString(36)}`;
}
