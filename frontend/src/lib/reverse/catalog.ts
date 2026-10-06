/**
 * Reverse engineering: database catalog → DiagramModel, plus the DDL-export instructions for databases
 * we cannot reach from the server (SQL Server, Oracle, Snowflake …). The exported DDL is parsed by the
 * SQL parser, which is tested against pg_dump / mysqldump / SSMS style scripts.
 */
import { DiagramModel, EnumModel, IndexModel, RefModel, ReferentialAction, TableModel, emptyModel } from "../model/types";

export interface CatalogColumn {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string | null;
  autoIncrement?: boolean;
  comment?: string | null;
}

export interface CatalogTable {
  schema?: string;
  name: string;
  comment?: string | null;
  columns: CatalogColumn[];
  primaryKey?: string[];
  uniques?: { name?: string; columns: string[] }[];
  checks?: { name?: string; expression: string }[];
}

export interface CatalogForeignKey {
  name?: string;
  schema?: string;
  table: string;
  columns: string[];
  refSchema?: string;
  refTable: string;
  refColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface CatalogIndex {
  schema?: string;
  table: string;
  name: string;
  columns: string[];
  unique?: boolean;
  type?: string;
}

export interface Catalog {
  tables: CatalogTable[];
  foreignKeys: CatalogForeignKey[];
  indexes: CatalogIndex[];
  enums: { schema?: string; name: string; values: string[] }[];
}

const DEFAULT_SCHEMAS = new Set(["public", "dbo", "main"]);
const normSchema = (s?: string) => (s && !DEFAULT_SCHEMAS.has(s.toLowerCase()) ? s : undefined);

function action(a?: string): ReferentialAction | undefined {
  if (!a) return undefined;
  const v = a.toLowerCase().replace(/_/g, " ").trim();
  if (v === "cascade" || v === "restrict" || v === "set null" || v === "set default" || v === "no action") return v;
  return undefined;
}

export function catalogToModel(c: Catalog, opts: { mysqlDatabase?: boolean } = {}): DiagramModel {
  const model = emptyModel();
  const byKey = new Map<string, TableModel>();
  const key = (schema: string | undefined, name: string) => `${normSchema(schema) || ""}.${name}`;
  const enums: EnumModel[] = c.enums.map((e) => ({ schema: normSchema(e.schema), name: e.name, values: e.values.map((v) => ({ name: v })) }));

  for (const t of c.tables) {
    const table: TableModel = {
      schema: opts.mysqlDatabase ? undefined : normSchema(t.schema),
      name: t.name,
      note: t.comment || undefined,
      columns: [],
      indexes: [],
      checks: (t.checks || []).map((x) => ({ expression: x.expression, name: x.name })),
    };
    const pk = new Set(t.primaryKey || []);
    for (const col of t.columns) {
      let type = col.type;
      const em = /^enum\s*\((.*)\)$/i.exec(type);
      if (em) {
        const values = Array.from(em[1].matchAll(/'((?:[^']|'')*)'/g)).map((m) => ({ name: m[1].replace(/''/g, "'") }));
        const enName = `${t.name}_${col.name}`;
        if (!enums.some((e) => e.name === enName)) enums.push({ schema: table.schema, name: enName, values });
        type = enName;
      }
      const single = pk.size === 1 && pk.has(col.name);
      const m: TableModel["columns"][number] = { name: col.name, type };
      if (single) {
        m.pk = true;
        m.notNull = true;
      } else if (col.nullable === false) m.notNull = true;
      if (col.autoIncrement) m.increment = true;
      if (col.default !== undefined && col.default !== null && col.default !== "" && !col.autoIncrement) {
        const d = String(col.default);
        if (/^-?\d+(\.\d+)?$/.test(d)) m.default = { kind: "number", value: d };
        else if (/^'.*'(::[\w\s."]+)?$/s.test(d)) m.default = { kind: "string", value: d.replace(/^'(.*)'(::[\w\s."]+)?$/s, "$1").replace(/''/g, "'") };
        else if (/^(true|false)$/i.test(d)) m.default = { kind: "boolean", value: d.toLowerCase() };
        else if (/^null$/i.test(d)) m.default = { kind: "null", value: "null" };
        else m.default = { kind: "expression", value: d };
      }
      if (col.comment) m.note = col.comment;
      table.columns.push(m);
    }
    if (pk.size > 1) table.indexes.push({ columns: [...pk], pk: true });
    for (const u of t.uniques || []) {
      if (u.columns.length === 1) {
        const col = table.columns.find((x) => x.name === u.columns[0]);
        if (col?.pk) continue; // the key is unique already (some catalogs list the primary key among the uniques)
        if (col) {
          col.unique = true;
          continue;
        }
      }
      table.indexes.push({ columns: u.columns, unique: true, name: u.name });
    }
    model.tables.push(table);
    byKey.set(key(t.schema, t.name), table);
  }

  for (const ix of c.indexes) {
    const t = byKey.get(key(ix.schema, ix.table));
    if (!t) continue;
    const dup = t.indexes.some((x) => x.columns.join(",") === ix.columns.join(",") && !!x.unique === !!ix.unique);
    if (dup) continue;
    if (ix.unique && ix.columns.length === 1) {
      const col = t.columns.find((x) => x.name === ix.columns[0]);
      if (col && (col.pk || col.unique)) continue;
    }
    const model_ix: IndexModel = { columns: ix.columns, name: ix.name };
    if (ix.unique) model_ix.unique = true;
    if (ix.type && ix.type.toLowerCase() !== "btree") model_ix.type = ix.type.toLowerCase();
    t.indexes.push(model_ix);
  }

  for (const fk of c.foreignKeys) {
    const child = byKey.get(key(fk.schema, fk.table));
    const parent = byKey.get(key(fk.refSchema, fk.refTable));
    if (!child) continue;
    const childPk = c.tables.find((x) => key(x.schema, x.name) === key(fk.schema, fk.table))?.primaryKey || [];
    const oneToOne = fk.columns.length === 1 && (childPk.length === 1 && childPk[0] === fk.columns[0] ? true : !!child.columns.find((x) => x.name === fk.columns[0] && x.unique));
    const childEp = { schema: child.schema, table: child.name, columns: fk.columns };
    const parentEp = { schema: parent?.schema, table: parent?.name || fk.refTable, columns: fk.refColumns };
    const ref: RefModel = oneToOne
      ? { name: fk.name, from: parentEp, to: childEp, type: "one-to-one", onDelete: action(fk.onDelete), onUpdate: action(fk.onUpdate) }
      : { name: fk.name, from: childEp, to: parentEp, type: "many-to-one", onDelete: action(fk.onDelete), onUpdate: action(fk.onUpdate) };
    model.refs.push(ref);
  }
  model.enums = enums;
  return model;
}

// ───────────────────────────── DDL export instructions ─────────────────────────────

export interface ExtractionGuide {
  id: string;
  label: string;
  steps: string[];
  script: string;
  note?: string;
}

export const EXTRACTION_GUIDES: ExtractionGuide[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    steps: ["Run this in a terminal (schema only, no data):", "Paste the resulting file into the box below."],
    script: "pg_dump --schema-only --no-owner --no-privileges -h HOST -U USER -d DBNAME > schema.sql",
    note: "Add -n schema_name to export a single schema.",
  },
  {
    id: "mysql",
    label: "MySQL / MariaDB",
    steps: ["Run this in a terminal (structure only):", "Paste the resulting file into the box below."],
    script: "mysqldump --no-data --skip-comments -h HOST -u USER -p DBNAME > schema.sql",
  },
  {
    id: "mssql",
    label: "SQL Server",
    steps: ["In SSMS: right-click the database → Tasks → Generate Scripts…", "Choose “Script entire database”, then Advanced → Types of data to script = “Schema only”.", "Paste the generated script below."],
    script: "-- or, from a terminal with the mssql-scripter tool:\nmssql-scripter -S HOST -d DBNAME -U USER --schema-and-data none > schema.sql",
  },
  {
    id: "oracle",
    label: "Oracle",
    steps: ["Run this query in SQL Developer / SQL*Plus and copy the result:"],
    script:
      "SET LONG 1000000 PAGESIZE 0 LINESIZE 32767 TRIMSPOOL ON\nBEGIN\n  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);\n  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);\nEND;\n/\nSELECT DBMS_METADATA.GET_DDL('TABLE', table_name) FROM user_tables;\nSELECT DBMS_METADATA.GET_DDL('REF_CONSTRAINT', constraint_name) FROM user_constraints WHERE constraint_type = 'R';",
  },
  {
    id: "snowflake",
    label: "Snowflake",
    steps: ["Run this in a worksheet and copy the single result cell:"],
    script: "SELECT GET_DDL('SCHEMA', 'DB_NAME.SCHEMA_NAME', TRUE);",
  },
  {
    id: "bigquery",
    label: "Google BigQuery",
    steps: ["Run this query in the BigQuery console and copy the ddl column:"],
    script: "SELECT STRING_AGG(ddl, ';\\n') FROM `PROJECT.DATASET`.INFORMATION_SCHEMA.TABLES WHERE table_type = 'BASE TABLE';",
  },
  {
    id: "sqlite",
    label: "SQLite (file)",
    steps: ["No need to paste anything — use “Open SQLite file” to load the .db / .sqlite file directly in your browser."],
    script: "sqlite3 my.db .schema",
  },
];
