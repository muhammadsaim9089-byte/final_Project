/**
 * One entry point for every import format. Everything ends up as a DiagramModel.
 */
import { DiagramModel, RefModel, TableModel, emptyModel } from "../model/types";
import { parseDbml } from "../dbml/parser";
import { parseSql } from "../sql/parser";
import { SqlDialect } from "../sql/dialects";
import { parseDjango, parseRails } from "../frameworkParsers";
import { parsePrismaSchema } from "./prisma";
import { csvTableName, looksLikeCsv, parseCsvTables } from "./csv";
import type { ParsedSchema } from "../sqlParser";

export type ImportFormat = "auto" | "dbml" | "sql" | "prisma" | "django" | "rails" | "json" | "mermaid" | "csv";

export const IMPORT_FORMATS: { id: Exclude<ImportFormat, "auto">; label: string; ext: string[]; hint: string }[] = [
  { id: "sql", label: "SQL DDL", ext: ["sql", "ddl", "txt"], hint: "CREATE TABLE … from PostgreSQL, MySQL, SQL Server, Oracle, SQLite, Snowflake, BigQuery" },
  { id: "dbml", label: "DBML", ext: ["dbml"], hint: "Database Markup Language (dbdiagram.io)" },
  { id: "prisma", label: "Prisma schema", ext: ["prisma"], hint: "schema.prisma models" },
  { id: "django", label: "Django models", ext: ["py"], hint: "models.py classes" },
  { id: "rails", label: "Rails schema", ext: ["rb"], hint: "db/schema.rb" },
  { id: "mermaid", label: "Mermaid ER", ext: ["mmd", "mermaid"], hint: "erDiagram blocks" },
  { id: "json", label: "JSON", ext: ["json"], hint: "DesignDB model or AI schema JSON" },
  { id: "csv", label: "CSV", ext: ["csv", "tsv"], hint: "Spreadsheet data — one table per file, types inferred" },
];

export interface ImportResult {
  model: DiagramModel;
  format: Exclude<ImportFormat, "auto">;
  dialect?: SqlDialect;
  warnings: string[];
  errors: string[];
}

export function detectFormat(text: string, filename?: string): Exclude<ImportFormat, "auto"> {
  const ext = (filename?.split(".").pop() || "").toLowerCase();
  const byExt = IMPORT_FORMATS.find((f) => f.ext.includes(ext) && ext !== "txt");
  if (byExt) return byExt.id;
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/^\s*erDiagram\b/m.test(t)) return "mermaid";
  if (/^\s*model\s+\w+\s*\{/m.test(t) || /\bdatasource\s+\w+\s*\{/.test(t)) return "prisma";
  if (/class\s+\w+\s*\(\s*(models\.)?Model\s*\)/.test(t)) return "django";
  if (/create_table\s+["']/.test(t)) return "rails";
  if (/\bcreate\s+(or\s+replace\s+)?(temp\w*\s+)?table\b/i.test(t) || /\balter\s+table\b/i.test(t)) return "sql";
  if (/^\s*(Table|Ref|Enum|TableGroup|Project|TablePartial|DiagramView|Dep|Records)\b/im.test(t)) return "dbml";
  if (looksLikeCsv(t)) return "csv";
  return "sql";
}

export function parsedSchemaToModel(ps: ParsedSchema): DiagramModel {
  const model = emptyModel();
  for (const e of ps.entities) {
    model.tables.push({
      name: e.name,
      columns: e.attributes.map((a) => ({ name: a.name, type: a.dataType || "varchar(255)", pk: a.isPrimaryKey || undefined, notNull: a.isPrimaryKey || undefined })),
      indexes: [],
      checks: [],
    });
  }
  for (const r of ps.relationships) {
    const child = r.fromEntity;
    const parent = r.toEntity;
    const parentCol = r.referencedKey || model.tables.find((t) => t.name === parent)?.columns.find((c) => c.pk)?.name || "id";
    const oneToOne = r.type === "one-to-one";
    const c = { table: child, columns: [r.foreignKey] };
    const p = { table: parent, columns: [parentCol] };
    model.refs.push(oneToOne ? { from: p, to: c, type: "one-to-one" } : { from: c, to: p, type: "many-to-one" });
  }
  return model;
}

/** AI schema JSON ({ entities, relationships }) → model. */
export function legacySchemaToModel(data: any): DiagramModel {
  const model = emptyModel();
  for (const e of data.entities || []) {
    model.tables.push({
      name: e.name,
      schema: e.schema || undefined,
      note: e.description || e.comment || undefined,
      columns: (e.attributes || []).map((a: any) => {
        const col: TableModel["columns"][number] = { name: a.name, type: a.dataType || a.type || "varchar(255)" };
        if (a.isPrimaryKey || a.isPk) col.pk = true;
        if ((a.isNullable === false || a.allowNull === false) && !col.pk) col.notNull = true;
        if (a.isUnique && !col.pk) col.unique = true;
        if (a.autoIncrement) col.increment = true;
        if (a.defaultValue !== undefined && a.defaultValue !== null && a.defaultValue !== "") {
          const d = String(a.defaultValue);
          col.default = /^-?\d+(\.\d+)?$/.test(d) ? { kind: "number", value: d } : /^(true|false)$/i.test(d) ? { kind: "boolean", value: d.toLowerCase() } : /^'.*'$/.test(d) ? { kind: "string", value: d.slice(1, -1) } : { kind: "expression", value: d };
        }
        return col;
      }),
      indexes: (e.indexes || []).map((i: any) => ({ columns: i.columns || [], name: i.name, unique: i.type === "UNIQUE" || undefined })),
      checks: (e.constraints || []).filter((c: any) => c.expression).map((c: any) => ({ expression: c.expression, name: c.name })),
    });
  }
  for (const r of data.relationships || []) {
    const parent = model.tables.find((t) => t.name === r.toEntity);
    const pk = r.referencedKey || parent?.columns.find((c) => c.pk)?.name || "id";
    const oneToOne = r.type === "one-to-one";
    const c = { table: r.fromEntity, columns: [r.foreignKey] };
    const p = { table: r.toEntity, columns: [pk] };
    const ref: RefModel = oneToOne ? { from: p, to: c, type: "one-to-one" } : r.type === "many-to-many" ? { from: c, to: p, type: "many-to-many" } : { from: c, to: p, type: "many-to-one" };
    if (r.onDelete) ref.onDelete = String(r.onDelete).toLowerCase() as any;
    if (r.onUpdate) ref.onUpdate = String(r.onUpdate).toLowerCase() as any;
    model.refs.push(ref);
  }
  return model;
}

/** Mermaid `erDiagram` → model (foreign-key columns are inferred when the diagram doesn't list them). */
export function parseMermaidEr(text: string): { model: DiagramModel; warnings: string[] } {
  const model = emptyModel();
  const warnings: string[] = [];
  const tables = new Map<string, TableModel>();
  const get = (name: string) => {
    if (!tables.has(name)) tables.set(name, { name, columns: [], indexes: [], checks: [] });
    return tables.get(name)!;
  };
  const lines = text.replace(/\r/g, "").split("\n");
  let current: TableModel | null = null;
  const relRe = /^\s*([\w"-]+)\s+([|}o]{1,2})(?:--|\.\.)([|{o]{1,2})\s+([\w"-]+)\s*(?::\s*(.*))?$/;
  const rels: { a: string; b: string; left: string; right: string }[] = [];
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, "").trimEnd();
    if (!line.trim() || /^\s*erDiagram/.test(line)) continue;
    if (current) {
      if (/^\s*}\s*$/.test(line)) {
        current = null;
        continue;
      }
      const m = /^\s*([\w()[\],]+)\s+([\w]+)\s*((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?\s*(?:"([^"]*)")?/.exec(line);
      if (m) {
        const keys = (m[3] || "").split(/\s*,\s*/);
        current.columns.push({ name: m[2], type: m[1].toLowerCase(), pk: keys.includes("PK") || undefined, unique: keys.includes("UK") || undefined, note: m[4] || undefined });
      }
      continue;
    }
    const block = /^\s*([\w"-]+)\s*\{\s*$/.exec(line);
    if (block) {
      current = get(block[1].replace(/"/g, ""));
      continue;
    }
    const rel = relRe.exec(line);
    if (rel) {
      get(rel[1].replace(/"/g, ""));
      get(rel[4].replace(/"/g, ""));
      rels.push({ a: rel[1].replace(/"/g, ""), b: rel[4].replace(/"/g, ""), left: rel[2], right: rel[3] });
      continue;
    }
    warnings.push(`Ignored line: ${line.trim()}`);
  }
  const isMany = (s: string) => s.includes("{") || s.includes("}");
  for (const r of rels) {
    const aMany = isMany(r.left);
    const bMany = isMany(r.right);
    // the "one" side is the parent; when both/neither are many treat the left as parent
    const parentName = bMany && !aMany ? r.a : aMany && !bMany ? r.b : r.a;
    const childName = parentName === r.a ? r.b : r.a;
    const parent = get(parentName);
    const child = get(childName);
    let pk = parent.columns.find((c) => c.pk)?.name;
    if (!pk) {
      pk = "id";
      parent.columns.unshift({ name: "id", type: "integer", pk: true, increment: true });
    }
    const fk = `${parentName.toLowerCase()}_${pk}`;
    if (!child.columns.some((c) => c.name === fk)) child.columns.push({ name: fk, type: parent.columns.find((c) => c.name === pk)?.type || "integer" });
    model.refs.push({ from: { table: childName, columns: [fk] }, to: { table: parentName, columns: [pk] }, type: aMany && bMany ? "many-to-one" : "many-to-one" });
  }
  model.tables = [...tables.values()];
  return { model, warnings };
}

export function importText(text: string, format: ImportFormat = "auto", opts: { filename?: string; dialect?: SqlDialect } = {}): ImportResult {
  const fmt = format === "auto" ? detectFormat(text, opts.filename) : format;
  const warnings: string[] = [];
  const errors: string[] = [];
  let model = emptyModel();
  let dialect: SqlDialect | undefined;
  try {
    switch (fmt) {
      case "dbml": {
        const r = parseDbml(text);
        model = r.model;
        for (const d of r.diagnostics) (d.severity === "error" ? errors : warnings).push(`Line ${d.line}: ${d.message}`);
        break;
      }
      case "sql": {
        const r = parseSql(text, opts.dialect);
        model = r.model;
        dialect = r.dialect;
        warnings.push(...r.warnings);
        break;
      }
      case "prisma": {
        const r = parsePrismaSchema(text);
        model = r.model;
        warnings.push(...r.warnings);
        break;
      }
      case "django":
        model = parsedSchemaToModel(parseDjango(text));
        break;
      case "rails":
        model = parsedSchemaToModel(parseRails(text));
        break;
      case "mermaid": {
        const r = parseMermaidEr(text);
        model = r.model;
        warnings.push(...r.warnings);
        break;
      }
      case "csv": {
        const r = parseCsvTables(text, { defaultName: opts.filename ? csvTableName(opts.filename) : undefined });
        model = r.model;
        warnings.push(...r.warnings);
        break;
      }
      case "json": {
        const data = JSON.parse(text);
        if (data && Array.isArray(data.tables) && (data.refs || data.enums || data.groups || data.project)) {
          model = { ...emptyModel(), ...data };
        } else if (data && Array.isArray(data.entities)) model = legacySchemaToModel(data);
        else throw new Error("JSON must be a DesignDB model ({ tables, refs }) or an AI schema ({ entities, relationships })");
        break;
      }
    }
  } catch (e: any) {
    errors.push(e?.message || String(e));
  }
  if (!errors.length && model.tables.length === 0) errors.push(`No tables were found — check that the input is ${IMPORT_FORMATS.find((f) => f.id === fmt)?.label || fmt}.`);
  return { model, format: fmt, dialect, warnings, errors };
}
