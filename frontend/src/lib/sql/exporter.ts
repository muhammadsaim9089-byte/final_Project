/**
 * DiagramModel → DDL for PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Snowflake, BigQuery,
 * Redshift and Databricks — plus a MongoDB ($jsonSchema) script.
 */
import {
  ColumnModel,
  DefaultValue,
  DiagramModel,
  EnumModel,
  IndexModel,
  RecordValue,
  ReferentialAction,
  TableModel,
  tableKey,
  tableKeyOf,
} from "../model/types";
import { CanonicalType, SqlDialect, canonicalType, dialectLabel, renderType } from "./dialects";

export interface SqlExportOptions {
  dialect: SqlDialect;
  includeDrop?: boolean;
  /** Emit foreign keys as ALTER TABLE statements after all tables. Cycles force this automatically. */
  useAlterTable?: boolean;
  includeIndexes?: boolean;
  /** CREATE INDEX for every foreign-key column. */
  fkIndexes?: boolean;
  includeComments?: boolean;
  includeSeedData?: boolean;
  ifNotExists?: boolean;
}

/** Words that are reserved in at least one of the supported dialects and would break an unquoted identifier. */
const RESERVED = new Set(
  (
    "select insert update delete from where table create drop alter index key primary foreign references check default unique " +
    "order group by having user limit offset join left right inner outer cross natural on as and or not null in is like between " +
    "case when then else end column constraint values set into view trigger grant revoke all any some union exists distinct " +
    "desc asc to row rows current current_date current_time current_timestamp with using for while if"
  ).split(" ")
);
const ORACLE_EXTRA = new Set(["date", "number", "level", "size", "session", "share", "uid", "option", "comment", "public", "start", "file", "type", "timestamp", "mode"]);

function needsQuote(name: string, d: SqlDialect): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) return true;
  const lower = name.toLowerCase();
  if (RESERVED.has(lower)) return true;
  if ((d === "oracle" || d === "snowflake") && ORACLE_EXTRA.has(lower)) return true;
  if (d === "postgres" || d === "redshift") return /[A-Z]/.test(name);
  if (d === "oracle" || d === "snowflake") return /[a-z]/.test(name) && /[A-Z]/.test(name);
  return false;
}

export function quoteIdent(name: string, d: SqlDialect): string {
  if (!needsQuote(name, d)) return name;
  switch (d) {
    case "mysql":
    case "bigquery":
    case "databricks":
      return "`" + name.replace(/`/g, "``") + "`";
    case "mssql":
      return "[" + name.replace(/]/g, "]]") + "]";
    default:
      return '"' + name.replace(/"/g, '""') + '"';
  }
}

const sqlString = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

export interface ResolvedFk {
  name: string;
  child: TableModel;
  parent: TableModel;
  childCols: string[];
  parentCols: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

interface Working {
  tables: TableModel[];
  fks: ResolvedFk[];
  byKey: Map<string, TableModel>;
}

export function qualifiedName(t: TableModel, d: SqlDialect): string {
  const schema = t.schema && t.schema !== "public" ? t.schema : "";
  if (!schema) return quoteIdent(t.name, d);
  if (d === "sqlite") return quoteIdent(`${schema}_${t.name}`, d);
  return `${quoteIdent(schema, d)}.${quoteIdent(t.name, d)}`;
}

export function pkColumns(t: TableModel): string[] {
  const inline = t.columns.filter((c) => c.pk).map((c) => c.name);
  if (inline.length) return inline;
  const idx = t.indexes.find((i) => i.pk);
  return idx ? idx.columns : [];
}

export function findEnum(model: DiagramModel, type: string): EnumModel | undefined {
  const t = type.trim();
  return model.enums.find((e) => e.name === t || (e.schema ? `${e.schema}.${e.name}` === t : false));
}

/** Resolve refs into concrete child→parent foreign keys and synthesise junction tables for many-to-many. */
function resolve(model: DiagramModel): Working {
  const tables = model.tables.map((t) => ({ ...t, columns: t.columns.map((c) => ({ ...c })) }));
  const byKey = new Map(tables.map((t) => [tableKeyOf(t), t]));
  const fks: ResolvedFk[] = [];
  const usedNames = new Set<string>();
  const fkName = (child: string, cols: string[]) => {
    const base = `fk_${child}_${cols.join("_")}`;
    let n = base;
    let i = 2;
    while (usedNames.has(n)) n = `${base}_${i++}`;
    usedNames.add(n);
    return n;
  };

  const find = (ep: { schema?: string; table: string }) => byKey.get(tableKey(ep.schema, ep.table)) || tables.find((t) => t.name === ep.table);

  for (const r of model.refs) {
    const a = find(r.from);
    const b = find(r.to);
    if (!a || !b) continue;
    if (r.type === "many-to-many") {
      const aPk = r.from.columns.length ? r.from.columns : pkColumns(a);
      const bPk = r.to.columns.length ? r.to.columns : pkColumns(b);
      if (!aPk.length || !bPk.length) continue;
      const jName = `${a.name}_${b.name}`;
      if (byKey.has(jName)) continue;
      const mkCols = (t: TableModel, pk: string[]): ColumnModel[] =>
        pk.map((c) => {
          const src = t.columns.find((x) => x.name === c);
          const ct = src ? canonicalType(src.type) : undefined;
          const type = ct && ct.kind !== "other" ? (ct.kind === "varchar" ? `varchar(${ct.args || 255})` : ct.kind) : src?.type || "integer";
          return { name: pk.length === 1 ? `${t.name}_${c}` : `${t.name}_${c}`, type, notNull: true, pk: true };
        });
      const junction: TableModel = {
        schema: a.schema,
        name: jName,
        columns: [...mkCols(a, aPk), ...mkCols(b, bPk)],
        indexes: [],
        checks: [],
        note: `Junction table for ${a.name} <> ${b.name}`,
      };
      tables.push(junction);
      byKey.set(tableKeyOf(junction), junction);
      const aCols = junction.columns.slice(0, aPk.length).map((c) => c.name);
      const bCols = junction.columns.slice(aPk.length).map((c) => c.name);
      fks.push({ name: fkName(jName, aCols), child: junction, parent: a, childCols: aCols, parentCols: aPk, onDelete: "cascade" });
      fks.push({ name: fkName(jName, bCols), child: junction, parent: b, childCols: bCols, parentCols: bPk, onDelete: "cascade" });
      continue;
    }
    // orientation
    const childIsFrom = r.type === "many-to-one";
    const childEp = childIsFrom ? r.from : r.to;
    const parentEp = childIsFrom ? r.to : r.from;
    const child = childIsFrom ? a : b;
    const parent = childIsFrom ? b : a;
    const parentCols = parentEp.columns.length ? parentEp.columns : pkColumns(parent);
    if (!childEp.columns.length || !parentCols.length) continue;
    fks.push({
      name: r.name || fkName(child.name, childEp.columns),
      child,
      parent,
      childCols: childEp.columns,
      parentCols,
      onDelete: r.onDelete,
      onUpdate: r.onUpdate,
    });
    if (r.type === "one-to-one" && childEp.columns.length === 1) {
      const col = child.columns.find((c) => c.name === childEp.columns[0]);
      if (col && !col.pk) col.unique = true;
    }
  }
  return { tables, fks, byKey };
}

/**
 * The tables and concrete child → parent foreign keys that `modelToSql` emits — including the junction tables it
 * synthesises for many-to-many relationships — parents first. The SQL playground builds its database (and its schema
 * tree / autocomplete) from this, so what you query is exactly what you would export.
 */
export function resolvedSchema(model: DiagramModel): { tables: TableModel[]; fks: ResolvedFk[]; cyclic: boolean } {
  const w = resolve(model);
  const { tables, cyclic } = order(w);
  return { tables, fks: w.fks, cyclic };
}

/** Parent-first ordering. Returns `cyclic: true` when a dependency cycle had to be broken. */
function order(w: Working): { tables: TableModel[]; cyclic: boolean } {
  const out: TableModel[] = [];
  const state = new Map<TableModel, 0 | 1 | 2>();
  let cyclic = false;
  const deps = new Map<TableModel, TableModel[]>();
  for (const t of w.tables) deps.set(t, []);
  for (const fk of w.fks) if (fk.child !== fk.parent) deps.get(fk.child)!.push(fk.parent);
  const visit = (t: TableModel) => {
    const s = state.get(t);
    if (s === 2) return;
    if (s === 1) {
      cyclic = true;
      return;
    }
    state.set(t, 1);
    for (const p of deps.get(t)!) visit(p);
    state.set(t, 2);
    out.push(t);
  };
  for (const t of w.tables) visit(t);
  return { tables: out, cyclic };
}

function boolLiteral(v: boolean, d: SqlDialect): string {
  return d === "mssql" || d === "oracle" || d === "sqlite" ? (v ? "1" : "0") : v ? "TRUE" : "FALSE";
}

const TS_NOW = /^(now\(\)|current_timestamp(\(\))?|getdate\(\)|sysdate|sysdatetime\(\)|statement_timestamp\(\)|localtimestamp)$/i;
const UUID_GEN = /^(gen_random_uuid\(\)|uuid_generate_v4\(\)|uuid\(\)|newid\(\)|sys_guid\(\)|generate_uuid\(\)|uuid_string\(\))$/i;

function defaultSql(def: DefaultValue, ct: CanonicalType, d: SqlDialect): string {
  switch (def.kind) {
    case "string":
      return sqlString(def.value);
    case "number":
      return def.value;
    case "boolean":
      return boolLiteral(def.value.toLowerCase() === "true", d);
    case "null":
      return "NULL";
    default: {
      const v = def.value.trim();
      if (TS_NOW.test(v)) {
        const s = { postgres: "CURRENT_TIMESTAMP", mysql: "CURRENT_TIMESTAMP", sqlite: "CURRENT_TIMESTAMP", mssql: "SYSDATETIME()", oracle: "SYSTIMESTAMP", snowflake: "CURRENT_TIMESTAMP()", bigquery: "CURRENT_TIMESTAMP()", redshift: "GETDATE()", databricks: "CURRENT_TIMESTAMP()" } as const;
        return ct.kind === "date" && d !== "oracle" ? "CURRENT_DATE" : s[d];
      }
      if (UUID_GEN.test(v)) {
        const s = { postgres: "gen_random_uuid()", mysql: "(UUID())", sqlite: "(lower(hex(randomblob(16))))", mssql: "NEWID()", oracle: "SYS_GUID()", snowflake: "UUID_STRING()", bigquery: "GENERATE_UUID()", redshift: "", databricks: "uuid()" } as const;
        return s[d] || v;
      }
      if ((d === "mysql" || d === "sqlite") && !/^\(.*\)$/.test(v) && /[()+\-*/|]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return `(${v})`;
      return v;
    }
  }
}

function recordSql(v: RecordValue, d: SqlDialect): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return boolLiteral(v, d);
  if (v.startsWith("`") && v.endsWith("`") && v.length > 1) return v.slice(1, -1);
  return sqlString(v);
}

const NO_INDEX = new Set<SqlDialect>(["snowflake", "bigquery", "redshift", "databricks"]);
const INLINE_PK = new Set<SqlDialect>(["postgres", "mysql", "sqlite", "mssql", "oracle", "snowflake", "redshift"]);

function identitySql(ct: CanonicalType, d: SqlDialect): string {
  switch (d) {
    case "postgres":
    case "oracle":
      return "GENERATED BY DEFAULT AS IDENTITY";
    case "databricks":
      return "GENERATED BY DEFAULT AS IDENTITY";
    case "mysql":
      return "AUTO_INCREMENT";
    case "sqlite":
      return "AUTOINCREMENT";
    case "mssql":
    case "redshift":
      return "IDENTITY(1,1)";
    case "snowflake":
      return "AUTOINCREMENT";
    default:
      return "";
  }
}

export function modelToSql(model: DiagramModel, options: SqlExportOptions): string {
  const d = options.dialect;
  const opts = {
    includeDrop: false,
    useAlterTable: false,
    includeIndexes: true,
    fkIndexes: false,
    includeComments: true,
    includeSeedData: true,
    ifNotExists: false,
    ...options,
  };
  const w = resolve(model);
  const { tables: ordered, cyclic } = order(w);
  const alter = opts.useAlterTable || cyclic;
  const q = (n: string) => quoteIdent(n, d);
  const out: string[] = [];
  const line = (s = "") => out.push(s);

  line(`-- DesignDB export — ${dialectLabel(d)}`);
  if (cyclic && !opts.useAlterTable) line("-- Circular foreign-key dependencies detected: constraints are added with ALTER TABLE.");
  line();

  // schemas
  const schemas = Array.from(new Set(w.tables.map((t) => (t.schema && t.schema !== "public" ? t.schema : "")).filter(Boolean)));
  if (schemas.length && d !== "sqlite" && d !== "oracle") {
    for (const s of schemas) {
      if (d === "mssql") line(`IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = ${sqlString(s)}) EXEC('CREATE SCHEMA ${q(s)}');`);
      else if (d === "mysql") line(`CREATE DATABASE IF NOT EXISTS ${q(s)};`);
      else line(`CREATE SCHEMA IF NOT EXISTS ${q(s)};`);
    }
    line();
  }

  // enums
  const enumHandled = new Set<string>();
  if (d === "postgres" && model.enums.length) {
    for (const e of model.enums) {
      const name = `${e.schema && e.schema !== "public" ? q(e.schema) + "." : ""}${q(e.name)}`;
      line(`CREATE TYPE ${name} AS ENUM (${e.values.map((v) => sqlString(v.name)).join(", ")});`);
      enumHandled.add(e.name);
    }
    line();
  }

  if (opts.includeDrop) {
    if (d === "mysql") line("SET FOREIGN_KEY_CHECKS = 0;");
    for (const t of [...ordered].reverse()) {
      if (d === "postgres") line(`DROP TABLE IF EXISTS ${qualifiedName(t, d)} CASCADE;`);
      else if (d === "oracle") line(`DROP TABLE ${qualifiedName(t, d)} CASCADE CONSTRAINTS;`);
      else line(`DROP TABLE IF EXISTS ${qualifiedName(t, d)};`);
    }
    if (d === "postgres") for (const e of [...model.enums].reverse()) line(`DROP TYPE IF EXISTS ${e.schema && e.schema !== "public" ? q(e.schema) + "." : ""}${q(e.name)} CASCADE;`);
    if (d === "mysql") line("SET FOREIGN_KEY_CHECKS = 1;");
    line();
  }

  const fkClause = (fk: ResolvedFk) => {
    const parts = [`FOREIGN KEY (${fk.childCols.map(q).join(", ")}) REFERENCES ${qualifiedName(fk.parent, d)} (${fk.parentCols.map(q).join(", ")})`];
    const act = (a?: ReferentialAction) => (a ? a.toUpperCase() : undefined);
    if (act(fk.onDelete) && !(d === "oracle" && fk.onDelete === "no action") && !(d === "bigquery" || d === "databricks")) parts.push(`ON DELETE ${act(fk.onDelete)}`);
    if (act(fk.onUpdate) && d !== "oracle" && d !== "bigquery" && d !== "databricks") parts.push(`ON UPDATE ${act(fk.onUpdate)}`);
    if (d === "bigquery") parts.push("NOT ENFORCED");
    return parts.join(" ");
  };

  const commentStatements: string[] = [];
  const indexStatements: string[] = [];
  const alterStatements: string[] = [];

  for (const t of ordered) {
    const tname = qualifiedName(t, d);
    const cols: string[] = [];
    const tableConstraints: string[] = [];
    const pk = pkColumns(t);
    const inlinePk = pk.length === 1 && INLINE_PK.has(d);
    const desc: string[] = [];

    for (const c of t.columns) {
      const en = findEnum(model, c.type);
      let ct = canonicalType(c.type);
      let typeSql: string;
      let enumCheck: string | undefined;
      if (en) {
        if (d === "postgres") typeSql = `${en.schema && en.schema !== "public" ? q(en.schema) + "." : ""}${q(en.name)}`;
        else if (d === "mysql") typeSql = `ENUM(${en.values.map((v) => sqlString(v.name)).join(", ")})`;
        else {
          ct = canonicalType("varchar(255)");
          typeSql = renderType(ct, d);
          enumCheck = `${q(c.name)} IN (${en.values.map((v) => sqlString(v.name)).join(", ")})`;
        }
      } else {
        typeSql = renderType(ct, d);
      }
      const isIncrement = !!c.increment || !!ct.autoIncrement;
      const parts: string[] = [q(c.name), typeSql];
      const isPkCol = pk.includes(c.name);
      if (isIncrement && ["integer", "bigint", "smallint"].includes(ct.kind)) {
        if (d === "sqlite") {
          // SQLite requires exactly `INTEGER PRIMARY KEY AUTOINCREMENT`
          parts[1] = "INTEGER";
        }
        if (d === "postgres" && !c.increment && ct.autoIncrement) {
          parts[1] = ct.kind === "bigint" ? "BIGSERIAL" : ct.kind === "smallint" ? "SMALLSERIAL" : "SERIAL";
        } else {
          const id = identitySql(ct, d);
          if (id && !(d === "sqlite" && !(inlinePk && isPkCol))) parts.push(id);
        }
      }
      const notNull = c.notNull || isPkCol;
      if (inlinePk && isPkCol) {
        if (d === "sqlite" && isIncrement) {
          // handled: PRIMARY KEY placed before AUTOINCREMENT
          const i = parts.indexOf("AUTOINCREMENT");
          if (i >= 0) parts.splice(i, 0, "PRIMARY KEY");
          else parts.push("PRIMARY KEY");
        } else parts.push("PRIMARY KEY");
      } else if (notNull) parts.push("NOT NULL");
      if (c.unique && !isPkCol) parts.push("UNIQUE");
      if (c.default && !(isIncrement && c.default.kind === "expression" && /nextval/i.test(c.default.value))) parts.push(`DEFAULT ${defaultSql(c.default, ct, d)}`);
      for (const ck of c.checks || []) parts.push(`CHECK (${ck})`);
      if (opts.includeComments && c.note) {
        if (d === "mysql" || d === "databricks") parts.push(`COMMENT ${sqlString(c.note)}`);
        else if (d === "bigquery") parts.push(`OPTIONS(description=${sqlString(c.note)})`);
      }
      cols.push("  " + parts.join(" "));
      if (enumCheck) tableConstraints.push(`  CONSTRAINT ${q(`chk_${t.name}_${c.name}`)} CHECK (${enumCheck})`);
      if (opts.includeComments && c.note) {
        if (d === "postgres" || d === "oracle" || d === "snowflake" || d === "redshift") commentStatements.push(`COMMENT ON COLUMN ${tname}.${q(c.name)} IS ${sqlString(c.note)};`);
        else if (d === "mssql") commentStatements.push(`EXEC sp_addextendedproperty 'MS_Description', ${sqlString(c.note)}, 'SCHEMA', ${sqlString(t.schema && t.schema !== "public" ? t.schema : "dbo")}, 'TABLE', ${sqlString(t.name)}, 'COLUMN', ${sqlString(c.name)};`);
        else if (d === "sqlite") desc.push(`-- ${t.name}.${c.name}: ${c.note.replace(/\n/g, " ")}`);
      }
    }

    if (pk.length && (!inlinePk || pk.length > 1)) {
      if (d === "bigquery") tableConstraints.unshift(`  PRIMARY KEY (${pk.map(q).join(", ")}) NOT ENFORCED`);
      else tableConstraints.unshift(`  CONSTRAINT ${q(`pk_${t.name}`)} PRIMARY KEY (${pk.map(q).join(", ")})`);
    }

    // unique / check constraints
    for (const ix of t.indexes) {
      if (ix.pk) continue;
      if (ix.unique && (NO_INDEX.has(d) || !opts.includeIndexes)) {
        if (d === "snowflake" || d === "redshift") tableConstraints.push(`  CONSTRAINT ${q(ix.name || `uq_${t.name}_${ix.columns.join("_")}`)} UNIQUE (${ix.columns.map(q).join(", ")})`);
      }
    }
    for (const ck of t.checks) {
      tableConstraints.push(`  ${ck.name ? `CONSTRAINT ${q(ck.name)} ` : ""}CHECK (${ck.expression})`);
    }
    if (!alter) {
      for (const fk of w.fks.filter((f) => f.child === t)) tableConstraints.push(`  CONSTRAINT ${q(fk.name)} ${fkClause(fk)}`);
    }

    const head = `CREATE TABLE ${opts.ifNotExists && d !== "mssql" && d !== "oracle" ? "IF NOT EXISTS " : ""}${tname} (`;
    const body = [...cols, ...tableConstraints].join(",\n");
    let tail = ")";
    if (opts.includeComments && t.note) {
      if (d === "mysql") tail += ` COMMENT=${sqlString(t.note)}`;
      else if (d === "databricks") tail += ` COMMENT ${sqlString(t.note)}`;
      else if (d === "bigquery") tail += ` OPTIONS(description=${sqlString(t.note)})`;
    }
    if (d === "mysql") tail += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    if (opts.includeComments && desc.length) for (const x of desc) line(x);
    if (opts.includeComments && t.note && d === "sqlite") line(`-- ${t.name}: ${t.note.replace(/\n/g, " ")}`);
    line(`${head}\n${body}\n${tail};`);
    line();

    if (opts.includeComments && t.note) {
      if (d === "postgres" || d === "oracle" || d === "snowflake" || d === "redshift") commentStatements.push(`COMMENT ON TABLE ${tname} IS ${sqlString(t.note)};`);
      else if (d === "mssql") commentStatements.push(`EXEC sp_addextendedproperty 'MS_Description', ${sqlString(t.note)}, 'SCHEMA', ${sqlString(t.schema && t.schema !== "public" ? t.schema : "dbo")}, 'TABLE', ${sqlString(t.name)};`);
    }

    // indexes
    if (opts.includeIndexes && !NO_INDEX.has(d)) {
      for (const ix of t.indexes) {
        if (ix.pk) continue;
        indexStatements.push(indexSql(ix, t, d));
      }
    }
  }

  if (alter) {
    for (const fk of w.fks) {
      alterStatements.push(`ALTER TABLE ${qualifiedName(fk.child, d)} ADD CONSTRAINT ${q(fk.name)} ${fkClause(fk)};`);
    }
  }
  if (alterStatements.length) {
    line("-- Foreign keys");
    for (const s of alterStatements) line(s);
    line();
  }

  if (opts.fkIndexes && !NO_INDEX.has(d)) {
    for (const fk of w.fks) {
      const has = w.byKey && fk.child.indexes.some((ix) => ix.columns.join(",") === fk.childCols.join(","));
      if (!has) indexStatements.push(`CREATE INDEX ${q(`idx_${fk.child.name}_${fk.childCols.join("_")}`)} ON ${qualifiedName(fk.child, d)} (${fk.childCols.map(q).join(", ")});`);
    }
  }
  if (indexStatements.length) {
    line("-- Indexes");
    for (const s of indexStatements) line(s);
    line();
  } else if (opts.includeIndexes && NO_INDEX.has(d) && w.tables.some((t) => t.indexes.some((i) => !i.pk))) {
    line(`-- ${dialectLabel(d)} does not support secondary indexes; index definitions were skipped.`);
    line();
  }
  if (commentStatements.length) {
    line("-- Comments");
    for (const s of commentStatements) line(s);
    line();
  }

  if (opts.includeSeedData) {
    const seeded = ordered.filter((t) => t.records && t.records.rows.length);
    if (seeded.length) {
      line("-- Sample data");
      for (const t of seeded) {
        const rec = t.records!;
        const cols = rec.columns.map(q).join(", ");
        const target = qualifiedName(t, d);
        const rows = rec.rows.map((r) => `(${r.map((v) => recordSql(v, d)).join(", ")})`);
        if (d === "oracle" || d === "mssql" || d === "sqlite") for (const r of rows) line(`INSERT INTO ${target} (${cols}) VALUES ${r};`);
        else line(`INSERT INTO ${target} (${cols}) VALUES\n  ${rows.join(",\n  ")};`);
      }
      line();
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function indexSql(ix: IndexModel, t: TableModel, d: SqlDialect): string {
  const q = (n: string) => quoteIdent(n, d);
  const cols = ix.columns.map((c) => (c.startsWith("`") ? c.slice(1, -1) : q(c)));
  const name = ix.name || `${ix.unique ? "uq" : "idx"}_${t.name}_${ix.columns.map((c) => c.replace(/[^A-Za-z0-9_]/g, "")).join("_")}`;
  const type = (ix.type || "").toLowerCase();
  let using = "";
  if (d === "postgres" && type && type !== "btree") using = ` USING ${type.toUpperCase()}`;
  let tail = "";
  if (d === "mysql" && type && (type === "hash" || type === "btree")) tail = ` USING ${type.toUpperCase()}`;
  const target = qualifiedName(t, d);
  const indexName = d === "postgres" && t.schema && t.schema !== "public" ? q(name) : q(name);
  return `CREATE ${ix.unique || type === "unique" ? "UNIQUE " : ""}INDEX ${indexName} ON ${target}${using} (${cols.join(", ")})${tail};`;
}

// ───────────────────────────── MongoDB ─────────────────────────────

const BSON: Record<string, string> = {
  smallint: "int",
  integer: "int",
  bigint: "long",
  decimal: "decimal",
  float: "double",
  double: "double",
  boolean: "bool",
  char: "string",
  varchar: "string",
  text: "string",
  date: "date",
  time: "string",
  timestamp: "date",
  timestamptz: "date",
  uuid: "string",
  json: "object",
  jsonb: "object",
  binary: "binData",
  interval: "string",
  xml: "string",
  other: "string",
};

export function modelToMongo(model: DiagramModel): string {
  const w = resolve(model);
  const { tables } = order(w);
  const out: string[] = ["// DesignDB export — MongoDB (mongosh)", ""];
  for (const t of tables) {
    const required: string[] = [];
    const props: Record<string, any> = {};
    for (const c of t.columns) {
      const ct = canonicalType(c.type);
      const en = findEnum(model, c.type);
      const prop: Record<string, any> = { bsonType: BSON[ct.kind] || "string" };
      if (en) prop.enum = en.values.map((v) => v.name);
      if (ct.kind === "varchar" && ct.args && /^\d+$/.test(ct.args)) prop.maxLength = parseInt(ct.args, 10);
      if (c.note) prop.description = c.note;
      if (c.notNull || c.pk) required.push(c.name);
      props[c.pk && c.name === "id" ? "_id" : c.name] = prop;
    }
    const schema: Record<string, any> = { bsonType: "object", required: required.map((n) => (n === "id" ? "_id" : n)), properties: props };
    out.push(`db.createCollection(${JSON.stringify(t.name)}, {`);
    out.push(`  validator: { $jsonSchema: ${JSON.stringify(schema, null, 2).replace(/\n/g, "\n  ")} }`);
    out.push("});");
    for (const c of t.columns.filter((x) => x.unique && !x.pk)) out.push(`db.${safeProp(t.name)}.createIndex({ ${JSON.stringify(c.name)}: 1 }, { unique: true });`);
    for (const ix of t.indexes) {
      if (ix.pk) continue;
      const keys = ix.columns.filter((c) => !c.startsWith("`")).map((c) => `${JSON.stringify(c)}: 1`).join(", ");
      if (keys) {
        const optParts: string[] = [];
        if (ix.unique) optParts.push("unique: true");
        if (ix.name) optParts.push(`name: ${JSON.stringify(ix.name)}`);
        out.push(`db.${safeProp(t.name)}.createIndex({ ${keys} }${optParts.length ? `, { ${optParts.join(", ")} }` : ""});`);
      }
    }
    for (const fk of w.fks.filter((f) => f.child === t)) out.push(`// ref: ${t.name}.${fk.childCols.join(",")} -> ${fk.parent.name}.${fk.parentCols.join(",")}`);
    if (t.records && t.records.rows.length) {
      const docs = t.records.rows.map((row) => {
        const doc: Record<string, unknown> = {};
        t.records!.columns.forEach((c, i) => {
          const v = row[i];
          doc[c === "id" ? "_id" : c] = typeof v === "string" && v.startsWith("`") ? v.slice(1, -1) : v;
        });
        return doc;
      });
      out.push(`db.${safeProp(t.name)}.insertMany(${JSON.stringify(docs, null, 2)});`);
    }
    out.push("");
  }
  return out.join("\n");
}

function safeProp(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `getCollection(${JSON.stringify(name)})`;
}

export function exportTargets(): { id: string; label: string; ext: string; mime: string }[] {
  return [
    { id: "postgres", label: "PostgreSQL", ext: "sql", mime: "application/sql" },
    { id: "mysql", label: "MySQL / MariaDB", ext: "sql", mime: "application/sql" },
    { id: "sqlite", label: "SQLite", ext: "sql", mime: "application/sql" },
    { id: "mssql", label: "SQL Server", ext: "sql", mime: "application/sql" },
    { id: "oracle", label: "Oracle", ext: "sql", mime: "application/sql" },
    { id: "snowflake", label: "Snowflake", ext: "sql", mime: "application/sql" },
    { id: "bigquery", label: "Google BigQuery", ext: "sql", mime: "application/sql" },
    { id: "redshift", label: "Amazon Redshift", ext: "sql", mime: "application/sql" },
    { id: "databricks", label: "Databricks", ext: "sql", mime: "application/sql" },
    { id: "mongodb", label: "MongoDB (mongosh)", ext: "js", mime: "text/javascript" },
  ];
}
