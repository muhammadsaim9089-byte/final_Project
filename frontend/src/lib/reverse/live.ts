/**
 * SERVER-ONLY live database introspection (PostgreSQL, MySQL/MariaDB).
 * Read-only: only information_schema / catalog SELECTs are issued.
 */
import type { Catalog, CatalogForeignKey, CatalogIndex, CatalogTable } from "./catalog";

export interface ConnectionInput {
  type: "postgres" | "mysql";
  /** postgres://user:pass@host:5432/db or mysql://… — or fill the discrete fields below */
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
  /** PostgreSQL: limit to these schemas (default: all user schemas) */
  schemas?: string[];
}

const TIMEOUT_MS = 12_000;

export function parseConnectionUrl(url: string): Partial<ConnectionInput> & { type?: "postgres" | "mysql" } {
  const u = new URL(url);
  const proto = u.protocol.replace(":", "");
  const type = proto.startsWith("postgres") ? "postgres" : proto.startsWith("mysql") || proto.startsWith("mariadb") ? "mysql" : undefined;
  return {
    type,
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : undefined,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    ssl: /sslmode=(require|verify)/i.test(u.search) || u.searchParams.get("ssl") === "true",
  };
}

export async function introspect(input: ConnectionInput): Promise<Catalog> {
  const merged: ConnectionInput = { ...input };
  if (input.url) Object.assign(merged, parseConnectionUrl(input.url), { type: input.type });
  if (!merged.host || !merged.database) throw new Error("Host and database name are required");
  return merged.type === "mysql" ? introspectMysql(merged) : introspectPostgres(merged);
}

const withTimeout = <T,>(p: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  });
  // the timer must not outlive the work: a settled connection would otherwise keep it pending for 12 s
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

// ───────────────────────────── PostgreSQL ─────────────────────────────

async function introspectPostgres(c: ConnectionInput): Promise<Catalog> {
  const { Client } = await import("pg");
  const client = new Client({
    host: c.host,
    port: c.port || 5432,
    user: c.user,
    password: c.password,
    database: c.database,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: TIMEOUT_MS,
    statement_timeout: TIMEOUT_MS,
  });
  await withTimeout(client.connect(), "Connection");
  try {
    await client.query("SET default_transaction_read_only = on");
    const schemaFilter = c.schemas && c.schemas.length ? c.schemas : null;
    const notSystem = `n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'`;
    const schemaClause = schemaFilter ? ` AND n.nspname = ANY($1::text[])` : "";
    const args = schemaFilter ? [schemaFilter] : [];

    const cols = await client.query(
      `SELECT n.nspname AS schema, cl.relname AS table, a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS "default",
              (a.attidentity <> '') AS identity,
              col_description(cl.oid, a.attnum) AS comment,
              obj_description(cl.oid, 'pg_class') AS table_comment
         FROM pg_attribute a
         JOIN pg_class cl ON cl.oid = a.attrelid AND cl.relkind IN ('r','p')
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attnum > 0 AND NOT a.attisdropped AND ${notSystem}${schemaClause}
        ORDER BY n.nspname, cl.relname, a.attnum`,
      args
    );
    const tables = new Map<string, CatalogTable>();
    for (const r of cols.rows) {
      const k = `${r.schema}.${r.table}`;
      if (!tables.has(k)) tables.set(k, { schema: r.schema, name: r.table, comment: r.table_comment, columns: [] });
      const auto = !!r.identity || (typeof r.default === "string" && /^nextval\(/i.test(r.default));
      tables.get(k)!.columns.push({ name: r.name, type: r.type, nullable: r.nullable, default: r.default, autoIncrement: auto, comment: r.comment });
    }

    const cons = await client.query(
      `SELECT con.conname AS name, con.contype AS kind, n.nspname AS schema, cl.relname AS table,
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
              fn.nspname AS ref_schema, fcl.relname AS ref_table,
              (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_columns,
              con.confdeltype AS del, con.confupdtype AS upd, pg_get_constraintdef(con.oid) AS def
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
         LEFT JOIN pg_class fcl ON fcl.oid = con.confrelid
         LEFT JOIN pg_namespace fn ON fn.oid = fcl.relnamespace
        WHERE con.contype IN ('p','u','f','c') AND ${notSystem}${schemaClause}`,
      args
    );
    const actionMap: Record<string, string> = { a: "no action", r: "restrict", c: "cascade", n: "set null", d: "set default" };
    const foreignKeys: CatalogForeignKey[] = [];
    for (const r of cons.rows) {
      const t = tables.get(`${r.schema}.${r.table}`);
      if (!t) continue;
      if (r.kind === "p") t.primaryKey = r.columns || [];
      else if (r.kind === "u") (t.uniques ||= []).push({ name: r.name, columns: r.columns || [] });
      else if (r.kind === "c") (t.checks ||= []).push({ name: r.name, expression: String(r.def).replace(/^CHECK\s*\(/i, "").replace(/\)\s*(NOT VALID)?$/i, "") });
      else if (r.kind === "f")
        foreignKeys.push({ name: r.name, schema: r.schema, table: r.table, columns: r.columns || [], refSchema: r.ref_schema, refTable: r.ref_table, refColumns: r.ref_columns || [], onDelete: actionMap[r.del], onUpdate: actionMap[r.upd] });
    }

    const idx = await client.query(
      `SELECT schemaname AS schema, tablename AS table, indexname AS name, indexdef AS def
         FROM pg_indexes n2 JOIN pg_namespace n ON n.nspname = n2.schemaname
        WHERE ${notSystem}${schemaClause}`,
      args
    );
    const indexes: CatalogIndex[] = [];
    for (const r of idx.rows) {
      const m = /CREATE (UNIQUE )?INDEX .+? ON .+? (?:USING (\w+) )?\((.*)\)(?:\s+(?:WHERE|INCLUDE).*)?$/i.exec(r.def);
      if (!m) continue;
      const columns = splitTop(m[3]).map((s) => {
        const t = s.trim().replace(/\s+(ASC|DESC|NULLS (FIRST|LAST))$/gi, "");
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : /^"[^"]+"$/.test(t) ? t.slice(1, -1) : "`" + t + "`";
      });
      // primary-key / unique-constraint backing indexes are already modelled as constraints
      const t = tables.get(`${r.schema}.${r.table}`);
      if (t && (t.primaryKey?.join(",") === columns.join(",") || t.uniques?.some((u) => u.columns.join(",") === columns.join(",")))) continue;
      indexes.push({ schema: r.schema, table: r.table, name: r.name, columns, unique: !!m[1], type: m[2] });
    }

    const en = await client.query(
      `SELECT n.nspname AS schema, t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE ${notSystem}${schemaClause} GROUP BY 1, 2`,
      args
    );
    return { tables: [...tables.values()], foreignKeys, indexes, enums: en.rows.map((r: any) => ({ schema: r.schema, name: r.name, values: r.labels })) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ───────────────────────────── MySQL / MariaDB ─────────────────────────────

const lc = (row: Record<string, any>) => {
  const o: Record<string, any> = {};
  for (const k of Object.keys(row)) o[k.toLowerCase()] = row[k];
  return o;
};

async function introspectMysql(c: ConnectionInput): Promise<Catalog> {
  const mysql = await import("mysql2/promise");
  const conn = await withTimeout(
    mysql.createConnection({ host: c.host, port: c.port || 3306, user: c.user, password: c.password, database: c.database, ssl: c.ssl ? { rejectUnauthorized: false } : undefined, connectTimeout: TIMEOUT_MS }),
    "Connection"
  );
  try {
    const db = c.database!;
    const [tRows] = await conn.query(`SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [db]);
    const tables = new Map<string, CatalogTable>();
    for (const r0 of tRows as any[]) {
      const r = lc(r0);
      tables.set(r.table_name, { name: r.table_name, comment: r.table_comment || null, columns: [] });
    }
    const [cRows] = await conn.query(
      `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA, COLUMN_COMMENT
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [db]
    );
    for (const r0 of cRows as any[]) {
      const r = lc(r0);
      const t = tables.get(r.table_name);
      if (!t) continue;
      let def: string | null = r.column_default === null || r.column_default === undefined ? null : String(r.column_default);
      const isExpr = /DEFAULT_GENERATED/i.test(r.extra || "");
      if (def !== null && !isExpr && !/^-?\d+(\.\d+)?$/.test(def) && !/^current_timestamp/i.test(def)) def = `'${def.replace(/'/g, "''")}'`;
      t.columns.push({ name: r.column_name, type: r.column_type, nullable: r.is_nullable === "YES", default: def, autoIncrement: /auto_increment/i.test(r.extra || ""), comment: r.column_comment || null });
    }
    const [sRows] = await conn.query(
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [db]
    );
    const indexes = new Map<string, CatalogIndex>();
    for (const r0 of sRows as any[]) {
      const r = lc(r0);
      const t = tables.get(r.table_name);
      if (!t || !r.column_name) continue;
      if (r.index_name === "PRIMARY") {
        (t.primaryKey ||= []).push(r.column_name);
        continue;
      }
      const k = `${r.table_name}.${r.index_name}`;
      if (!indexes.has(k)) indexes.set(k, { table: r.table_name, name: r.index_name, columns: [], unique: Number(r.non_unique) === 0, type: r.index_type });
      indexes.get(k)!.columns.push(r.column_name);
    }
    const [fRows] = await conn.query(
      `SELECT kcu.CONSTRAINT_NAME, kcu.TABLE_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, kcu.ORDINAL_POSITION, rc.DELETE_RULE, rc.UPDATE_RULE
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
        WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [db]
    );
    const fks = new Map<string, CatalogForeignKey>();
    for (const r0 of fRows as any[]) {
      const r = lc(r0);
      const k = `${r.table_name}.${r.constraint_name}`;
      if (!fks.has(k)) fks.set(k, { name: r.constraint_name, table: r.table_name, columns: [], refTable: r.referenced_table_name, refColumns: [], onDelete: r.delete_rule, onUpdate: r.update_rule });
      fks.get(k)!.columns.push(r.column_name);
      fks.get(k)!.refColumns.push(r.referenced_column_name);
    }
    // unique indexes become UNIQUE constraints when they are the only index over those columns
    for (const ix of indexes.values()) {
      if (ix.unique) (tables.get(ix.table)!.uniques ||= []).push({ name: ix.name, columns: ix.columns });
    }
    return { tables: [...tables.values()], foreignKeys: [...fks.values()], indexes: [...indexes.values()].filter((i) => !i.unique), enums: [] };
  } finally {
    await conn.end().catch(() => undefined);
  }
}
