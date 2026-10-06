/**
 * Dialect metadata + cross-dialect data-type mapping.
 *
 * Every column type is normalised into a small canonical vocabulary ("canonical type") and then
 * rendered for the target dialect. That is what makes DB conversion (MySQL → PostgreSQL, Oracle →
 * BigQuery, …) and multi-dialect export possible from one model.
 */
import { splitType } from "../model/types";

export type SqlDialect = "postgres" | "mysql" | "sqlite" | "mssql" | "oracle" | "snowflake" | "bigquery" | "redshift" | "databricks";

export const SQL_DIALECTS: { id: SqlDialect; label: string; ext: string; dbmlName: string }[] = [
  { id: "postgres", label: "PostgreSQL", ext: "sql", dbmlName: "PostgreSQL" },
  { id: "mysql", label: "MySQL / MariaDB", ext: "sql", dbmlName: "MySQL" },
  { id: "sqlite", label: "SQLite", ext: "sql", dbmlName: "SQLite" },
  { id: "mssql", label: "SQL Server", ext: "sql", dbmlName: "SQL Server" },
  { id: "oracle", label: "Oracle", ext: "sql", dbmlName: "Oracle" },
  { id: "snowflake", label: "Snowflake", ext: "sql", dbmlName: "Snowflake" },
  { id: "bigquery", label: "Google BigQuery", ext: "sql", dbmlName: "BigQuery" },
  { id: "redshift", label: "Amazon Redshift", ext: "sql", dbmlName: "Redshift" },
  { id: "databricks", label: "Databricks", ext: "sql", dbmlName: "Databricks" },
];

export function isSqlDialect(v: string): v is SqlDialect {
  return SQL_DIALECTS.some((d) => d.id === v);
}

export function dialectFromDbmlName(name: string | undefined): SqlDialect | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.startsWith("postgres") || n === "pg") return "postgres";
  if (n.startsWith("mysql") || n.startsWith("mariadb")) return "mysql";
  if (n.startsWith("sqlite")) return "sqlite";
  if (n.startsWith("sqlserver") || n === "mssql" || n === "tsql") return "mssql";
  if (n.startsWith("oracle")) return "oracle";
  if (n.startsWith("snowflake")) return "snowflake";
  if (n.startsWith("bigquery")) return "bigquery";
  if (n.startsWith("redshift")) return "redshift";
  if (n.startsWith("databricks")) return "databricks";
  return undefined;
}

export function dialectLabel(d: SqlDialect): string {
  return SQL_DIALECTS.find((x) => x.id === d)?.label || d;
}

// ───────────────────────────── canonical types ─────────────────────────────

export type CanonicalKind =
  | "smallint"
  | "integer"
  | "bigint"
  | "decimal"
  | "float"
  | "double"
  | "boolean"
  | "char"
  | "varchar"
  | "text"
  | "date"
  | "time"
  | "timestamp"
  | "timestamptz"
  | "uuid"
  | "json"
  | "jsonb"
  | "binary"
  | "interval"
  | "xml"
  | "other";

export interface CanonicalType {
  kind: CanonicalKind;
  /** raw parameters: "255", "10,2" */
  args: string;
  /** auto-increment implied by the source type (serial / identity). */
  autoIncrement?: boolean;
  array?: boolean;
  /** original text for `other` types */
  raw: string;
  unsigned?: boolean;
}

const INT_RANGE = (p: number) => (p <= 5 ? "smallint" : p <= 10 ? "integer" : "bigint");

export function canonicalType(input: string): CanonicalType {
  const raw = (input || "").trim();
  const { base, args, array } = splitType(raw);
  let b = base.toLowerCase().replace(/\s+/g, " ").trim();
  const unsigned = /\bunsigned\b/.test(b);
  b = b.replace(/\b(unsigned|signed|zerofill)\b/g, "").replace(/\s+/g, " ").trim();
  const mk = (kind: CanonicalKind, a = args, extra: Partial<CanonicalType> = {}): CanonicalType => ({ kind, args: a, raw, array, unsigned, ...extra });

  switch (b) {
    case "smallint":
    case "int2":
    case "smallserial":
    case "serial2":
      return mk("smallint", "", { autoIncrement: b.includes("serial") });
    case "int":
    case "integer":
    case "int4":
    case "mediumint":
    case "int32":
      return mk("integer", "");
    case "serial":
    case "serial4":
      return mk("integer", "", { autoIncrement: true });
    case "bigint":
    case "int8":
    case "int64":
    case "long":
      return mk("bigint", "");
    case "bigserial":
    case "serial8":
      return mk("bigint", "", { autoIncrement: true });
    case "tinyint":
      return args === "1" ? mk("boolean", "") : mk("smallint", "");
    case "byteint":
      return mk("smallint", "");
    case "decimal":
    case "numeric":
    case "dec":
    case "fixed":
    case "bignumeric":
    case "bigdecimal":
      return mk("decimal");
    case "money":
    case "smallmoney":
      return mk("decimal", "19,4");
    case "number": {
      if (!args) return mk("decimal", "");
      const [p, s] = args.split(",").map((x) => parseInt(x.trim(), 10));
      if ((s === 0 || s === undefined) && !Number.isNaN(p)) return mk(INT_RANGE(p) as CanonicalKind, "");
      return mk("decimal");
    }
    case "real":
    case "float4":
    case "float32":
    case "binary_float":
      return mk("float", "");
    case "float":
      return args && parseInt(args, 10) <= 24 ? mk("float", "") : mk("double", "");
    case "double":
    case "double precision":
    case "float8":
    case "float64":
    case "binary_double":
      return mk("double", "");
    case "boolean":
    case "bool":
    case "bit":
      return b === "bit" && args && args !== "1" ? mk("binary") : mk("boolean", "");
    case "char":
    case "character":
    case "nchar":
    case "bpchar":
    case "national char":
      return mk("char");
    case "varchar":
    case "character varying":
    case "nvarchar":
    case "varchar2":
    case "nvarchar2":
    case "national varchar":
    case "string":
    case "varchar_ignorecase":
    case "citext":
    case "name":
      return mk(args.toLowerCase() === "max" ? "text" : "varchar", args.toLowerCase() === "max" ? "" : args);
    case "text":
    case "tinytext":
    case "mediumtext":
    case "longtext":
    case "clob":
    case "nclob":
    case "ntext":
    case "long varchar":
      return mk("text", "");
    case "date":
      return mk("date", "");
    case "time":
    case "timetz":
    case "time without time zone":
    case "time with time zone":
      return mk("time", "");
    case "datetime":
    case "datetime2":
    case "smalldatetime":
    case "timestamp":
    case "timestamp without time zone":
    case "timestamp_ntz":
    case "timestamp_ltz":
      return mk("timestamp", "");
    case "timestamptz":
    case "timestamp with time zone":
    case "timestamp_tz":
    case "datetimeoffset":
    case "timestamp with local time zone":
      return mk("timestamptz", "");
    case "interval":
      return mk("interval", "");
    case "uuid":
    case "uniqueidentifier":
      return mk("uuid", "");
    case "json":
      return mk("json", "");
    case "jsonb":
    case "variant":
    case "super":
    case "object":
      return mk("jsonb", "");
    case "bytea":
    case "blob":
    case "tinyblob":
    case "mediumblob":
    case "longblob":
    case "binary":
    case "varbinary":
    case "image":
    case "raw":
    case "bytes":
    case "varbyte":
    case "long raw":
      return mk("binary");
    case "xml":
    case "xmltype":
      return mk("xml", "");
    default:
      return { kind: "other", args, raw, array, unsigned };
  }
}

// ───────────────────────────── rendering ─────────────────────────────

function withArgs(name: string, args: string): string {
  return args ? `${name}(${args})` : name;
}

/** Renders a canonical type for a dialect (upper-case, dialect-specific spelling). */
export function renderType(ct: CanonicalType, d: SqlDialect): string {
  const a = ct.args;
  const arr = ct.array && d === "postgres" ? "[]" : "";
  const out = (s: string) => s + arr;
  switch (ct.kind) {
    case "smallint":
      return out(({ postgres: "SMALLINT", mysql: "SMALLINT", sqlite: "INTEGER", mssql: "SMALLINT", oracle: "NUMBER(5)", snowflake: "SMALLINT", bigquery: "INT64", redshift: "SMALLINT", databricks: "SMALLINT" } as const)[d]);
    case "integer":
      return out(({ postgres: "INTEGER", mysql: "INT", sqlite: "INTEGER", mssql: "INT", oracle: "NUMBER(10)", snowflake: "INTEGER", bigquery: "INT64", redshift: "INTEGER", databricks: "INT" } as const)[d]);
    case "bigint":
      return out(({ postgres: "BIGINT", mysql: "BIGINT", sqlite: "INTEGER", mssql: "BIGINT", oracle: "NUMBER(19)", snowflake: "BIGINT", bigquery: "INT64", redshift: "BIGINT", databricks: "BIGINT" } as const)[d]);
    case "decimal":
      switch (d) {
        case "postgres":
          return out(withArgs("NUMERIC", a));
        case "sqlite":
          return "NUMERIC";
        case "oracle":
        case "snowflake":
          return withArgs("NUMBER", a);
        case "bigquery":
          return a ? withArgs("NUMERIC", a) : "NUMERIC";
        default:
          return out(withArgs("DECIMAL", a));
      }
    case "float":
      return out(({ postgres: "REAL", mysql: "FLOAT", sqlite: "REAL", mssql: "REAL", oracle: "BINARY_FLOAT", snowflake: "FLOAT", bigquery: "FLOAT64", redshift: "REAL", databricks: "FLOAT" } as const)[d]);
    case "double":
      return out(({ postgres: "DOUBLE PRECISION", mysql: "DOUBLE", sqlite: "REAL", mssql: "FLOAT", oracle: "BINARY_DOUBLE", snowflake: "DOUBLE", bigquery: "FLOAT64", redshift: "DOUBLE PRECISION", databricks: "DOUBLE" } as const)[d]);
    case "boolean":
      return out(({ postgres: "BOOLEAN", mysql: "BOOLEAN", sqlite: "INTEGER", mssql: "BIT", oracle: "NUMBER(1)", snowflake: "BOOLEAN", bigquery: "BOOL", redshift: "BOOLEAN", databricks: "BOOLEAN" } as const)[d]);
    case "char":
      switch (d) {
        case "sqlite":
          return "TEXT";
        case "bigquery":
        case "databricks":
          return "STRING";
        default:
          return out(withArgs("CHAR", a || "1"));
      }
    case "varchar":
      switch (d) {
        case "sqlite":
          return "TEXT";
        case "bigquery":
        case "databricks":
          return "STRING";
        case "oracle":
          return withArgs("VARCHAR2", a || "255");
        case "mssql":
          return withArgs("NVARCHAR", a || "255");
        case "mysql":
        case "redshift":
        case "postgres":
        case "snowflake":
          return out(withArgs("VARCHAR", a || "255"));
      }
      return "VARCHAR(255)";
    case "text":
      return out(({ postgres: "TEXT", mysql: "TEXT", sqlite: "TEXT", mssql: "NVARCHAR(MAX)", oracle: "CLOB", snowflake: "TEXT", bigquery: "STRING", redshift: "VARCHAR(65535)", databricks: "STRING" } as const)[d]);
    case "date":
      return ({ postgres: "DATE", mysql: "DATE", sqlite: "TEXT", mssql: "DATE", oracle: "DATE", snowflake: "DATE", bigquery: "DATE", redshift: "DATE", databricks: "DATE" } as const)[d];
    case "time":
      return ({ postgres: "TIME", mysql: "TIME", sqlite: "TEXT", mssql: "TIME", oracle: "VARCHAR2(15)", snowflake: "TIME", bigquery: "TIME", redshift: "TIME", databricks: "STRING" } as const)[d];
    case "timestamp":
      return ({ postgres: "TIMESTAMP", mysql: "DATETIME", sqlite: "TEXT", mssql: "DATETIME2", oracle: "TIMESTAMP", snowflake: "TIMESTAMP_NTZ", bigquery: "DATETIME", redshift: "TIMESTAMP", databricks: "TIMESTAMP_NTZ" } as const)[d];
    case "timestamptz":
      return ({ postgres: "TIMESTAMPTZ", mysql: "TIMESTAMP", sqlite: "TEXT", mssql: "DATETIMEOFFSET", oracle: "TIMESTAMP WITH TIME ZONE", snowflake: "TIMESTAMP_TZ", bigquery: "TIMESTAMP", redshift: "TIMESTAMPTZ", databricks: "TIMESTAMP" } as const)[d];
    case "interval":
      return ({ postgres: "INTERVAL", mysql: "VARCHAR(64)", sqlite: "TEXT", mssql: "VARCHAR(64)", oracle: "INTERVAL DAY TO SECOND", snowflake: "VARCHAR(64)", bigquery: "INTERVAL", redshift: "INTERVAL", databricks: "INTERVAL" } as const)[d];
    case "uuid":
      return ({ postgres: "UUID", mysql: "CHAR(36)", sqlite: "TEXT", mssql: "UNIQUEIDENTIFIER", oracle: "RAW(16)", snowflake: "VARCHAR(36)", bigquery: "STRING", redshift: "VARCHAR(36)", databricks: "STRING" } as const)[d];
    case "json":
      return ({ postgres: "JSON", mysql: "JSON", sqlite: "TEXT", mssql: "NVARCHAR(MAX)", oracle: "CLOB", snowflake: "VARIANT", bigquery: "JSON", redshift: "SUPER", databricks: "STRING" } as const)[d];
    case "jsonb":
      return ({ postgres: "JSONB", mysql: "JSON", sqlite: "TEXT", mssql: "NVARCHAR(MAX)", oracle: "CLOB", snowflake: "VARIANT", bigquery: "JSON", redshift: "SUPER", databricks: "STRING" } as const)[d];
    case "binary":
      return ({ postgres: "BYTEA", mysql: "BLOB", sqlite: "BLOB", mssql: "VARBINARY(MAX)", oracle: "BLOB", snowflake: "BINARY", bigquery: "BYTES", redshift: "VARBYTE", databricks: "BINARY" } as const)[d];
    case "xml":
      return ({ postgres: "XML", mysql: "TEXT", sqlite: "TEXT", mssql: "XML", oracle: "XMLTYPE", snowflake: "VARIANT", bigquery: "STRING", redshift: "VARCHAR(65535)", databricks: "STRING" } as const)[d];
    default:
      return ct.raw ? ct.raw.toUpperCase().replace(/\[\]$/, d === "postgres" ? "[]" : "") : "VARCHAR(255)";
  }
}

/** Convenience: convert a raw source type string straight to a target dialect spelling. */
export function convertType(type: string, target: SqlDialect): string {
  return renderType(canonicalType(type), target);
}

/** All type names offered in the type pickers (dialect-neutral but familiar). */
export const COMMON_TYPES = [
  "integer",
  "bigint",
  "smallint",
  "serial",
  "bigserial",
  "varchar(255)",
  "varchar(100)",
  "char(1)",
  "text",
  "boolean",
  "decimal(10,2)",
  "numeric",
  "float",
  "double precision",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "datetime",
  "uuid",
  "json",
  "jsonb",
  "bytea",
  "blob",
];

/** Recommended target-specific type suggestions for the DBML editor autocomplete. */
export function typesForDialect(d: SqlDialect | undefined): string[] {
  switch (d) {
    case "mysql":
      return ["int", "bigint", "smallint", "tinyint", "varchar(255)", "char(36)", "text", "longtext", "boolean", "decimal(10,2)", "float", "double", "date", "time", "datetime", "timestamp", "json", "blob", "enum"];
    case "mssql":
      return ["int", "bigint", "smallint", "bit", "nvarchar(255)", "nvarchar(max)", "varchar(255)", "decimal(10,2)", "float", "date", "datetime2", "datetimeoffset", "uniqueidentifier", "varbinary(max)"];
    case "oracle":
      return ["NUMBER(10)", "NUMBER(19)", "NUMBER(10,2)", "VARCHAR2(255)", "CLOB", "DATE", "TIMESTAMP", "BLOB", "RAW(16)"];
    case "snowflake":
      return ["INTEGER", "NUMBER(38,0)", "VARCHAR", "BOOLEAN", "DATE", "TIMESTAMP_NTZ", "TIMESTAMP_TZ", "VARIANT", "ARRAY", "OBJECT"];
    case "bigquery":
      return ["INT64", "FLOAT64", "NUMERIC", "BOOL", "STRING", "BYTES", "DATE", "DATETIME", "TIMESTAMP", "JSON", "ARRAY"];
    case "sqlite":
      return ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"];
    default:
      return COMMON_TYPES;
  }
}
