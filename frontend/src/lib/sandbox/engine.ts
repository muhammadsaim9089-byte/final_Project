/**
 * SQL playground engine.
 *
 * Framework-free and synchronous. It runs inside the playground's Web Worker (components/Canvas/sandbox/
 * playground.worker.ts) so a query never blocks the canvas, on the main thread when workers are unavailable, and under
 * Node in the tests. sql.js is passed in rather than imported, so the same code works in all three.
 *
 * - buildDatabase(): the SQLite DDL that `modelToSql` would export (constraints, enum CHECKs, indexes, the junction
 *   tables of many-to-many relationships) plus sample rows — the diagram's own Records / sample data where a table has
 *   them, generated rows (foreign-key consistent, enum and unique aware) where it doesn't.
 * - runSql(): runs a script statement by statement (SQLite's prepare "tail", via sql.js' StatementIterator), so an error
 *   comes back with the exact source range of the statement that failed. Result sets are capped.
 */
import type { ColumnModel, DiagramModel, RecordValue, TableModel } from "../model/types";
import { tableKeyOf } from "../model/types";
import { canonicalType, type CanonicalType } from "../sql/dialects";
import { findEnum, modelToSql, pkColumns, qualifiedName, quoteIdent, resolvedSchema, type ResolvedFk } from "../sql/exporter";

// ───────────────────────────── the slice of sql.js we use ─────────────────────────────

export type SqlValue = string | number | null | Uint8Array;

export interface SqlJsStatement {
  step(): boolean;
  get(): SqlValue[];
  getColumnNames(): string[];
  getSQL(): string;
  free(): boolean;
}

export interface SqlJsStatementIterator {
  next(): IteratorResult<SqlJsStatement>;
  getRemainingSQL(): string;
  finalize?(): void;
}

export interface SqlJsDatabase {
  run(sql: string, params?: (string | number | null)[]): unknown;
  exec(sql: string): { columns: string[]; values: SqlValue[][] }[];
  iterateStatements(sql: string): SqlJsStatementIterator;
  close(): void;
}

export interface SqlJsStatic {
  Database: new () => SqlJsDatabase;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const round2 = (n: number) => Math.round(n * 100) / 100;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** An identifier as it has to be written in the playground's SQL (quoted only when needed). */
export function sqlIdent(name: string): string {
  return quoteIdent(name, "sqlite");
}

// ───────────────────────────── schema (tree + autocomplete) ─────────────────────────────

export interface PlaygroundColumn {
  name: string;
  /** Type as designed: "varchar(255)", "order_status". */
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
  /** The column this one references, from the diagram's relationships. */
  ref?: { table: string; column: string };
  enumValues?: string[];
}

export interface PlaygroundTable {
  /** Diagram key: "orders", "core.orders". */
  key: string;
  /** The diagram's name, schema-qualified when not public. */
  label: string;
  /** How to write it in SQL here — SQLite has no schemas, so `core.orders` is the table `core_orders`. Quoted only when needed. */
  sqlName: string;
  columns: PlaygroundColumn[];
  /** A junction table the export synthesises for a many-to-many relationship (it is not drawn on the canvas). */
  junction?: boolean;
  note?: string;
}

const labelOf = (t: Pick<TableModel, "schema" | "name">) => (t.schema && t.schema !== "public" ? `${t.schema}.${t.name}` : t.name);

/** The playground database's tables — exactly what `modelToSql(…, sqlite)` creates — sorted by name. */
export function playgroundTables(model: DiagramModel): PlaygroundTable[] {
  const { tables, fks } = resolvedSchema(model);
  const drawn = new Set(model.tables.map(tableKeyOf));
  const out = tables.map((t): PlaygroundTable => {
    const pk = new Set(pkColumns(t));
    const uniqueIndexed = new Set(t.indexes.filter((i) => i.unique && !i.pk && i.columns.length === 1).map((i) => i.columns[0]));
    const refs = new Map<string, { table: string; column: string }>();
    for (const fk of fks) {
      if (fk.child !== t) continue;
      fk.childCols.forEach((c, i) => refs.set(c, { table: labelOf(fk.parent), column: fk.parentCols[i] }));
    }
    return {
      key: tableKeyOf(t),
      label: labelOf(t),
      sqlName: qualifiedName(t, "sqlite"),
      junction: drawn.has(tableKeyOf(t)) ? undefined : true,
      note: t.note,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        pk: pk.has(c.name),
        notNull: !!c.notNull || pk.has(c.name),
        unique: !!c.unique || uniqueIndexed.has(c.name),
        increment: !!c.increment || !!canonicalType(c.type).autoIncrement,
        ref: refs.get(c.name),
        enumValues: findEnum(model, c.type)?.values.map((v) => v.name),
      })),
    };
  });
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/**
 * Everything that changes what the playground database would contain — tables, relationships, enums, sample rows —
 * and nothing that doesn't (canvas positions, colours, notes). When it differs from the one the database was built
 * from, the playground offers to re-sync.
 */
export function databaseSignature(model: DiagramModel): string {
  const cosmetic = new Set(["x", "y", "loc", "note", "headerColor", "color", "meta", "alias"]);
  return JSON.stringify({ tables: model.tables, refs: model.refs, enums: model.enums }, (k, v) => (cosmetic.has(k) ? undefined : v));
}

// ───────────────────────────── statements ─────────────────────────────

/** Splits a script into statements on top-level `;` — quote and comment aware. Comments are dropped. */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** First index at or after `i` that is not whitespace or a comment. */
function skipTrivia(sql: string, i: number): number {
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql.startsWith("--", i)) {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else return i;
  }
}

/** [from, to) of a statement's text: leading trivia and the trailing `;` / whitespace excluded. */
function trimRange(sql: string, from: number, to: number): { from: number; to: number } {
  const start = Math.min(skipTrivia(sql, from), to);
  let end = to;
  while (end > start && /[\s;]/.test(sql[end - 1])) end--;
  return { from: start, to: Math.max(end, start) };
}

/** The statement that starts at `at` (after trivia) up to its top-level `;` — for errors raised while preparing it. */
function statementAt(sql: string, at: number): { from: number; to: number } {
  const from = skipTrivia(sql, at);
  let i = from;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const close = sql.indexOf(ch, i + 1);
      i = close < 0 ? sql.length : close + 1;
      continue;
    }
    if (ch === ";") break;
    i++;
  }
  return trimRange(sql, from, i);
}

// ───────────────────────────── build ─────────────────────────────

export interface BuildReport {
  /** Tables created. */
  tables: number;
  /** Sample rows inserted. */
  rows: number;
  /** What did not go in as designed — shown as notes in the playground header. */
  issues: string[];
  timeMs: number;
}

export const SAMPLE_ROWS = 5;

/** A fresh in-memory database with the diagram's tables and sample rows. */
export function buildDatabase(SQL: SqlJsStatic, model: DiagramModel, opts: { sampleRows?: number } = {}): { db: SqlJsDatabase; report: BuildReport } {
  const started = now();
  const db = new SQL.Database();
  const issues: string[] = [];
  const { tables, fks } = resolvedSchema(model);
  const bySqlName = new Map(tables.map((t) => [qualifiedName(t, "sqlite"), t]));
  let created = 0;
  let noCycleFks = false;

  const ddl = modelToSql(model, { dialect: "sqlite", includeComments: false, includeSeedData: false, includeIndexes: true });
  for (const stmt of splitSqlStatements(ddl)) {
    try {
      db.run(stmt);
      if (/^CREATE\s+TABLE/i.test(stmt)) created++;
    } catch (e) {
      const msg = errorText(e);
      const m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")+"|[^\s(]+)/i.exec(stmt);
      const t = m ? bySqlName.get(m[1]) : undefined;
      if (t) {
        // e.g. a CHECK or DEFAULT written for another database — keep the table, lose the constraint
        try {
          db.run(minimalCreate(t));
          created++;
          issues.push(`${labelOf(t)}: created without its constraints (${msg}).`);
        } catch (e2) {
          issues.push(`${labelOf(t)}: could not be created (${errorText(e2)}).`);
        }
      } else if (/^ALTER\s+TABLE/i.test(stmt)) {
        if (!noCycleFks) issues.push("Circular foreign keys were left out — SQLite can't add a foreign key after CREATE TABLE.");
        noCycleFks = true;
      } else {
        issues.push(`${stmt.split("\n")[0].slice(0, 80)} — skipped (${msg}).`);
      }
    }
  }

  const n = opts.sampleRows ?? SAMPLE_ROWS;
  const inserted = new Map<TableModel, Record<string, RecordValue>[]>();
  let rows = 0;
  db.run("PRAGMA ignore_check_constraints = ON"); // generated values can't satisfy every CHECK expression
  for (const t of tables) {
    const done: Record<string, RecordValue>[] = [];
    inserted.set(t, done);
    if (!t.columns.length) continue;
    const target = qualifiedName(t, "sqlite");
    const rec = t.records && t.records.rows.length ? t.records : null;
    let failed = 0;
    let firstError = "";
    if (rec) {
      const cols = rec.columns.map(sqlIdent).join(", ");
      // a single integer key the rows leave out is assigned by SQLite — remember it so child rows can point at it
      const pk = pkColumns(t);
      const autoKey = pk.length === 1 && !rec.columns.includes(pk[0]) ? pk[0] : null;
      for (const r of rec.rows) {
        try {
          db.run(`INSERT INTO ${target} (${cols}) VALUES (${r.map(literal).join(", ")})`);
          const row: Record<string, RecordValue> = {};
          rec.columns.forEach((c, i) => (row[c] = r[i]));
          if (autoKey) row[autoKey] = Number(db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] ?? 0) || null;
          done.push(row);
          rows++;
        } catch (e) {
          failed++;
          firstError ||= errorText(e);
        }
      }
      if (failed) issues.push(`${labelOf(t)}: ${failed} of ${rec.rows.length} sample row${rec.rows.length === 1 ? "" : "s"} skipped (${firstError}).`);
      continue;
    }
    const next = rowGenerator(model, t, fks, inserted);
    const cols = t.columns.map((c) => sqlIdent(c.name)).join(", ");
    const marks = t.columns.map(() => "?").join(", ");
    for (let i = 1; i <= n; i++) {
      const row = next(i, done);
      try {
        db.run(`INSERT INTO ${target} (${cols}) VALUES (${marks})`, t.columns.map((c) => bindable(row[c.name])));
        done.push(row);
        rows++;
      } catch (e) {
        failed++;
        firstError ||= errorText(e);
      }
    }
    if (failed) issues.push(`${labelOf(t)}: ${failed === n ? "no sample rows could be generated" : `${failed} of ${n} generated sample rows were skipped`} (${firstError}).`);
  }
  db.run("PRAGMA ignore_check_constraints = OFF");
  // SQLite ships with foreign keys unenforced; the design's relationships (and their ON DELETE / ON UPDATE actions) should
  // behave as designed. Rows already in place are not re-checked — only what the user runs from here on.
  db.run("PRAGMA foreign_keys = ON");
  return { db, report: { tables: created, rows, issues, timeMs: round2(now() - started) } };
}

function affinity(type: string): string {
  const k = canonicalType(type).kind;
  if (k === "smallint" || k === "integer" || k === "bigint" || k === "boolean") return "INTEGER";
  if (k === "decimal" || k === "float" || k === "double") return "REAL";
  if (k === "binary") return "BLOB";
  return "TEXT";
}

function minimalCreate(t: TableModel): string {
  const pk = pkColumns(t);
  const cols = t.columns.map((c) => `${sqlIdent(c.name)} ${affinity(c.type)}${pk.length === 1 && pk[0] === c.name ? " PRIMARY KEY" : ""}`);
  if (pk.length > 1) cols.push(`PRIMARY KEY (${pk.map(sqlIdent).join(", ")})`);
  return `CREATE TABLE ${qualifiedName(t, "sqlite")} (${cols.join(", ")})`;
}

/** A DBML record value as SQLite SQL. Backtick-wrapped values are expressions (DBML's `now()` convention). */
function literal(v: RecordValue): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v.startsWith("`") && v.endsWith("`") && v.length > 1) return v.slice(1, -1);
  return `'${v.replace(/'/g, "''")}'`;
}

function bindable(v: RecordValue | undefined): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ── generated sample rows ──

const FIRST = ["Alice", "Bob", "Carol", "David", "Eva", "Frank", "Grace", "Henry"];
const LAST = ["Smith", "Johnson", "White", "Lee", "Martinez", "Brown", "Clark", "Lewis"];
const CITIES = ["New York", "London", "Toronto", "Berlin", "Paris", "Madrid", "Tokyo", "Sydney"];
const COUNTRIES = ["United States", "United Kingdom", "Canada", "Germany", "France", "Spain", "Japan", "Australia"];
const COUNTRY_CODES = ["US", "GB", "CA", "DE", "FR", "ES", "JP", "AU"];
const STATUSES = ["active", "pending", "inactive", "active", "archived"];
const PERSON_TABLES = /user|customer|member|employee|author|person|people|staff|student|contact|account|client|owner|patient|teacher|driver/;

function singular(table: string): string {
  const base = table.split(".").pop() || table;
  const s = base.replace(/_/g, " ").replace(/ies$/i, "y").replace(/(ss)$/i, "$1").replace(/s$/i, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isoDate(i: number): string {
  return new Date(Date.UTC(2024, 0, 1 + (i - 1) * 9)).toISOString().slice(0, 10);
}

function isoDateTime(i: number): string {
  return `${isoDate(i)} ${String(8 + (i % 10)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00`;
}

function fakeUuid(table: string, i: number): string {
  let h = 2166136261;
  for (const ch of `${table}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${h.toString(16).padStart(8, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

/** Fit a generated string to `varchar(n)` / `char(n)`. */
function fit(s: string, ct: CanonicalType): string {
  const n = Number(ct.args.split(",")[0]);
  return (ct.kind === "varchar" || ct.kind === "char") && n > 0 ? s.slice(0, n) : s;
}

function textSample(col: string, table: string, i: number, ct: CanonicalType): string {
  const k = (i - 1) % FIRST.length;
  const thing = singular(table);
  const short = (ct.kind === "char" || ct.kind === "varchar") && Number(ct.args) > 0 && Number(ct.args) <= 3;
  if (/email/.test(col)) return `${FIRST[k].toLowerCase()}${i > FIRST.length ? i : ""}@example.com`;
  if (/first_?name|given_?name/.test(col)) return FIRST[k];
  if (/last_?name|surname|family_?name/.test(col)) return LAST[k];
  if (/user_?name|login|handle/.test(col)) return `${FIRST[k].toLowerCase()}${i}`;
  if (col === "name" || /full_?name|display_?name|_name$/.test(col)) return PERSON_TABLES.test(table.toLowerCase()) || /full|display/.test(col) ? `${FIRST[k]} ${LAST[k]}` : `${thing} ${i}`;
  if (/phone|mobile|fax/.test(col)) return `+1 555-01${String(i).padStart(2, "0")}`;
  if (/line_?2|address_?2|apartment|suite/.test(col)) return `Apt ${i}`;
  if (/address|street|line_?1/.test(col)) return `${i * 100} Main St`;
  if (/city|town/.test(col)) return CITIES[k];
  if (/country/.test(col)) return short ? COUNTRY_CODES[k] : COUNTRIES[k];
  if (/(^|_)state($|_)|province|region/.test(col)) return ["CA", "NY", "TX", "WA", "IL", "FL", "MA", "OR"][k];
  if (/zip|postal|postcode/.test(col)) return String(10000 + i * 111);
  if (/url|website|link|href/.test(col)) return `https://example.com/${thing.toLowerCase().replace(/\s+/g, "-")}/${i}`;
  if (/slug/.test(col)) return `${thing.toLowerCase().replace(/\s+/g, "-")}-${i}`;
  if (/sku|code|ref(erence)?$/.test(col)) return `${thing.slice(0, 3).toUpperCase()}-${1000 + i}`;
  if (/status|state/.test(col)) return STATUSES[(i - 1) % STATUSES.length];
  if (/currency/.test(col)) return ["USD", "EUR", "GBP", "CAD", "JPY"][(i - 1) % 5];
  if (/colou?r/.test(col)) return ["red", "green", "blue", "orange", "purple"][(i - 1) % 5];
  if (/password|hash|token|secret|salt/.test(col)) return `hash_${i}_${fakeUuid(table, i).slice(0, 8)}`;
  if (/(^|_)ip(_|$)|ip_?address/.test(col)) return `192.168.0.${i}`;
  if (/title|subject|headline/.test(col)) return `${thing} title ${i}`;
  if (/description|summary|body|content|comment|note|bio|message|text/.test(col)) return `Sample ${thing.toLowerCase()} ${col.replace(/_/g, " ")} ${i}`;
  return `${col.replace(/_/g, " ")} ${i}`;
}

function sampleValue(model: DiagramModel, t: TableModel, c: ColumnModel, i: number, isPk: boolean): RecordValue {
  const en = findEnum(model, c.type);
  if (en && en.values.length) return en.values[(i - 1) % en.values.length].name;
  const ct = canonicalType(c.type);
  const kind = ct.kind;
  const col = c.name.toLowerCase();
  const isInt = kind === "smallint" || kind === "integer" || kind === "bigint";
  if (isInt && (isPk || c.increment || ct.autoIncrement)) return i;
  switch (kind) {
    case "boolean":
      return i % 2;
    case "date":
      return isoDate(i);
    case "timestamp":
    case "timestamptz":
      return isoDateTime(i);
    case "time":
      return `${String(8 + i).padStart(2, "0")}:30:00`;
    case "uuid":
      return fakeUuid(t.name, i);
    case "json":
    case "jsonb":
      return JSON.stringify({ id: i, sample: true });
    case "binary":
      return `sample-${i}`;
  }
  if (isInt || kind === "decimal" || kind === "float" || kind === "double") {
    let v: number;
    if (/price|amount|cost|total|revenue|balance|salary|fee|value|subtotal|tax/.test(col)) v = round2(i * 19.99);
    else if (/quantity|qty|stock|count|units|inventory/.test(col)) v = i * 10;
    else if (/rating|score|stars/.test(col)) v = ((i - 1) % 5) + 1;
    else if (/year/.test(col)) v = 2020 + i;
    else if (/age/.test(col)) v = 20 + i * 3;
    else v = isInt ? i : round2(i * 1.5);
    return isInt ? Math.round(v) : v;
  }
  if (/_at$|_on$|date|time/.test(col)) return isoDateTime(i);
  return fit(textSample(col, t.name, i, ct), ct);
}

/**
 * Row i of a generated table. Foreign-key columns take their values from rows already inserted in the parent (one
 * parent row per key, so composite keys stay consistent); self-references point at the previous row; unique columns
 * never repeat.
 */
function rowGenerator(model: DiagramModel, t: TableModel, fks: ResolvedFk[], inserted: Map<TableModel, Record<string, RecordValue>[]>) {
  const refs = new Map<string, { fk: ResolvedFk; idx: number }>();
  for (const fk of fks) if (fk.child === t) fk.childCols.forEach((c, idx) => refs.set(c, { fk, idx }));
  const pk = new Set(pkColumns(t));
  const unique = new Set<string>([...pk, ...t.columns.filter((c) => c.unique).map((c) => c.name), ...t.indexes.filter((x) => x.unique && x.columns.length === 1).map((x) => x.columns[0])]);
  const used = new Map<string, Set<string>>();
  const uniquify = (col: string, v: RecordValue, i: number): RecordValue => {
    const seen = used.get(col) ?? new Set<string>();
    used.set(col, seen);
    let out = v;
    if (seen.has(String(out))) {
      if (typeof out === "number") while (seen.has(String(out))) out = (out as number) + 1;
      else {
        let k = 2;
        out = `${v}-${i}`;
        while (seen.has(String(out))) out = `${v}-${i}-${k++}`;
      }
    }
    seen.add(String(out));
    return out;
  };

  return (i: number, sofar: Record<string, RecordValue>[]): Record<string, RecordValue> => {
    const row: Record<string, RecordValue> = {};
    const parentRow = new Map<ResolvedFk, Record<string, RecordValue> | null>();
    for (const c of t.columns) {
      const r = refs.get(c.name);
      let v: RecordValue = null;
      if (r) {
        if (!parentRow.has(r.fk)) {
          const self = r.fk.parent === t;
          const pool = self ? sofar : inserted.get(r.fk.parent) || [];
          parentRow.set(r.fk, self ? (pool.length ? pool[pool.length - 1] : null) : pool.length ? pool[(i - 1) % pool.length] : null);
        }
        const p = parentRow.get(r.fk);
        v = p ? p[r.fk.parentCols[r.idx]] ?? null : null;
        if (v === null && (c.notNull || pk.has(c.name))) v = sampleValue(model, t, c, i, pk.has(c.name));
      } else {
        v = sampleValue(model, t, c, i, pk.has(c.name));
      }
      if (v !== null && unique.has(c.name) && !r) v = uniquify(c.name, v, i);
      row[c.name] = v;
    }
    return row;
  };
}

// ───────────────────────────── run ─────────────────────────────

export interface ResultSet {
  /** 0-based index of the statement that produced it. */
  statementIndex: number;
  /** The statement's SQL, trimmed. */
  sql: string;
  columns: string[];
  /** At most `maxRows`. BLOBs are summarised as text. */
  rows: (string | number | null)[][];
  /** Rows the statement produced (counted up to `maxScanRows`). */
  totalRows: number;
  /** More rows exist than `rows` holds. */
  truncated: boolean;
}

export interface RunError {
  message: string;
  statementIndex: number;
  /** Source range of the failing statement, offset by `RunOptions.offset`. */
  from: number;
  to: number;
}

export interface RunOutcome {
  resultSets: ResultSet[];
  /** Statements that ran to completion. */
  statements: number;
  /** Rows changed by INSERT / UPDATE / DELETE (triggers included). */
  rowsAffected: number;
  timeMs: number;
  error?: RunError;
  /** Why execution stopped before the end, when a row or time limit did it. */
  notice?: string;
}

export interface RunOptions {
  /** Added to error ranges — the position of a run selection inside the editor. */
  offset?: number;
  maxRows?: number;
  maxScanRows?: number;
  timeBudgetMs?: number;
}

function totalChanges(db: SqlJsDatabase): number {
  try {
    return Number(db.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

const display = (v: SqlValue): string | number | null => (v instanceof Uint8Array ? `<BLOB ${v.length} bytes>` : v);

/** Runs every statement in `sql`, stopping at the first error. */
export function runSql(db: SqlJsDatabase, sql: string, opts: RunOptions = {}): RunOutcome {
  const { offset = 0, maxRows = 1000, maxScanRows = 100_000, timeBudgetMs = 20_000 } = opts;
  const started = now();
  const changesBefore = totalChanges(db);
  const out: RunOutcome = { resultSets: [], statements: 0, rowsAffected: 0, timeMs: 0 };
  const finish = () => {
    out.rowsAffected = Math.max(0, totalChanges(db) - changesBefore);
    out.timeMs = round2(now() - started);
    return out;
  };

  let it: SqlJsStatementIterator;
  try {
    it = db.iterateStatements(sql);
  } catch (e) {
    const r = trimRange(sql, 0, sql.length);
    out.error = { message: errorText(e), statementIndex: 0, from: offset + r.from, to: offset + r.to };
    return finish();
  }

  for (let index = 0; ; index++) {
    const start = sql.length - it.getRemainingSQL().length;
    let next: IteratorResult<SqlJsStatement>;
    try {
      next = it.next();
    } catch (e) {
      // a failed prepare leaves the remaining SQL at the start of the statement that failed
      const r = statementAt(sql, sql.length - it.getRemainingSQL().length);
      out.error = { message: errorText(e), statementIndex: index, from: offset + r.from, to: offset + r.to };
      return finish();
    }
    if (next.done) break;
    const stmt = next.value;
    const range = trimRange(sql, start, sql.length - it.getRemainingSQL().length);
    try {
      const columns = stmt.getColumnNames();
      if (columns.length) {
        const rs: ResultSet = { statementIndex: index, sql: stmt.getSQL().trim(), columns, rows: [], totalRows: 0, truncated: false };
        out.resultSets.push(rs);
        while (stmt.step()) {
          rs.totalRows++;
          if (rs.rows.length < maxRows) rs.rows.push(stmt.get().map(display));
          else rs.truncated = true;
          if (rs.totalRows >= maxScanRows) {
            rs.truncated = true;
            out.notice = `Stopped reading after ${maxScanRows.toLocaleString("en-US")} rows.`;
            break;
          }
          if ((rs.totalRows & 1023) === 0 && now() - started > timeBudgetMs) {
            rs.truncated = true;
            out.notice = `Stopped after ${Math.round(timeBudgetMs / 1000)} s — the query was still running.`;
            break;
          }
        }
      } else {
        stmt.step();
      }
      out.statements++;
    } catch (e) {
      stmt.free();
      it.finalize?.();
      out.error = { message: errorText(e), statementIndex: index, from: offset + range.from, to: offset + range.to };
      return finish();
    }
    if (out.notice) {
      stmt.free();
      it.finalize?.();
      break;
    }
  }
  return finish();
}
