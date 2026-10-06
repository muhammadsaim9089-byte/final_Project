/**
 * CSV / TSV → tables.
 *
 * One CSV block per table: an uploaded file (the table is named after the file) or, in pasted text, a block that starts
 * with a `-- table: <name>` line. The header row names the columns (normalised to snake_case); column types are inferred
 * from the values; an `id` column becomes the primary key; `<table>_id` columns become relationships to the other
 * imported tables; and the first rows are kept as the table's sample data (DBML Records), so the SQL playground and the
 * exports have real data to work with.
 */
import type { ColumnModel, DiagramModel, RecordValue, RefModel, TableModel } from "../model/types";
import { emptyModel } from "../model/types";

/** Rows kept as a table's sample data. */
export const CSV_SAMPLE_ROWS = 100;
/** Rows looked at to infer column types. */
const INFER_ROWS = 5000;
/** `-- table: customers` — starts a new table in pasted text. */
const MARKER = /^\s*--\s*table\s*:\s*(.*?)\s*$/i;
const DELIMITERS = [",", ";", "\t", "|"];

// ───────────────────────────── reading ─────────────────────────────

/** RFC 4180 CSV: quoted fields, `""` escapes, delimiters and line breaks inside quotes, CRLF / LF / CR line ends. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // byte-order mark from Excel
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") endRow();
    else if (ch === "\r") {
      endRow();
      if (src[i + 1] === "\n") i++;
    } else field += ch;
    i++;
  }
  if (field !== "" || row.length) endRow();
  return rows.filter((r) => r.length > 1 || r[0].trim() !== ""); // blank lines
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** The delimiter that splits the first lines into the same, largest number of fields. */
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() && !MARKER.test(l)).slice(0, 12);
  let best = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || !counts[0]) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Heuristic for auto-detect: at least two lines that the same delimiter splits consistently. */
export function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r\n|\n|\r/).find((l) => l.trim());
  if (first && MARKER.test(first)) return true;
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 12);
  if (lines.length < 2) return false;
  const d = detectDelimiter(text);
  const counts = lines.map((l) => countOutsideQuotes(l, d));
  return counts[0] >= 1 && counts.every((c) => c === counts[0]);
}

// ───────────────────────────── names ─────────────────────────────

/** "Customer Orders" → "customer_orders", "orderId" → "order_id", "Prénom" → "prenom". */
export function toIdentifier(raw: string, prefix = "col"): string {
  const s = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) return "";
  return /^\d/.test(s) ? `${prefix}_${s}` : s;
}

/** The table a CSV file becomes: its name without the extension. */
export function csvTableName(filename: string): string {
  return filename.replace(/^.*[\\/]/, "").replace(/\.(csv|tsv|txt)$/i, "");
}

function singular(word: string): string {
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/(ss|x|z|ch|sh)es$/.test(word) || /(s)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

// ───────────────────────────── types ─────────────────────────────

type Kind = "integer" | "bigint" | "decimal" | "double" | "boolean" | "date" | "timestamp" | "time" | "uuid" | "json" | "text";

// numbers with leading zeros ("00123", zip codes, phone parts) stay text
const INT = /^[+-]?(?:0|[1-9]\d*)$/;
const DEC = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)$/;
const SCI = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)[eE][+-]?\d+$/;
const BOOL = /^(?:true|false|yes|no)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const TIME = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT32 = 2147483647;

function isJson(v: string): boolean {
  if (!/^[[{]/.test(v)) return false;
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
}

/** The narrowest type every (non-empty) value fits, as a DesignDB column type. */
export function inferColumnType(values: string[]): { type: string; kind: Kind } {
  const vals = values.map((v) => v.trim()).filter((v) => v !== "");
  if (!vals.length) return { type: "varchar(255)", kind: "text" };
  const all = (re: RegExp) => vals.every((v) => re.test(v));
  if (all(BOOL)) return { type: "boolean", kind: "boolean" };
  if (all(INT)) return vals.some((v) => Math.abs(Number(v)) > INT32) ? { type: "bigint", kind: "bigint" } : { type: "integer", kind: "integer" };
  if (vals.every((v) => INT.test(v) || DEC.test(v))) {
    let scale = 0;
    let whole = 1;
    for (const v of vals) {
      const [w, f = ""] = v.replace(/^[+-]/, "").split(".");
      scale = Math.max(scale, f.length);
      whole = Math.max(whole, w.replace(/^0+(?=\d)/, "").length);
    }
    scale = Math.min(scale, 10);
    return { type: `decimal(${Math.min(38, Math.max(whole + scale, 10))},${scale})`, kind: "decimal" };
  }
  if (vals.every((v) => INT.test(v) || DEC.test(v) || SCI.test(v))) return { type: "double", kind: "double" };
  if (all(DATE)) return { type: "date", kind: "date" };
  if (vals.every((v) => DATE.test(v) || TIMESTAMP.test(v))) return { type: "timestamp", kind: "timestamp" };
  if (all(TIME)) return { type: "time", kind: "time" };
  if (all(UUID)) return { type: "uuid", kind: "uuid" };
  if (vals.every(isJson)) return { type: "json", kind: "json" };
  const longest = vals.reduce((n, v) => Math.max(n, v.length), 0);
  const size = [50, 100, 255].find((s) => longest <= s);
  return size ? { type: `varchar(${size})`, kind: "text" } : { type: "text", kind: "text" };
}

function recordValue(raw: string, kind: Kind): RecordValue {
  const v = raw.trim();
  if (v === "") return null;
  if (kind === "integer" || kind === "bigint") {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v;
  }
  if (kind === "decimal" || kind === "double") return Number(v);
  if (kind === "boolean") return /^(true|yes)$/i.test(v);
  return raw;
}

const intKind = (type: string) => /^(integer|bigint|smallint|int)\b/i.test(type);
const textKind = (type: string) => /^(varchar|text|char)\b/i.test(type);
const compatible = (a: string, b: string) => (intKind(a) && intKind(b)) || (textKind(a) && textKind(b)) || a.toLowerCase() === b.toLowerCase();

// ───────────────────────────── tables ─────────────────────────────

interface Block {
  name: string;
  text: string;
}

/** Splits pasted text on `-- table: <name>` lines; text before the first marker belongs to `defaultName`. */
function splitBlocks(text: string, defaultName: string): Block[] {
  const blocks: Block[] = [];
  let current: Block = { name: defaultName, text: "" };
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = MARKER.exec(line.replace(/\r$/, ""));
    if (m) {
      if (current.text.trim()) blocks.push(current);
      current = { name: m[1] || defaultName, text: "" };
    } else current.text += i < lines.length - 1 ? `${line}\n` : line;
  });
  if (current.text.trim()) blocks.push(current);
  return blocks;
}

export interface CsvImportResult {
  model: DiagramModel;
  warnings: string[];
}

export function parseCsvTables(text: string, opts: { defaultName?: string } = {}): CsvImportResult {
  const model = emptyModel();
  const warnings: string[] = [];
  const usedTables = new Set<string>();

  for (const block of splitBlocks(text, opts.defaultName || "imported_table")) {
    let name = toIdentifier(csvTableName(block.name), "t") || "imported_table";
    for (let k = 2; usedTables.has(name); k++) name = `${toIdentifier(csvTableName(block.name), "t") || "imported_table"}_${k}`;
    usedTables.add(name);

    const rows = parseCsv(block.text, detectDelimiter(block.text));
    if (!rows.length) continue;
    const [header, ...data] = rows;
    if (header.length > 1 && header.every((h) => DEC.test(h.trim()) || INT.test(h.trim()))) {
      warnings.push(`${name}: the first row looks like data — a CSV needs a header row with the column names.`);
    }

    // column names: snake_case, unique, never empty
    const names: string[] = [];
    header.forEach((h, i) => {
      let n = toIdentifier(h) || `column_${i + 1}`;
      for (let k = 2; names.includes(n); k++) n = `${toIdentifier(h) || `column_${i + 1}`}_${k}`;
      names.push(n);
    });

    let ragged = 0;
    const cells = data.map((r) => {
      if (r.length !== names.length) ragged++;
      return names.map((_, i) => r[i] ?? "");
    });
    if (ragged) warnings.push(`${name}: ${ragged} row${ragged === 1 ? " has" : "s have"} a different number of fields than the header (padded or trimmed).`);
    if (!cells.length) warnings.push(`${name}: no data rows — every column was imported as varchar(255).`);
    if (cells.length > INFER_ROWS) warnings.push(`${name}: types inferred from the first ${INFER_ROWS.toLocaleString("en-US")} of ${cells.length.toLocaleString("en-US")} rows.`);

    const sample = cells.slice(0, INFER_ROWS);
    const inferred = names.map((_, i) => inferColumnType(sample.map((r) => r[i])));
    const columns: ColumnModel[] = names.map((n, i) => ({ name: n, type: inferred[i].type }));

    // primary key: `id`, else `<table>_id`, when its values are present and unique
    const unique = (i: number) => {
      const seen = new Set<string>();
      for (const r of cells) {
        const v = r[i].trim();
        if (!v || seen.has(v)) return false;
        seen.add(v);
      }
      return cells.length > 0;
    };
    const pkName = ["id", `${singular(name)}_id`, `${name}_id`].find((c) => {
      const i = names.indexOf(c);
      return i >= 0 && unique(i);
    });
    if (pkName) {
      const col = columns[names.indexOf(pkName)];
      col.pk = true;
      col.notNull = true;
      if (intKind(col.type)) col.increment = true;
    } else if (cells.length) {
      warnings.push(`${name}: no id column with unique values — no primary key was set.`);
    }

    const table: TableModel = { name, columns, indexes: [], checks: [] };
    if (cells.length) {
      table.records = { columns: [...names], rows: cells.slice(0, CSV_SAMPLE_ROWS).map((r) => r.map((v, i) => recordValue(v, inferred[i].kind))) };
      if (cells.length > CSV_SAMPLE_ROWS) warnings.push(`${name}: kept the first ${CSV_SAMPLE_ROWS} of ${cells.length.toLocaleString("en-US")} rows as sample data.`);
    }
    model.tables.push(table);
  }

  // relationships: `customer_id` → customers.id when both were imported
  for (const t of model.tables) {
    for (const c of t.columns) {
      const m = /^(.+)_id$/.exec(c.name);
      if (!m || c.pk) continue;
      const base = m[1];
      const parent = model.tables.find((p) => p !== t && (p.name === base || singular(p.name) === base || singular(p.name) === singular(base)));
      const ppk = parent?.columns.find((x) => x.pk);
      if (!parent || !ppk || !compatible(c.type, ppk.type)) continue;
      const ref: RefModel = { from: { table: t.name, columns: [c.name] }, to: { table: parent.name, columns: [ppk.name] }, type: "many-to-one" };
      model.refs.push(ref);
    }
  }
  return { model, warnings };
}
