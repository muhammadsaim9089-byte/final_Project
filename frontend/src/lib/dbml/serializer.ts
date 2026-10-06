/**
 * Model → DBML text. Output is deterministic and follows dbdiagram's own export style.
 */
import {
  ColumnModel,
  DefaultValue,
  DepEndpoint,
  DiagramModel,
  IndexModel,
  RecordValue,
  RefEndpoint,
  RefModel,
  RefType,
  TableModel,
  DEFAULT_VIEW_ID,
} from "../model/types";

const PLAIN_IDENT = /^[A-Za-z_-￿][A-Za-z0-9_$-￿]*$/;

export function dbmlIdent(name: string): string {
  return PLAIN_IDENT.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`;
}

export function dbmlString(text: string, indent = ""): string {
  if (text.includes("\n")) {
    const body = text
      .replace(/\\/g, "\\\\")
      .replace(/'''/g, "\\'\\'\\'")
      .split("\n")
      .map((l) => (l ? indent + "  " + l : l))
      .join("\n");
    return `'''\n${body}\n${indent}'''`;
  }
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function typeText(type: string): string {
  const t = (type || "varchar").trim();
  // quote types that contain spaces outside their (...) part, e.g. "double precision"
  const outside = t.replace(/\([^)]*\)/g, "");
  if (/\s/.test(outside) && !/^".*"$/.test(t)) return `"${t.replace(/"/g, '\\"')}"`;
  if (!/^[A-Za-z_-￿][A-Za-z0-9_$.-￿()\[\],'" ]*$/.test(t)) return `"${t.replace(/"/g, '\\"')}"`;
  return t.replace(/\s*,\s*/g, ",");
}

export function dbmlDefault(d: DefaultValue): string {
  switch (d.kind) {
    case "string":
      return dbmlString(d.value);
    case "number":
    case "boolean":
    case "null":
      return d.value;
    default:
      return "`" + d.value + "`";
  }
}

function columnSettings(c: ColumnModel): string {
  const s: string[] = [];
  if (c.pk) s.push("pk");
  if (c.increment) s.push("increment");
  if (c.notNull) s.push("not null");
  if (c.unique) s.push("unique");
  if (c.default) s.push(`default: ${dbmlDefault(c.default)}`);
  for (const ck of c.checks || []) s.push("check: `" + ck + "`");
  if (c.note) s.push(`note: ${dbmlString(c.note)}`);
  if (c.meta) for (const [k, v] of Object.entries(c.meta)) s.push(`${dbmlIdent(k)}: ${dbmlString(v)}`);
  return s.length ? ` [${s.join(", ")}]` : "";
}

function indexLine(ix: IndexModel): string {
  const cols = ix.columns.map((c) => (c.startsWith("`") ? c : dbmlIdent(c)));
  const head = cols.length === 1 && !cols[0].startsWith("`") ? cols[0] : `(${cols.join(", ")})`;
  const s: string[] = [];
  if (ix.pk) s.push("pk");
  if (ix.unique) s.push("unique");
  if (ix.name) s.push(`name: ${dbmlString(ix.name)}`);
  if (ix.type) s.push(`type: ${ix.type.toLowerCase()}`);
  if (ix.note) s.push(`note: ${dbmlString(ix.note)}`);
  return `${head}${s.length ? ` [${s.join(", ")}]` : ""}`;
}

function recordValue(v: RecordValue): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v.startsWith("`") && v.endsWith("`") && v.length > 1) return v;
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`;
}

function tableBlock(t: TableModel): string {
  const head: string[] = [];
  const settings: string[] = [];
  if (t.headerColor) settings.push(`headercolor: ${t.headerColor}`);
  if (t.meta) for (const [k, v] of Object.entries(t.meta)) settings.push(`${dbmlIdent(k)}: ${dbmlString(v)}`);
  head.push(`Table ${t.schema && t.schema !== "public" ? dbmlIdent(t.schema) + "." : ""}${dbmlIdent(t.name)}`);
  if (t.alias) head.push(`as ${dbmlIdent(t.alias)}`);
  if (settings.length) head.push(`[${settings.join(", ")}]`);
  const lines: string[] = [`${head.join(" ")} {`];
  // A composite primary key is written as `(a, b) [pk]` inside `indexes`, like dbdiagram does.
  const pkCols = t.columns.filter((c) => c.pk);
  const compositePk = pkCols.length > 1 && !t.indexes.some((i) => i.pk);
  for (const c of t.columns) lines.push(`  ${dbmlIdent(c.name)} ${typeText(c.type)}${columnSettings(compositePk ? { ...c, pk: false } : c)}`);
  const indexes = compositePk ? [{ columns: pkCols.map((c) => c.name), pk: true } as IndexModel, ...t.indexes] : t.indexes;
  if (indexes.length) {
    lines.push("", "  indexes {");
    for (const ix of indexes) lines.push(`    ${indexLine(ix)}`);
    lines.push("  }");
  }
  if (t.checks.length) {
    lines.push("", "  checks {");
    for (const ck of t.checks) lines.push(`    \`${ck.expression}\`${ck.name ? ` [name: ${dbmlString(ck.name)}]` : ""}`);
    lines.push("  }");
  }
  if (t.note) lines.push("", `  Note: ${dbmlString(t.note, "  ")}`);
  if (t.records && t.records.rows.length) {
    lines.push("", `  records (${t.records.columns.map(dbmlIdent).join(", ")}) {`);
    for (const row of t.records.rows) lines.push(`    ${row.map(recordValue).join(", ")}`);
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n");
}

function endpointText(e: RefEndpoint): string {
  const tbl = `${e.schema && e.schema !== "public" ? dbmlIdent(e.schema) + "." : ""}${dbmlIdent(e.table)}`;
  if (e.columns.length === 1) return `${tbl}.${dbmlIdent(e.columns[0])}`;
  return `${tbl}.(${e.columns.map(dbmlIdent).join(", ")})`;
}

export function refOperator(type: RefType, fromOptional?: boolean, toOptional?: boolean): string {
  const op = type === "one-to-many" ? "<" : type === "many-to-one" ? ">" : type === "one-to-one" ? "-" : "<>";
  return `${fromOptional ? "?" : ""}${op}${toOptional ? "?" : ""}`;
}

function refLine(r: RefModel): string {
  const settings: string[] = [];
  if (r.onDelete) settings.push(`delete: ${r.onDelete}`);
  if (r.onUpdate) settings.push(`update: ${r.onUpdate}`);
  if (r.color) settings.push(`color: ${r.color}`);
  const name = r.name ? ` ${dbmlIdent(r.name)}` : "";
  return `Ref${name}: ${endpointText(r.from)} ${refOperator(r.type, r.fromOptional, r.toOptional)} ${endpointText(r.to)}${settings.length ? ` [${settings.join(", ")}]` : ""}`;
}

function depEndpointText(e: DepEndpoint): string {
  const tbl = `${e.schema && e.schema !== "public" ? dbmlIdent(e.schema) + "." : ""}${dbmlIdent(e.table)}`;
  return e.column ? `${tbl}.${dbmlIdent(e.column)}` : tbl;
}

export interface DbmlSerializeOptions {
  /** Emit Records blocks (sample data). Default true. */
  includeRecords?: boolean;
}

export function modelToDbml(model: DiagramModel, opts: DbmlSerializeOptions = {}): string {
  const blocks: string[] = [];
  const p = model.project;
  if (p.name || p.databaseType || p.note || (p.extra && Object.keys(p.extra).length)) {
    const lines = [`Project ${dbmlIdent(p.name || "project")} {`];
    if (p.databaseType) lines.push(`  database_type: ${dbmlString(p.databaseType)}`);
    for (const [k, v] of Object.entries(p.extra || {})) lines.push(`  ${dbmlIdent(k)}: ${dbmlString(v)}`);
    if (p.note) lines.push(`  Note: ${dbmlString(p.note, "  ")}`);
    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  for (const e of model.enums) {
    const lines = [`Enum ${e.schema && e.schema !== "public" ? dbmlIdent(e.schema) + "." : ""}${dbmlIdent(e.name)} {`];
    for (const v of e.values) lines.push(`  ${dbmlIdent(v.name)}${v.note ? ` [note: ${dbmlString(v.note)}]` : ""}`);
    if (e.note) lines.push(`  Note: ${dbmlString(e.note, "  ")}`);
    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  const tables = opts.includeRecords === false ? model.tables.map((t) => ({ ...t, records: undefined })) : model.tables;
  for (const t of tables) blocks.push(tableBlock(t));

  if (model.refs.length) blocks.push(model.refs.map(refLine).join("\n"));

  for (const g of model.groups) {
    if (!g.tables.length && !g.note) continue;
    const settings = g.color ? ` [color: ${g.color}]` : "";
    const lines = [`TableGroup ${dbmlIdent(g.name)}${settings} {`];
    for (const key of g.tables) lines.push(`  ${key.split(".").map(dbmlIdent).join(".")}`);
    if (g.note) lines.push("", `  Note: ${dbmlString(g.note, "  ")}`);
    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  for (const n of model.notes) {
    blocks.push(`Note ${dbmlIdent(n.name)} {\n  ${dbmlString(n.text, "  ")}\n}`);
  }

  if (model.deps.length) {
    blocks.push(
      model.deps
        .map((d) => {
          const s: string[] = [];
          if (d.note) s.push(`note: ${dbmlString(d.note)}`);
          if (d.color) s.push(`color: ${d.color}`);
          for (const [k, v] of Object.entries(d.custom || {})) s.push(`${dbmlIdent(k)}: ${dbmlString(v)}`);
          return `Dep${d.name ? " " + dbmlIdent(d.name) : ""}: ${depEndpointText(d.from)} -> ${depEndpointText(d.to)}${s.length ? ` [${s.join(", ")}]` : ""}`;
        })
        .join("\n")
    );
  }

  for (const v of model.views) {
    const lines = [`DiagramView ${v.id === DEFAULT_VIEW_ID ? "Default" : dbmlIdent(v.name)} {`];
    if (v.tables === "*") lines.push("  Tables { * }");
    else if (v.tables.length) lines.push(`  Tables { ${v.tables.map((k) => k.split(".").map(dbmlIdent).join(".")).join(" ")} }`);
    if (v.groups.length) lines.push(`  TableGroups { ${v.groups.map(dbmlIdent).join(" ")} }`);
    if (v.schemas.length) lines.push(`  Schemas { ${v.schemas.map(dbmlIdent).join(" ")} }`);
    lines.push("}");
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n") + (blocks.length ? "\n" : "");
}

/**
 * Re-indents DBML by brace depth and trims trailing whitespace while keeping comments and
 * the author's line structure. Used by the editor's "Format" action.
 */
export function formatDbmlText(text: string): string {
  const out: string[] = [];
  let depth = 0;
  let inTriple = false;
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (inTriple) {
      out.push(raw.replace(/\s+$/, ""));
      if (raw.includes("'''")) inTriple = false;
      continue;
    }
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    // strip strings/comments for brace counting
    const scan = line.replace(/'''[\s\S]*?'''/g, "").replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`[^`]*`/g, "``").replace(/\/\/.*$/, "");
    const opens = (scan.match(/\{/g) || []).length;
    const closes = (scan.match(/\}/g) || []).length;
    const leadingClose = /^\}/.test(scan.trim());
    const indentLevel = Math.max(0, depth - (leadingClose ? 1 : 0));
    out.push("  ".repeat(indentLevel) + line);
    depth = Math.max(0, depth + opens - closes);
    const tripleCount = (line.match(/'''/g) || []).length;
    if (tripleCount % 2 === 1) inTriple = true;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}
