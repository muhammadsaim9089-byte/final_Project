/**
 * Deterministic "AI assistant" quick actions (dbdiagram's Quick Actions) — they run instantly, offline,
 * and never hallucinate: add timestamps, detect relationships, add indexes, create table groups,
 * remap data types, add missing primary keys, snake_case names.
 */
import { DiagramModel, RefModel, TableModel, tableKey, tableKeyOf, tablePkColumns } from "../model/types";
import { SqlDialect, canonicalType, convertType } from "../sql/dialects";

export interface ActionResult {
  model: DiagramModel;
  changes: string[];
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const GROUP_COLORS = ["#4A90D9", "#8B5CF6", "#10B981", "#F87171", "#F59E0B", "#06B6D4", "#EC4899", "#84CC16"];

export function addTimestamps(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  for (const t of model.tables) {
    const names = new Set(t.columns.map((c) => c.name.toLowerCase()));
    // junction / link tables are usually left without audit columns
    const added: string[] = [];
    if (!names.has("created_at")) {
      t.columns.push({ name: "created_at", type: "timestamp", notNull: true, default: { kind: "expression", value: "now()" } });
      added.push("created_at");
    }
    if (!names.has("updated_at")) {
      t.columns.push({ name: "updated_at", type: "timestamp", notNull: true, default: { kind: "expression", value: "now()" } });
      added.push("updated_at");
    }
    if (added.length) changes.push(`${tableKeyOf(t)}: added ${added.join(", ")}`);
  }
  return { model, changes };
}

export function addMissingPrimaryKeys(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  for (const t of model.tables) {
    if (tablePkColumns(t).length) continue;
    const taken = new Set(t.columns.map((c) => c.name.toLowerCase()));
    const name = taken.has("id") ? `${t.name}_id` : "id";
    t.columns.unshift({ name, type: "integer", pk: true, increment: true, notNull: true });
    changes.push(`${tableKeyOf(t)}: added primary key ${name}`);
  }
  return { model, changes };
}

const singularize = (s: string) => s.replace(/ies$/i, "y").replace(/(xes|ches|shes|sses)$/i, (m) => m.slice(0, -2)).replace(/s$/i, "");

/** Finds `xxx_id` / `xxxId` columns that clearly point at another table and adds the missing Ref. */
export function detectRelationships(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  const existing = new Set(model.refs.flatMap((r) => [`${tableKey(r.from.schema, r.from.table)}.${r.from.columns.join(",")}`, `${tableKey(r.to.schema, r.to.table)}.${r.to.columns.join(",")}`]));
  const index = new Map<string, TableModel>();
  for (const t of model.tables) {
    const n = t.name.toLowerCase();
    index.set(n, t);
    index.set(singularize(n), t);
  }
  for (const t of model.tables) {
    for (const c of t.columns) {
      if (c.pk && tablePkColumns(t).length === 1) continue; // a lone PK named user_id is unusual; skip
      const m = /^(.+?)(?:_id|Id|_ID)$/.exec(c.name);
      if (!m) continue;
      const stem = m[1].toLowerCase().replace(/[^a-z0-9]+/g, "_");
      const target = index.get(stem) || index.get(singularize(stem)) || index.get(stem + "s");
      if (!target || target === t) continue;
      const pk = tablePkColumns(target)[0];
      if (!pk) continue;
      const childKey = `${tableKey(t.schema, t.name)}.${c.name}`;
      if (existing.has(childKey)) continue;
      const ref: RefModel = {
        from: { schema: t.schema, table: t.name, columns: [c.name] },
        to: { schema: target.schema, table: target.name, columns: [pk] },
        type: "many-to-one",
      };
      model.refs.push(ref);
      existing.add(childKey);
      changes.push(`${t.name}.${c.name} → ${target.name}.${pk}`);
    }
  }
  return { model, changes };
}

export function addForeignKeyIndexes(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  for (const r of model.refs) {
    const child = r.type === "many-to-one" || r.type === "many-to-many" ? r.from : r.to;
    const table = model.tables.find((t) => t.name === child.table && (t.schema || "") === (child.schema || ""));
    if (!table || !child.columns.length) continue;
    const covered = table.indexes.some((ix) => ix.columns[0] === child.columns[0]) || table.columns.some((c) => c.pk && c.name === child.columns[0] && tablePkColumns(table).length === 1) || table.columns.some((c) => c.unique && c.name === child.columns[0]);
    if (covered) continue;
    table.indexes.push({ columns: [...child.columns], name: `idx_${table.name}_${child.columns.join("_")}` });
    changes.push(`${table.name}(${child.columns.join(", ")})`);
  }
  return { model, changes };
}

/** Groups tables by shared name prefix (`auth_users`, `auth_roles` → "auth"), falling back to schema names. */
export function createTableGroups(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  const existing = new Set(model.groups.flatMap((g) => g.tables));
  const prefixes = new Map<string, TableModel[]>();
  for (const t of model.tables) {
    if (existing.has(tableKeyOf(t))) continue;
    const prefix = t.schema && t.schema !== "public" ? t.schema : t.name.includes("_") ? t.name.split("_")[0] : "";
    if (!prefix) continue;
    if (!prefixes.has(prefix)) prefixes.set(prefix, []);
    prefixes.get(prefix)!.push(t);
  }
  let color = model.groups.length;
  for (const [prefix, tables] of prefixes) {
    if (tables.length < 2) continue;
    const name = prefix.replace(/(^|_)(\w)/g, (_m, _s, ch: string) => ch.toUpperCase());
    if (model.groups.some((g) => g.name === name)) continue;
    model.groups.push({ name, color: GROUP_COLORS[color++ % GROUP_COLORS.length], tables: tables.map(tableKeyOf) });
    changes.push(`${name}: ${tables.length} tables`);
  }
  // connected components as a fallback for the remaining tables
  const left = model.tables.filter((t) => !model.groups.some((g) => g.tables.includes(tableKeyOf(t))));
  if (left.length >= 3) {
    const adj = new Map<string, Set<string>>();
    for (const t of left) adj.set(tableKeyOf(t), new Set());
    for (const r of model.refs) {
      const a = tableKey(r.from.schema, r.from.table);
      const b = tableKey(r.to.schema, r.to.table);
      if (adj.has(a) && adj.has(b)) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
    const seen = new Set<string>();
    let n = 1;
    for (const key of adj.keys()) {
      if (seen.has(key)) continue;
      const comp: string[] = [];
      const stack = [key];
      while (stack.length) {
        const k = stack.pop()!;
        if (seen.has(k)) continue;
        seen.add(k);
        comp.push(k);
        for (const nb of adj.get(k)!) if (!seen.has(nb)) stack.push(nb);
      }
      if (comp.length >= 3) {
        const name = `Module ${n++}`;
        model.groups.push({ name, color: GROUP_COLORS[color++ % GROUP_COLORS.length], tables: comp });
        changes.push(`${name}: ${comp.length} connected tables`);
      }
    }
  }
  return { model, changes };
}

export function remapDataTypes(input: DiagramModel, target: SqlDialect): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  const enumNames = new Set(model.enums.map((e) => e.name));
  for (const t of model.tables) {
    for (const c of t.columns) {
      if (enumNames.has(c.type)) continue;
      const before = c.type;
      const ct = canonicalType(c.type);
      if (ct.kind === "other") continue;
      const after = convertType(c.type, target);
      if (after.toLowerCase() !== before.toLowerCase()) {
        c.type = after.toLowerCase();
        changes.push(`${t.name}.${c.name}: ${before} → ${c.type}`);
      }
    }
  }
  model.project.databaseType = target === "postgres" ? "PostgreSQL" : target === "mysql" ? "MySQL" : target === "mssql" ? "SQL Server" : target[0].toUpperCase() + target.slice(1);
  return { model, changes };
}

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();

export function snakeCaseNames(input: DiagramModel): ActionResult {
  const model = clone(input);
  const changes: string[] = [];
  const tableRename = new Map<string, string>();
  for (const t of model.tables) {
    const n = snake(t.name);
    if (n !== t.name) {
      tableRename.set(t.name, n);
      changes.push(`table ${t.name} → ${n}`);
      t.name = n;
    }
    for (const c of t.columns) {
      const cn = snake(c.name);
      if (cn !== c.name) c.name = cn;
    }
  }
  const fixEp = (ep: RefModel["from"]) => {
    ep.table = tableRename.get(ep.table) || ep.table;
    ep.columns = ep.columns.map(snake);
  };
  for (const r of model.refs) {
    fixEp(r.from);
    fixEp(r.to);
  }
  for (const g of model.groups) g.tables = g.tables.map((k) => tableRename.get(k) || k);
  for (const t of model.tables) t.indexes.forEach((ix) => (ix.columns = ix.columns.map((c) => (c.startsWith("`") ? c : snake(c)))));
  return { model, changes };
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  run: (m: DiagramModel, ctx: { dialect: SqlDialect }) => ActionResult;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "timestamps", label: "Add timestamps", description: "created_at / updated_at on every table", run: (m) => addTimestamps(m) },
  { id: "relationships", label: "Detect relationships", description: "Link *_id columns to the tables they reference", run: (m) => detectRelationships(m) },
  { id: "indexes", label: "Add foreign-key indexes", description: "Index FK columns that have no index yet", run: (m) => addForeignKeyIndexes(m) },
  { id: "groups", label: "Create table groups", description: "Group tables by prefix, schema or connectivity", run: (m) => createTableGroups(m) },
  { id: "pks", label: "Add missing primary keys", description: "Give every table an auto-increment id", run: (m) => addMissingPrimaryKeys(m) },
  { id: "snake", label: "snake_case names", description: "Normalise table and column names", run: (m) => snakeCaseNames(m) },
  { id: "remap", label: "Remap data types", description: "Convert types to the selected database", run: (m, ctx) => remapDataTypes(m, ctx.dialect) },
];
