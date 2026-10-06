/**
 * SQL DDL → DiagramModel.
 *
 * Handles the output of pg_dump / mysqldump / SSMS / Oracle SQL Developer / Snowflake / BigQuery:
 *  - CREATE TABLE (quoted identifiers `"x"` `` `x` `` `[x]`, schema-qualified names, inline + table constraints)
 *  - ALTER TABLE … ADD [CONSTRAINT] PRIMARY KEY / FOREIGN KEY / UNIQUE / CHECK
 *  - CREATE [UNIQUE] INDEX, CREATE TYPE … AS ENUM, COMMENT ON, INSERT … VALUES (sample data)
 */
import {
  CheckModel,
  ColumnModel,
  DefaultValue,
  DiagramModel,
  EnumModel,
  IndexModel,
  RecordValue,
  ReferentialAction,
  TableModel,
  emptyModel,
  tableKey,
} from "../model/types";
import { SqlDialect } from "./dialects";

interface T {
  t: "w" | "q" | "s" | "n" | "p";
  v: string;
  s: number;
  e: number;
}

export interface SqlParseResult {
  model: DiagramModel;
  warnings: string[];
  dialect: SqlDialect | undefined;
}

// ───────────────────────────── statement splitting ─────────────────────────────

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  while (i < n) {
    const c = sql[i];
    const two = sql.substr(i, 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "#" && /^[ \t]*$/.test(cur.slice(cur.lastIndexOf("\n") + 1))) {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      cur += " ";
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_]*)\$/.exec(sql.slice(i, i + 40));
      if (m) {
        const end = sql.indexOf(m[0], i + m[0].length);
        const stop = end < 0 ? n : end + m[0].length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      push();
      i++;
      continue;
    }
    // MSSQL batch separator
    if ((c === "G" || c === "g") && /^go\s*(\r?\n|$)/i.test(sql.slice(i, i + 6)) && /^[ \t]*$/.test(cur.slice(cur.lastIndexOf("\n") + 1))) {
      push();
      i += 2;
      continue;
    }
    cur += c;
    i++;
  }
  push();
  return out;
}

// ───────────────────────────── tokenizer ─────────────────────────────

function tokenize(s: string): T[] {
  const out: T[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === "'") {
      let j = i + 1;
      let val = "";
      while (j < n) {
        if (s[j] === "\\" && j + 1 < n) {
          val += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            val += "'";
            j += 2;
            continue;
          }
          break;
        }
        val += s[j];
        j++;
      }
      out.push({ t: "s", v: val, s: start, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`") {
      let j = i + 1;
      let val = "";
      while (j < n) {
        if (s[j] === c) {
          if (s[j + 1] === c) {
            val += c;
            j += 2;
            continue;
          }
          break;
        }
        val += s[j];
        j++;
      }
      out.push({ t: "q", v: val, s: start, e: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const prev = out[out.length - 1];
      const adjacent = prev && prev.e === i && (prev.t === "w" || prev.t === "q");
      const close = s.indexOf("]", i + 1);
      if (!adjacent && close > 0 && !/[\n]/.test(s.slice(i, close)) && s[i + 1] !== "]") {
        out.push({ t: "q", v: s.slice(i + 1, close), s: start, e: close + 1 });
        i = close + 1;
        continue;
      }
      out.push({ t: "p", v: "[", s: start, e: i + 1 });
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] || ""))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      const len = m ? m[0].length : 1;
      out.push({ t: "n", v: s.slice(i, i + len), s: start, e: i + len });
      i += len;
      continue;
    }
    if (/[A-Za-z_@#-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$@#-￿]/.test(s[j])) j++;
      out.push({ t: "w", v: s.slice(i, j), s: start, e: j });
      i = j;
      continue;
    }
    out.push({ t: "p", v: c, s: start, e: i + 1 });
    i++;
  }
  return out;
}

// ───────────────────────────── token helpers ─────────────────────────────

const lw = (t?: T) => (t && t.t === "w" ? t.v.toLowerCase() : "");
const isP = (t: T | undefined, v: string) => !!t && t.t === "p" && t.v === v;
const isName = (t?: T) => !!t && (t.t === "w" || t.t === "q");

function matchParen(toks: T[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (isP(toks[i], "(")) depth++;
    else if (isP(toks[i], ")")) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return toks.length - 1;
}

function splitTopLevel(toks: T[]): T[][] {
  const parts: T[][] = [];
  let cur: T[] = [];
  let depth = 0;
  for (const t of toks) {
    if (isP(t, "(")) depth++;
    if (isP(t, ")")) depth--;
    if (isP(t, ",") && depth === 0) {
      parts.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) parts.push(cur);
  return parts;
}

const DEFAULT_SCHEMAS = new Set(["public", "dbo", "main"]);

interface QName {
  schema?: string;
  name: string;
  next: number;
}

function readQName(toks: T[], i: number): QName | undefined {
  const parts: string[] = [];
  let j = i;
  while (j < toks.length && isName(toks[j])) {
    parts.push(toks[j].v);
    j++;
    if (isP(toks[j], ".") && isName(toks[j + 1])) j++;
    else break;
  }
  if (!parts.length) return undefined;
  const name = parts[parts.length - 1];
  const schemaRaw = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const schema = schemaRaw && !DEFAULT_SCHEMAS.has(schemaRaw.toLowerCase()) ? schemaRaw : undefined;
  return { schema, name, next: j };
}

function normAction(words: string[]): ReferentialAction | undefined {
  const t = words.join(" ").toLowerCase().trim();
  if (t.startsWith("cascade")) return "cascade";
  if (t.startsWith("restrict")) return "restrict";
  if (t.startsWith("no action")) return "no action";
  if (t.startsWith("set null")) return "set null";
  if (t.startsWith("set default")) return "set default";
  return undefined;
}

// ───────────────────────────── main parse ─────────────────────────────

interface PendingFk {
  table: TableModel;
  cols: string[];
  refSchema?: string;
  refTable: string;
  refCols: string[];
  name?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

const CONSTRAINT_STARTERS = new Set([
  "not", "null", "default", "primary", "unique", "references", "check", "constraint", "auto_increment", "autoincrement",
  "identity", "generated", "comment", "collate", "charset", "encode", "distkey", "sortkey", "as", "stored", "virtual",
]);

export function parseSql(sql: string, hint?: SqlDialect): SqlParseResult {
  const model = emptyModel();
  const warnings: string[] = [];
  const tables = new Map<string, TableModel>();
  const fks: PendingFk[] = [];
  const comments: { schema?: string; table: string; column?: string; text: string }[] = [];
  const inserts: { schema?: string; table: string; cols: string[]; rows: RecordValue[][] }[] = [];
  const src = sql;
  let currentStmt = "";

  const keyOf = (schema: string | undefined, name: string) => `${(schema || "").toLowerCase()}.${name.toLowerCase()}`;
  const findTable = (schema: string | undefined, name: string): TableModel | undefined => {
    const exact = tables.get(keyOf(schema, name));
    if (exact) return exact;
    const cands = [...tables.values()].filter((t) => t.name.toLowerCase() === name.toLowerCase());
    return cands.length === 1 ? cands[0] : cands.find((t) => !t.schema) || cands[0];
  };

  for (const stmt of splitStatements(src)) {
    const toks = tokenize(stmt);
    if (!toks.length) continue;
    const first = lw(toks[0]);
    currentStmt = stmt;
    try {
      if (first === "create") parseCreate(toks, stmt);
      else if (first === "alter") parseAlter(toks, stmt);
      else if (first === "comment") parseCommentOn(toks);
      else if (first === "insert") parseInsert(toks, stmt);
    } catch (e: any) {
      warnings.push(`Skipped a statement: ${e?.message || e}`);
    }
  }

  // ── enum types / comments / records / foreign keys ──
  for (const c of comments) {
    const t = findTable(c.schema, c.table);
    if (!t) continue;
    if (c.column) {
      const col = t.columns.find((x) => x.name.toLowerCase() === c.column!.toLowerCase());
      if (col) col.note = c.text;
    } else t.note = c.text;
  }
  for (const ins of inserts) {
    const t = findTable(ins.schema, ins.table);
    if (!t) continue;
    const cols = ins.cols.length ? ins.cols : t.columns.map((c) => c.name);
    const rec = (t.records ||= { columns: cols, rows: [] });
    if (rec.columns.join(",") !== cols.join(",")) continue;
    for (const r of ins.rows) if (rec.rows.length < 500) rec.rows.push(r);
  }
  for (const fk of fks) {
    const parent = findTable(fk.refSchema, fk.refTable);
    const refCols = fk.refCols.length ? fk.refCols : parent ? pkOf(parent) : [];
    const childPk = pkOf(fk.table);
    const child = fk.table;
    const single = fk.cols.length === 1 ? child.columns.find((c) => c.name === fk.cols[0]) : undefined;
    const isOneToOne = (single && single.unique) || (childPk.length === fk.cols.length && childPk.length > 0 && childPk.every((c) => fk.cols.includes(c)) && fk.cols.length === 1);
    const childEp = { schema: child.schema, table: child.name, columns: fk.cols };
    const parentEp = { schema: parent ? parent.schema : fk.refSchema, table: parent ? parent.name : fk.refTable, columns: refCols };
    if (!parent) warnings.push(`Foreign key ${child.name}(${fk.cols.join(", ")}) references unknown table ${fk.refTable}`);
    model.refs.push(
      isOneToOne
        ? { name: fk.name, from: parentEp, to: childEp, type: "one-to-one", onDelete: fk.onDelete, onUpdate: fk.onUpdate }
        : { name: fk.name, from: childEp, to: parentEp, type: "many-to-one", onDelete: fk.onDelete, onUpdate: fk.onUpdate }
    );
  }
  model.tables = [...tables.values()];

  return { model, warnings, dialect: hint ?? detectDialect(sql) };

  // ─────────────────────────── inner parsers ───────────────────────────

  function pkOf(t: TableModel): string[] {
    const inline = t.columns.filter((c) => c.pk).map((c) => c.name);
    if (inline.length) return inline;
    return t.indexes.find((i) => i.pk)?.columns || [];
  }

  function parseCreate(toks: T[], stmt: string) {
    let i = 1;
    let unique = false;
    const mods = new Set(["or", "replace", "temp", "temporary", "global", "local", "unlogged", "transient", "volatile", "external", "clustered", "nonclustered", "fulltext", "spatial", "bitmap", "columnstore", "if", "not", "exists", "concurrently", "only"]);
    while (i < toks.length && mods.has(lw(toks[i]))) i++;
    if (lw(toks[i]) === "unique") {
      unique = true;
      i++;
      while (i < toks.length && mods.has(lw(toks[i]))) i++;
    }
    const kind = lw(toks[i]);
    if (kind === "table") return createTable(toks, i + 1, stmt);
    if (kind === "index") return createIndex(toks, i + 1, unique);
    if (kind === "type") return createType(toks, i + 1);
  }

  function createType(toks: T[], i: number) {
    while (["if", "not", "exists"].includes(lw(toks[i]))) i++;
    const qn = readQName(toks, i);
    if (!qn) return;
    let j = qn.next;
    if (lw(toks[j]) !== "as" || lw(toks[j + 1]) !== "enum") return;
    j += 2;
    if (!isP(toks[j], "(")) return;
    const end = matchParen(toks, j);
    const values = toks.slice(j + 1, end).filter((t) => t.t === "s").map((t) => ({ name: t.v }));
    const en: EnumModel = { schema: qn.schema, name: qn.name, values };
    model.enums.push(en);
  }

  function createTable(toks: T[], i: number, stmt: string) {
    while (["if", "not", "exists"].includes(lw(toks[i]))) i++;
    const qn = readQName(toks, i);
    if (!qn) return;
    const j = qn.next;
    if (lw(toks[j]) === "as" || lw(toks[j]) === "like") return;
    if (!isP(toks[j], "(")) return;
    const close = matchParen(toks, j);
    const defs = splitTopLevel(toks.slice(j + 1, close));
    const table: TableModel = { schema: qn.schema, name: qn.name, columns: [], indexes: [], checks: [] };
    if (tables.has(keyOf(qn.schema, qn.name))) return;
    tables.set(keyOf(qn.schema, qn.name), table);

    // table options (MySQL COMMENT='...')
    for (let k = close + 1; k < toks.length; k++) {
      if (lw(toks[k]) === "comment") {
        let m = k + 1;
        if (isP(toks[m], "=")) m++;
        if (toks[m]?.t === "s") table.note = toks[m].v;
      }
    }

    for (const def of defs) {
      if (!def.length) continue;
      if (isTableConstraint(def)) parseTableConstraint(def, table, stmt);
      else parseColumn(def, table, stmt);
    }
    // enum synthesis for inline ENUM('a','b')
    void stmt;
  }

  function isTableConstraint(def: T[]): boolean {
    const w = lw(def[0]);
    if (w === "constraint") return true;
    if (w === "primary" && lw(def[1]) === "key") return true;
    if (w === "foreign" && lw(def[1]) === "key") return true;
    if (w === "unique" && (isP(def[1], "(") || ["key", "index"].includes(lw(def[1])) || (isName(def[1]) && isP(def[2], "(")))) return true;
    if (w === "check" && isP(def[1], "(")) return true;
    if ((w === "key" || w === "index") && (isP(def[1], "(") || (isName(def[1]) && isP(def[2], "(")))) return true;
    if ((w === "fulltext" || w === "spatial") && ["key", "index"].includes(lw(def[1]))) return true;
    if (w === "exclude" || w === "period") return true;
    return false;
  }

  function colList(toks: T[]): string[] {
    return splitTopLevel(toks).map((item) => {
      const first = item[0];
      if (!first) return "";
      if (isName(first) && (item.length === 1 || !isP(item[1], "(") || item.slice(2, -1).every((t) => t.t === "n") || item.length === 4 && item[2].t === "n")) {
        return first.v;
      }
      if (isName(first) && ["asc", "desc", "collate", "nulls"].includes(lw(item[1]))) return first.v;
      // expression
      return "`" + stmtSlice(item) + "`";
    });
  }

  function stmtSlice(toks: T[]): string {
    return currentStmt.slice(toks[0].s, toks[toks.length - 1].e).replace(/\s+/g, " ").trim();
  }

  /** Parses `table [(cols)] [ON DELETE x] [ON UPDATE y] [MATCH …] [DEFERRABLE …]` after a REFERENCES keyword. */
  function parseRefTail(
    toks: T[],
    j: number
  ): { schema?: string; table: string; cols: string[]; onDelete?: ReferentialAction; onUpdate?: ReferentialAction; end: number } | undefined {
    const qn = readQName(toks, j);
    if (!qn) return undefined;
    let k = qn.next;
    let cols: string[] = [];
    if (isP(toks[k], "(")) {
      const end = matchParen(toks, k);
      cols = colList(toks.slice(k + 1, end));
      k = end + 1;
    }
    let onDelete: ReferentialAction | undefined;
    let onUpdate: ReferentialAction | undefined;
    for (;;) {
      const w = lw(toks[k]);
      if (w === "on" && ["delete", "update"].includes(lw(toks[k + 1]))) {
        const which = lw(toks[k + 1]);
        const w1 = lw(toks[k + 2]);
        let words: string[];
        if (w1 === "set" || w1 === "no") words = [w1, lw(toks[k + 3])];
        else words = [w1];
        const a = normAction(words);
        if (which === "delete") onDelete = a;
        else onUpdate = a;
        k += 2 + words.length;
      } else if (w === "match" || w === "initially") k += 2;
      else if (w === "not" && ["deferrable", "valid", "enforced"].includes(lw(toks[k + 1]))) k += 2;
      else if (["deferrable", "enable", "disable", "novalidate", "validate", "rely", "norely"].includes(w)) k++;
      else break;
    }
    return { schema: qn.schema, table: qn.name, cols, onDelete, onUpdate, end: k };
  }

  function parseTableConstraint(def: T[], table: TableModel, stmt: string) {
    currentStmt = stmt;
    let i = 0;
    let cname: string | undefined;
    if (lw(def[0]) === "constraint") {
      cname = def[1]?.v;
      i = 2;
    }
    const w = lw(def[i]);
    if (w === "primary") {
      const open = def.findIndex((t, idx) => idx > i && isP(t, "("));
      if (open < 0) return;
      const cols = colList(def.slice(open + 1, matchParen(def, open))).filter(Boolean);
      applyPk(table, cols);
    } else if (w === "foreign") {
      const open = def.findIndex((t, idx) => idx > i && isP(t, "("));
      const close = matchParen(def, open);
      const cols = colList(def.slice(open + 1, close));
      const refIdx = def.findIndex((t, idx) => idx > close && lw(t) === "references");
      if (refIdx < 0) return;
      const r = parseRefTail(def, refIdx + 1);
      if (!r) return;
      fks.push({ table, cols, refSchema: r.schema, refTable: r.table, refCols: r.cols, name: cname, onDelete: r.onDelete, onUpdate: r.onUpdate });
    } else if (w === "unique") {
      const open = def.findIndex((t, idx) => idx > i && isP(t, "("));
      if (open < 0) return;
      const cols = colList(def.slice(open + 1, matchParen(def, open))).filter(Boolean);
      // MySQL: UNIQUE [KEY|INDEX] [name] (cols)   ·   others: CONSTRAINT name UNIQUE (cols)
      let k = i + 1;
      if (["key", "index"].includes(lw(def[k]))) k++;
      const inlineName = k < open && isName(def[k]) ? def[k].v : undefined;
      applyUnique(table, cols, cname || inlineName);
    } else if (w === "check") {
      const open = def.findIndex((t, idx) => idx >= i && isP(t, "("));
      if (open < 0) return;
      const close = matchParen(def, open);
      const ck: CheckModel = { expression: currentStmt.slice(def[open + 1]?.s ?? 0, def[close]?.s ?? 0).replace(/\s+/g, " ").trim() };
      if (cname) ck.name = cname;
      if (ck.expression) table.checks.push(ck);
    } else if (w === "key" || w === "index" || w === "fulltext" || w === "spatial") {
      let k = i + (w === "fulltext" || w === "spatial" ? 2 : 1);
      let name: string | undefined;
      if (isName(def[k]) && isP(def[k + 1], "(")) {
        name = def[k].v;
        k++;
      }
      const open = k;
      if (!isP(def[open], "(")) return;
      const cols = colList(def.slice(open + 1, matchParen(def, open))).filter(Boolean);
      const ix: IndexModel = { columns: cols };
      if (name) ix.name = name;
      if (w === "fulltext" || w === "spatial") ix.type = w;
      table.indexes.push(ix);
    }
  }

  function applyPk(table: TableModel, cols: string[]) {
    if (cols.length === 1) {
      const c = table.columns.find((x) => x.name.toLowerCase() === cols[0].toLowerCase());
      if (c) {
        c.pk = true;
        c.notNull = true;
      }
    } else if (cols.length > 1) {
      for (const cn of cols) {
        const c = table.columns.find((x) => x.name.toLowerCase() === cn.toLowerCase());
        if (c) c.notNull = true;
      }
      table.indexes.push({ columns: cols, pk: true });
    }
  }

  function applyUnique(table: TableModel, cols: string[], name?: string) {
    if (cols.length === 1 && !cols[0].startsWith("`")) {
      const c = table.columns.find((x) => x.name.toLowerCase() === cols[0].toLowerCase());
      if (c) {
        c.unique = true;
        return;
      }
    }
    const ix: IndexModel = { columns: cols, unique: true };
    if (name) ix.name = name;
    table.indexes.push(ix);
  }

  function parseColumn(def: T[], table: TableModel, stmt: string) {
    currentStmt = stmt;
    if (!isName(def[0])) return;
    const name = def[0].v;
    let i = 1;
    const typeStart = i;
    while (i < def.length) {
      const w = lw(def[i]);
      if (isP(def[i], "(")) {
        i = matchParen(def, i) + 1;
        continue;
      }
      if (def[i].t === "w" && CONSTRAINT_STARTERS.has(w)) break;
      if (w === "on" && lw(def[i + 1]) === "update") break;
      if (w === "character" && lw(def[i + 1]) === "set") break;
      if (w === "with" && lw(def[i + 1]) !== "time" && lw(def[i + 1]) !== "local") break;
      i++;
    }
    let typeText = def.length > typeStart && i > typeStart ? stmt.slice(def[typeStart].s, def[i - 1].e).replace(/\s+/g, " ").trim() : "varchar(255)";
    typeText = typeText.replace(/\s*,\s*/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    // MySQL display widths (int(11)) carry no meaning — but tinyint(1) is the boolean idiom, keep it
    typeText = typeText.replace(/^((?:tiny|small|medium|big)?int(?:eger)?)\s*\((\d+)\)/i, (m, base: string, w: string) => (/^tinyint$/i.test(base) && w === "1" ? m : base));
    // keep the case the author used except for well-known upper-case keywords
    const col: ColumnModel = { name, type: typeText };
    // enum('a','b') → synthesised enum type
    const em = /^enum\s*\((.*)\)$/i.exec(typeText);
    if (em) {
      const values = Array.from(em[1].matchAll(/'((?:[^']|'')*)'/g)).map((m) => ({ name: m[1].replace(/''/g, "'") }));
      const enName = `${table.name}_${name}`;
      if (!model.enums.some((e) => e.name === enName && e.schema === table.schema)) model.enums.push({ schema: table.schema, name: enName, values });
      col.type = enName;
    } else if (/^set\s*\(/i.test(typeText)) col.type = "varchar(255)";

    while (i < def.length) {
      const w = lw(def[i]);
      if (w === "constraint") {
        i += 2;
        continue;
      }
      if (w === "not" && lw(def[i + 1]) === "null") {
        col.notNull = true;
        i += 2;
        continue;
      }
      if (w === "null") {
        col.notNull = false;
        i++;
        continue;
      }
      if (w === "primary") {
        col.pk = true;
        col.notNull = true;
        i += lw(def[i + 1]) === "key" ? 2 : 1;
        continue;
      }
      if (w === "unique") {
        col.unique = true;
        i += lw(def[i + 1]) === "key" ? 2 : 1;
        continue;
      }
      if (w === "auto_increment" || w === "autoincrement") {
        col.increment = true;
        i++;
        continue;
      }
      if (w === "identity") {
        col.increment = true;
        i++;
        if (isP(def[i], "(")) i = matchParen(def, i) + 1;
        continue;
      }
      if (w === "generated") {
        let k = i + 1;
        while (k < def.length && ["always", "by", "default", "as"].includes(lw(def[k]))) k++;
        if (lw(def[k]) === "identity") {
          col.increment = true;
          k++;
          if (isP(def[k], "(")) k = matchParen(def, k) + 1;
        } else if (isP(def[k], "(")) {
          k = matchParen(def, k) + 1; // computed column
          if (["stored", "virtual"].includes(lw(def[k]))) k++;
        }
        i = Math.max(k, i + 1);
        continue;
      }
      if (w === "as" && isP(def[i + 1], "(")) {
        i = matchParen(def, i + 1) + 1;
        if (["stored", "virtual", "persisted"].includes(lw(def[i]))) i++;
        continue;
      }
      if (w === "default") {
        let k = i + 1;
        const start = k;
        let depth = 0;
        while (k < def.length) {
          const t = def[k];
          if (isP(t, "(")) depth++;
          if (isP(t, ")")) depth--;
          if (depth === 0 && k > start) {
            const tw = lw(t);
            const prevIsCast = isP(def[k - 1], ":");
            if (t.t === "w" && !prevIsCast && CONSTRAINT_STARTERS.has(tw) && tw !== "as" && tw !== "null") break;
            if (tw === "on" && lw(def[k + 1]) === "update") break;
            if (tw === "character" && lw(def[k + 1]) === "set") break;
          }
          k++;
        }
        const raw = stmt.slice(def[start]?.s ?? 0, def[k - 1]?.e ?? 0);
        const parsed = parseDefaultText(raw);
        if (parsed === "increment") col.increment = true;
        else if (parsed) col.default = parsed;
        i = k;
        continue;
      }
      if (w === "references") {
        const r = parseRefTail(def, i + 1);
        if (r) {
          fks.push({ table, cols: [name], refSchema: r.schema, refTable: r.table, refCols: r.cols, onDelete: r.onDelete, onUpdate: r.onUpdate });
          i = Math.max(r.end, i + 1);
        } else i++;
        continue;
      }
      if (w === "check" && isP(def[i + 1], "(")) {
        const close = matchParen(def, i + 1);
        const expr = stmt.slice(def[i + 2]?.s ?? 0, def[close]?.s ?? 0).replace(/\s+/g, " ").trim();
        if (expr) (col.checks ||= []).push(expr);
        i = close + 1;
        continue;
      }
      if (w === "comment") {
        if (def[i + 1]?.t === "s") col.note = def[i + 1].v;
        i += 2;
        continue;
      }
      if (w === "collate" || w === "charset" || w === "encode") {
        i += 2;
        continue;
      }
      if (w === "character" && lw(def[i + 1]) === "set") {
        i += 3;
        continue;
      }
      if (w === "on" && lw(def[i + 1]) === "update") {
        i += 2;
        while (i < def.length && !CONSTRAINT_STARTERS.has(lw(def[i]))) i++;
        continue;
      }
      if (w === "distkey" || w === "sortkey") {
        i++;
        continue;
      }
      i++;
    }
    // serial types imply auto-increment; pg_dump emits nextval defaults for them
    table.columns.push(col);
  }

  function createIndex(toks: T[], i: number, unique: boolean) {
    while (["concurrently", "if", "not", "exists"].includes(lw(toks[i]))) i++;
    let name: string | undefined;
    if (lw(toks[i]) !== "on") {
      const qn = readQName(toks, i);
      if (qn) {
        name = qn.name;
        i = qn.next;
      }
    }
    if (lw(toks[i]) !== "on") return;
    i++;
    if (lw(toks[i]) === "only") i++;
    const qn = readQName(toks, i);
    if (!qn) return;
    let j = qn.next;
    let type: string | undefined;
    if (lw(toks[j]) === "using") {
      type = lw(toks[j + 1]);
      j += 2;
    }
    if (!isP(toks[j], "(")) return;
    const close = matchParen(toks, j);
    const cols = colList(toks.slice(j + 1, close)).filter(Boolean);
    if (lw(toks[close + 1]) === "using") type = lw(toks[close + 2]);
    const t = findTable(qn.schema, qn.name);
    if (!t) return;
    const ix: IndexModel = { columns: cols };
    if (name) ix.name = name;
    if (unique) ix.unique = true;
    if (type && type !== "btree") ix.type = type;
    if (unique && cols.length === 1 && !name && !cols[0].startsWith("`")) {
      const c = t.columns.find((x) => x.name === cols[0]);
      if (c) {
        c.unique = true;
        return;
      }
    }
    t.indexes.push(ix);
  }

  function parseAlter(toks: T[], stmt: string) {
    if (lw(toks[1]) !== "table") return;
    let i = 2;
    while (["only", "if", "exists"].includes(lw(toks[i]))) i++;
    const qn = readQName(toks, i);
    if (!qn) return;
    const table = findTable(qn.schema, qn.name);
    if (!table) return;
    const actions = splitTopLevel(toks.slice(qn.next));
    for (const a of actions) {
      if (lw(a[0]) !== "add") continue;
      let k = 1;
      if (lw(a[k]) === "column") k++;
      while (["if", "not", "exists"].includes(lw(a[k])) && lw(a[k + 1]) !== "null") k++;
      const rest = a.slice(k);
      if (!rest.length) continue;
      if (isTableConstraint(rest)) parseTableConstraint(rest, table, stmt);
      else if (isName(rest[0])) parseColumn(rest, table, stmt);
    }
  }

  function parseCommentOn(toks: T[]) {
    if (lw(toks[1]) !== "on") return;
    const kind = lw(toks[2]);
    const isIdx = toks.findIndex((t) => lw(t) === "is");
    if (isIdx < 0 || toks[isIdx + 1]?.t !== "s") return;
    const text = toks[isIdx + 1].v;
    const names: string[] = [];
    for (let k = 3; k < isIdx; k++) if (isName(toks[k])) names.push(toks[k].v);
    if (kind === "table" && names.length) {
      const name = names[names.length - 1];
      const schema = names.length > 1 && !DEFAULT_SCHEMAS.has(names[names.length - 2].toLowerCase()) ? names[names.length - 2] : undefined;
      comments.push({ schema, table: name, text });
    } else if (kind === "column" && names.length >= 2) {
      const column = names[names.length - 1];
      const table = names[names.length - 2];
      const schema = names.length > 2 && !DEFAULT_SCHEMAS.has(names[names.length - 3].toLowerCase()) ? names[names.length - 3] : undefined;
      comments.push({ schema, table, column, text });
    }
  }

  function parseInsert(toks: T[], stmt: string) {
    let i = 1;
    while (["ignore", "or", "replace", "into", "overwrite", "table"].includes(lw(toks[i]))) i++;
    const qn = readQName(toks, i);
    if (!qn) return;
    let j = qn.next;
    let cols: string[] = [];
    if (isP(toks[j], "(")) {
      const end = matchParen(toks, j);
      cols = toks.slice(j + 1, end).filter(isName).map((t) => t.v);
      j = end + 1;
    }
    if (lw(toks[j]) !== "values" && lw(toks[j]) !== "value") return;
    j++;
    const rows: RecordValue[][] = [];
    while (j < toks.length) {
      if (!isP(toks[j], "(")) break;
      const end = matchParen(toks, j);
      const items = splitTopLevel(toks.slice(j + 1, end));
      rows.push(items.map((it) => literal(it, stmt)));
      j = end + 1;
      if (isP(toks[j], ",")) j++;
      else break;
    }
    if (rows.length) inserts.push({ schema: qn.schema, table: qn.name, cols, rows });
  }
}

function literal(it: T[], stmt: string): RecordValue {
  if (!it.length) return null;
  if (it.length === 1) {
    const t = it[0];
    if (t.t === "s") return t.v;
    if (t.t === "n") return Number(t.v);
    const w = t.v.toLowerCase();
    if (w === "null") return null;
    if (w === "true") return true;
    if (w === "false") return false;
  }
  if (it.length === 2 && it[0].t === "p" && it[0].v === "-" && it[1].t === "n") return -Number(it[1].v);
  if (it.length === 2 && it[0].t === "w" && /^[NEBX]$/i.test(it[0].v) && it[1].t === "s") return it[1].v;
  return "`" + stmt.slice(it[0].s, it[it.length - 1].e).replace(/\s+/g, " ").trim() + "`";
}

/** Converts a raw SQL default expression into a DefaultValue (or "increment" for nextval()). */
export function parseDefaultText(input: string): DefaultValue | "increment" | undefined {
  let raw = input.trim();
  if (!raw) return undefined;
  for (let guard = 0; guard < 4; guard++) {
    const m = /^\((.*)\)$/s.exec(raw);
    if (!m) break;
    // only strip if parens are balanced as a single wrapper
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < raw.length - 1; i++) {
      if (raw[i] === "(") depth++;
      if (raw[i] === ")") depth--;
      if (depth === 0) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    raw = m[1].trim();
  }
  if (/^null$/i.test(raw)) return { kind: "null", value: "null" };
  if (/^(true|false)$/i.test(raw)) return { kind: "boolean", value: raw.toLowerCase() };
  if (/^[-+]?\d+(\.\d+)?$/.test(raw)) return { kind: "number", value: raw.replace(/^\+/, "") };
  if (/^nextval\s*\(/i.test(raw)) return "increment";
  const str = /^(?:[NEnex])?'((?:[^']|'')*)'(?:\s*::\s*[\w\s."]+(?:\(\d+(?:,\d+)?\))?)?$/s.exec(raw);
  if (str) return { kind: "string", value: str[1].replace(/''/g, "'") };
  return { kind: "expression", value: raw };
}

// ───────────────────────────── dialect detection ─────────────────────────────

export function detectDialect(sql: string): SqlDialect | undefined {
  const s = sql;
  if (/\bENGINE\s*=|\bAUTO_INCREMENT\b|`\w+`|\bUNSIGNED\b|\bMEDIUMINT\b|\bLONGTEXT\b/i.test(s)) return "mysql";
  if (/\[dbo\]|\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)|\bNVARCHAR\b|\bUNIQUEIDENTIFIER\b|\bDATETIME2\b|^\s*GO\s*$/im.test(s)) return "mssql";
  if (/\bVARCHAR2\b|\bNUMBER\s*\(|\bSYS_GUID\b|\bCLOB\b|\bNVARCHAR2\b/i.test(s)) return "oracle";
  if (/\bTIMESTAMP_NTZ\b|\bVARIANT\b|\bTIMESTAMP_LTZ\b|\bAUTOINCREMENT\s+START\b/i.test(s)) return "snowflake";
  if (/\bINT64\b|\bFLOAT64\b|\bSTRING\b\s*(?:,|\)|OPTIONS)|\bNOT ENFORCED\b|\bBYTES\b/i.test(s)) return "bigquery";
  if (/\bDISTKEY\b|\bSORTKEY\b|\bDISTSTYLE\b|\bENCODE\b/i.test(s)) return "redshift";
  if (/\bUSING\s+DELTA\b|\bTBLPROPERTIES\b/i.test(s)) return "databricks";
  if (/\bAUTOINCREMENT\b/i.test(s) && /\bINTEGER\s+PRIMARY\s+KEY\b/i.test(s)) return "sqlite";
  if (/::|\bSERIAL\b|\bBIGSERIAL\b|\bCREATE\s+EXTENSION\b|\bTIMESTAMPTZ\b|\bJSONB\b|\bbytea\b|\bnextval\(/i.test(s)) return "postgres";
  return undefined;
}

export { tableKey };
