import { DiagramModel, tableKey, tableKeyOf } from "./types";

export interface MergeResult {
  model: DiagramModel;
  addedTables: string[];
  skippedTables: string[];
}

/**
 * Adds `incoming` to `base`. Tables that already exist (same schema + name) are kept as they are and
 * reported in `skippedTables`; everything that references only new or existing tables is carried over.
 */
export function mergeModels(base: DiagramModel, incoming: DiagramModel): MergeResult {
  const model: DiagramModel = JSON.parse(JSON.stringify(base));
  const have = new Set(model.tables.map(tableKeyOf));
  const addedTables: string[] = [];
  const skippedTables: string[] = [];
  for (const t of incoming.tables) {
    const k = tableKeyOf(t);
    if (have.has(k)) {
      skippedTables.push(k);
      continue;
    }
    have.add(k);
    model.tables.push(JSON.parse(JSON.stringify(t)));
    addedTables.push(k);
  }
  const refKey = (r: DiagramModel["refs"][number]) => `${tableKey(r.from.schema, r.from.table)}(${r.from.columns})${r.type}${tableKey(r.to.schema, r.to.table)}(${r.to.columns})`;
  const haveRefs = new Set(model.refs.map(refKey));
  for (const r of incoming.refs) {
    const a = have.has(tableKey(r.from.schema, r.from.table));
    const b = have.has(tableKey(r.to.schema, r.to.table));
    if (!a || !b || haveRefs.has(refKey(r))) continue;
    // only refs that touch at least one newly added table (existing-existing refs are already modelled)
    const touchesNew = addedTables.includes(tableKey(r.from.schema, r.from.table)) || addedTables.includes(tableKey(r.to.schema, r.to.table));
    if (!touchesNew) continue;
    haveRefs.add(refKey(r));
    model.refs.push(JSON.parse(JSON.stringify(r)));
  }
  for (const e of incoming.enums) if (!model.enums.some((x) => x.name === e.name && (x.schema || "") === (e.schema || ""))) model.enums.push(JSON.parse(JSON.stringify(e)));
  for (const g of incoming.groups) {
    const ex = model.groups.find((x) => x.name === g.name);
    const tables = g.tables.filter((k) => have.has(k));
    if (ex) ex.tables = Array.from(new Set([...ex.tables, ...tables]));
    else if (tables.length) model.groups.push({ ...g, tables });
  }
  for (const n of incoming.notes) model.notes.push({ ...n });
  for (const d of incoming.deps) model.deps.push(JSON.parse(JSON.stringify(d)));
  for (const v of incoming.views) if (!model.views.some((x) => x.id === v.id)) model.views.push(JSON.parse(JSON.stringify(v)));
  if (!model.project.name && incoming.project.name) model.project = { ...incoming.project };
  return { model, addedTables, skippedTables };
}
