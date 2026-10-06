/**
 * DBML parser (dbdiagram.io compatible).
 *
 * Supports: Project, Table (+ schema, alias, settings), columns (pk, not null, unique, increment,
 * default, note, check, ref, dep), indexes, checks, Ref (short / long / inline, composite, optional `?`,
 * delete/update/color), Enum, TablePartial injection, TableGroup, sticky Note, Records (data sample),
 * DiagramView and Dep (data lineage).
 *
 * The parser recovers per top-level statement, so one typo does not throw away the whole diagram:
 * `parseDbml` always returns whatever it could read plus a list of diagnostics.
 */
import {
  DepEndpoint,
  DepModel,
  DiagramModel,
  DiagramViewModel,
  DefaultValue,
  EnumModel,
  IndexModel,
  RecordValue,
  RecordsModel,
  RefEndpoint,
  RefModel,
  RefType,
  ReferentialAction,
  TableGroupModel,
  TableModel,
  ColumnModel,
  CheckModel,
  emptyModel,
  tableKey,
  slugify,
  DEFAULT_VIEW_ID,
} from "../model/types";

// ───────────────────────────── tokenizer ─────────────────────────────

type TokKind = "ident" | "quoted" | "number" | "string" | "mstring" | "expr" | "color" | "punct" | "op" | "eof";

interface Tok {
  kind: TokKind;
  value: string;
  start: number;
  end: number;
  line: number;
  col: number;
  nlBefore: boolean;
}

export interface DbmlDiagnostic {
  message: string;
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
  severity: "error" | "warning";
}

class DbmlError extends Error {
  constructor(message: string, public tok: Tok) {
    super(message);
  }
}

const isIdentStart = (c: string) => /[A-Za-z_-￿]/.test(c);
const isIdentChar = (c: string) => /[A-Za-z0-9_$-￿]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

function tokenize(src: string): { toks: Tok[]; diagnostics: DbmlDiagnostic[] } {
  const toks: Tok[] = [];
  const diagnostics: DbmlDiagnostic[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let nl = true;

  const push = (kind: TokKind, value: string, start: number, end: number, l: number, c: number) => {
    toks.push({ kind, value, start, end, line: l, col: c, nlBefore: nl });
    nl = false;
  };

  const newline = (at: number) => {
    line++;
    lineStart = at + 1;
    nl = true;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === "\n") {
      newline(i);
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "﻿") {
      i++;
      continue;
    }

    // comments
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const startLine = line;
      const startCol = i - lineStart + 1;
      i += 2;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "*" && src[i + 1] === "/") {
          i += 2;
          closed = true;
          break;
        }
        if (src[i] === "\n") newline(i);
        i++;
      }
      if (!closed) {
        diagnostics.push({ message: "Unterminated block comment", line: startLine, col: startCol, severity: "error" });
      }
      continue;
    }

    const start = i;
    const col = i - lineStart + 1;
    const startLine = line;

    // triple-quoted multi-line string
    if (ch === "'" && src.startsWith("'''", i)) {
      i += 3;
      let out = "";
      let closed = false;
      while (i < src.length) {
        if (src.startsWith("'''", i)) {
          i += 3;
          closed = true;
          break;
        }
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1];
          if (n === "'" || n === "\\") {
            out += n;
            i += 2;
            continue;
          }
        }
        if (src[i] === "\n") newline(i);
        out += src[i];
        i++;
      }
      if (!closed) diagnostics.push({ message: "Unterminated multi-line string", line: startLine, col, severity: "error" });
      push("mstring", dedentNote(out), start, i, startLine, col);
      continue;
    }

    if (ch === "'") {
      i++;
      let out = "";
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\" && i + 1 < src.length) {
          const n = src[i + 1];
          if (n === "'" || n === "\\") {
            out += n;
            i += 2;
            continue;
          }
          if (n === "n") {
            out += "\n";
            i += 2;
            continue;
          }
          out += c;
          i++;
          continue;
        }
        if (c === "'") {
          if (src[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        if (c === "\n") break;
        out += c;
        i++;
      }
      if (!closed) diagnostics.push({ message: "Unterminated string", line: startLine, col, severity: "error" });
      push("string", out, start, i, startLine, col);
      continue;
    }

    if (ch === '"') {
      i++;
      let out = "";
      let closed = false;
      while (i < src.length) {
        const c = src[i];
        if (c === "\\" && src[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          closed = true;
          break;
        }
        if (c === "\n") break;
        out += c;
        i++;
      }
      if (!closed) diagnostics.push({ message: "Unterminated quoted identifier", line: startLine, col, severity: "error" });
      push("quoted", out, start, i, startLine, col);
      continue;
    }

    if (ch === "`") {
      i++;
      let out = "";
      let closed = false;
      while (i < src.length) {
        if (src[i] === "`") {
          i++;
          closed = true;
          break;
        }
        if (src[i] === "\n") newline(i);
        out += src[i];
        i++;
      }
      if (!closed) diagnostics.push({ message: "Unterminated expression (missing closing backtick)", line: startLine, col, severity: "error" });
      push("expr", out, start, i, startLine, col);
      continue;
    }

    if (ch === "#") {
      const m = /^#[0-9a-fA-F]{3,8}/.exec(src.slice(i, i + 9));
      if (m) {
        i += m[0].length;
        push("color", m[0], start, i, startLine, col);
        continue;
      }
      i++;
      push("punct", "#", start, i, startLine, col);
      continue;
    }

    if (isDigit(ch)) {
      const m = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
      const numLen = m ? m[0].length : 1;
      const next = src[i + numLen] || "";
      if (m && !isIdentStart(next) && !isDigit(next)) {
        i += numLen;
        push("number", m[0], start, i, startLine, col);
        continue;
      }
      // identifier that starts with a digit (e.g. 2fa_enabled)
      while (i < src.length && isIdentChar(src[i])) i++;
      push("ident", src.slice(start, i), start, i, startLine, col);
      continue;
    }

    if (isIdentStart(ch)) {
      while (i < src.length && isIdentChar(src[i])) i++;
      push("ident", src.slice(start, i), start, i, startLine, col);
      continue;
    }

    if (ch === "<" || ch === ">" || ch === "-" || ch === "?") {
      while (i < src.length && (src[i] === "<" || src[i] === ">" || src[i] === "-" || src[i] === "?")) i++;
      push("op", src.slice(start, i), start, i, startLine, col);
      continue;
    }

    if ("{}[](),:.~*;=+/%!|&^@$\\".includes(ch)) {
      i++;
      push("punct", ch, start, i, startLine, col);
      continue;
    }

    diagnostics.push({ message: `Unexpected character '${ch}'`, line: startLine, col, severity: "error" });
    i++;
  }

  push("eof", "", src.length, src.length, line, src.length - lineStart + 1);
  return { toks, diagnostics };
}

/** Removes the common leading indentation of a multi-line note (keeps markdown lists intact). */
function dedentNote(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

// ───────────────────────────── parser ─────────────────────────────

const TOP_KEYWORDS = new Set([
  "project",
  "table",
  "tablepartial",
  "enum",
  "ref",
  "tablegroup",
  "note",
  "diagramview",
  "dep",
  "records",
]);

interface SettingItem {
  key: string; // lower-cased key or flag words ("pk", "not null", "default", ...)
  hasValue: boolean;
  values: Tok[];
  keyTok: Tok;
}

interface EndpointParts {
  parts: string[]; // schema?, table, column?
  columns?: string[]; // composite
}

interface PendingRef {
  op: string;
  endpoint: EndpointParts;
  loc: Tok;
}

interface PendingDep {
  arrow: string; // "<-" or "->"
  endpoint: EndpointParts;
}

type BodyItem =
  | { kind: "column"; column: ColumnModel; refs: PendingRef[]; deps: PendingDep[] }
  | { kind: "index"; index: IndexModel }
  | { kind: "check"; check: CheckModel }
  | { kind: "note"; text: string }
  | { kind: "records"; records: RecordsModel }
  | { kind: "inject"; name: string; tok: Tok };

interface PartialDef {
  name: string;
  settings: SettingItem[];
  items: BodyItem[];
}

class Parser {
  private i = 0;
  readonly diagnostics: DbmlDiagnostic[] = [];
  private partials = new Map<string, PartialDef>();
  private model: DiagramModel = emptyModel();
  private pendingRefs: { table: TableModel; column: ColumnModel; pending: PendingRef }[] = [];
  private recordsTop: { tableParts: string[]; records: RecordsModel; tok: Tok }[] = [];
  private groupsRaw: { group: TableGroupModel; members: string[][] }[] = [];
  private viewsRaw: DiagramViewModel[] = [];
  private depsRaw: { dep: DepModel; from: EndpointParts; to: EndpointParts }[] = [];

  constructor(private toks: Tok[], private src: string) {}

  private get tok(): Tok {
    return this.toks[this.i];
  }
  private peek(n = 1): Tok {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)];
  }
  private next(): Tok {
    const t = this.toks[this.i];
    if (t.kind !== "eof") this.i++;
    return t;
  }
  /** Not a plain `kind === "eof"` comparison so TypeScript does not narrow `this.tok` between checks. */
  private atEof(): boolean {
    return this.tok.kind === "eof";
  }
  private isPunct(v: string, t: Tok = this.tok) {
    return t.kind === "punct" && t.value === v;
  }
  private isWord(v: string, t: Tok = this.tok) {
    return t.kind === "ident" && t.value.toLowerCase() === v;
  }
  private fail(msg: string, t: Tok = this.tok): never {
    throw new DbmlError(msg, t);
  }
  private expectPunct(v: string): Tok {
    if (!this.isPunct(v)) this.fail(`Expected '${v}' but found ${describe(this.tok)}`);
    return this.next();
  }
  private acceptPunct(v: string): boolean {
    if (this.isPunct(v)) {
      this.i++;
      return true;
    }
    return false;
  }

  parse(): DiagramModel {
    while (this.tok.kind !== "eof") {
      const start = this.i;
      try {
        this.parseTopLevel();
      } catch (e) {
        if (e instanceof DbmlError) {
          this.diagnostics.push({
            message: e.message,
            line: e.tok.line,
            col: e.tok.col,
            endLine: e.tok.line,
            endCol: e.tok.col + Math.max(1, e.tok.end - e.tok.start),
            severity: "error",
          });
          this.recover(start);
        } else {
          throw e;
        }
      }
      if (this.i === start) this.i++; // guarantee progress
    }
    this.resolve();
    return this.model;
  }

  /** Skip to the end of the broken statement so later statements still parse. */
  private recover(startIdx: number) {
    let depth = 0;
    let j = startIdx;
    let seenBrace = false;
    while (j < this.toks.length && this.toks[j].kind !== "eof") {
      const t = this.toks[j];
      if (t.kind === "punct" && t.value === "{") {
        depth++;
        seenBrace = true;
      } else if (t.kind === "punct" && t.value === "}") {
        depth--;
        if (depth <= 0) {
          this.i = j + 1;
          return;
        }
      }
      j++;
      const n = this.toks[j];
      if (n && j > startIdx + 1 && depth <= 0 && !seenBrace && n.nlBefore && n.kind === "ident" && TOP_KEYWORDS.has(n.value.toLowerCase())) {
        this.i = j;
        return;
      }
    }
    this.i = Math.max(j, startIdx + 1);
  }

  // ── top level ──

  private parseTopLevel() {
    const t = this.tok;
    if (t.kind !== "ident") this.fail(`Unexpected ${describe(t)}`);
    switch (t.value.toLowerCase()) {
      case "project":
        return this.parseProject();
      case "table":
        return this.parseTable(false);
      case "tablepartial":
        return this.parseTable(true);
      case "enum":
        return this.parseEnum();
      case "ref":
        return this.parseRefStatement();
      case "tablegroup":
        return this.parseTableGroup();
      case "note":
        return this.parseStickyNote();
      case "diagramview":
        return this.parseDiagramView();
      case "dep":
        return this.parseDepStatement();
      case "records":
        return this.parseTopRecords();
      default:
        this.fail(`Unknown keyword '${t.value}'. Expected Table, Ref, Enum, TableGroup, Note, Project, DiagramView, Dep or Records`);
    }
  }

  // ── helpers ──

  private name(): Tok {
    const t = this.tok;
    if (t.kind === "ident" || t.kind === "quoted") return this.next();
    this.fail(`Expected a name but found ${describe(t)}`);
  }

  /** [schema.]name → { schema, name } */
  private qualifiedName(): { schema?: string; name: string; tok: Tok } {
    const first = this.name();
    if (this.isPunct(".") && (this.peek().kind === "ident" || this.peek().kind === "quoted")) {
      this.next();
      const second = this.name();
      return { schema: first.value, name: second.value, tok: first };
    }
    return { name: first.value, tok: first };
  }

  private stringValue(): string {
    const t = this.tok;
    if (t.kind === "string" || t.kind === "mstring") {
      this.next();
      return t.value;
    }
    this.fail(`Expected a string but found ${describe(t)}`);
  }

  private parseSettings(): SettingItem[] {
    this.expectPunct("[");
    const items: SettingItem[] = [];
    while (!this.isPunct("]")) {
      if (this.tok.kind === "eof") this.fail("Unterminated settings list — expected ']'");
      if (this.isPunct(",")) {
        this.next();
        continue;
      }
      const startTok = this.tok;
      const collected: Tok[] = [];
      let parenDepth = 0;
      while (!this.atEof()) {
        if (parenDepth === 0 && (this.isPunct(",") || this.isPunct("]"))) break;
        if (this.isPunct("(")) parenDepth++;
        if (this.isPunct(")")) parenDepth = Math.max(0, parenDepth - 1);
        collected.push(this.next());
      }
      if (collected.length === 0) continue;
      const colonIdx = collected.findIndex((t) => t.kind === "punct" && t.value === ":");
      if (colonIdx > 0 && collected.slice(0, colonIdx).every((t) => t.kind === "ident" || t.kind === "quoted")) {
        const key = collected
          .slice(0, colonIdx)
          .map((t) => t.value)
          .join(" ")
          .toLowerCase();
        items.push({ key, hasValue: true, values: collected.slice(colonIdx + 1), keyTok: startTok });
      } else {
        const words = collected.map((t) => t.value.toLowerCase()).join(" ");
        items.push({ key: words, hasValue: false, values: [], keyTok: startTok });
      }
    }
    this.expectPunct("]");
    return items;
  }

  private settingText(item: SettingItem): string {
    return item.values
      .map((t) => t.value)
      .join(" ")
      .trim();
  }

  private settingDefault(item: SettingItem): DefaultValue | undefined {
    const vs = item.values;
    if (vs.length === 0) return undefined;
    let neg = false;
    let idx = 0;
    if (vs[0].kind === "op" && vs[0].value === "-" && vs[1]?.kind === "number") {
      neg = true;
      idx = 1;
    }
    const t = vs[idx];
    switch (t.kind) {
      case "string":
      case "mstring":
        return { kind: "string", value: t.value };
      case "number":
        return { kind: "number", value: (neg ? "-" : "") + t.value };
      case "expr":
        return { kind: "expression", value: t.value };
      case "ident": {
        const l = t.value.toLowerCase();
        if (l === "true" || l === "false") return { kind: "boolean", value: l };
        if (l === "null") return { kind: "null", value: "null" };
        return { kind: "expression", value: vs.map((x) => x.value).join(" ") };
      }
      default:
        return { kind: "expression", value: vs.map((x) => x.value).join(" ") };
    }
  }

  // ── Project ──

  private parseProject() {
    this.next();
    if (this.tok.kind === "ident" || this.tok.kind === "quoted") {
      this.model.project.name = this.next().value;
    }
    this.expectPunct("{");
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail("Unterminated Project block");
      const keyTok = this.next();
      if (this.isWord("note", keyTok) && this.isPunct("{")) {
        this.next();
        this.model.project.note = this.stringValue();
        this.expectPunct("}");
        continue;
      }
      this.expectPunct(":");
      const key = keyTok.value.toLowerCase();
      const v = this.tok;
      if (v.kind === "string" || v.kind === "mstring" || v.kind === "number" || v.kind === "ident" || v.kind === "quoted") {
        this.next();
        if (key === "database_type") this.model.project.databaseType = v.value;
        else if (key === "note") this.model.project.note = v.value;
        else (this.model.project.extra ||= {})[keyTok.value] = v.value;
      } else this.fail(`Unexpected ${describe(v)} in Project`);
    }
    this.expectPunct("}");
  }

  // ── Table / TablePartial ──

  private parseTable(isPartial: boolean) {
    const kwTok = this.next();
    let schema: string | undefined;
    let name: string;
    let nameTok: Tok;
    if (isPartial) {
      nameTok = this.name();
      name = nameTok.value;
    } else {
      const qn = this.qualifiedName();
      schema = qn.schema;
      name = qn.name;
      nameTok = qn.tok;
    }
    let alias: string | undefined;
    if (this.isWord("as")) {
      this.next();
      alias = this.name().value;
    }
    let settings: SettingItem[] = [];
    if (this.isPunct("[")) settings = this.parseSettings();
    this.expectPunct("{");
    const items: BodyItem[] = [];
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail(`Unterminated ${isPartial ? "TablePartial" : "Table"} '${name}' — expected '}'`, kwTok);
      items.push(...this.parseBodyItems());
    }
    this.expectPunct("}");

    if (isPartial) {
      this.partials.set(name.toLowerCase(), { name, settings, items });
      return;
    }

    const table: TableModel = {
      schema,
      name,
      alias,
      columns: [],
      indexes: [],
      checks: [],
      loc: { line: nameTok.line, col: nameTok.col },
    };
    const tableParts = [...(schema ? [schema] : []), name];
    for (const s of settings) {
      switch (s.key) {
        case "headercolor":
          table.headerColor = this.settingText(s).replace(/^["']|["']$/g, "");
          break;
        case "note":
          table.note = this.settingText(s);
          break;
        case "dep": {
          const d = this.readDepValue(s);
          if (d) this.addDep(d.arrow === "<-" ? d.endpoint : { parts: tableParts }, d.arrow === "<-" ? { parts: tableParts } : d.endpoint, {});
          break;
        }
        default:
          if (s.hasValue) (table.meta ||= {})[s.keyTok.value.toLowerCase()] = this.settingText(s);
      }
    }
    this.buildTableFromItems(table, items);
    this.model.tables.push(table);
  }

  private buildTableFromItems(table: TableModel, items: BodyItem[]) {
    type Entry = { source: number; column: ColumnModel; refs: PendingRef[]; deps: PendingDep[] };
    const entries: Entry[] = [];
    const seen = new Map<string, number>();
    const idxSeen = new Set<string>();
    let sourceCounter = 0;

    const addItems = (list: BodyItem[], source: number) => {
      for (const it of list) {
        switch (it.kind) {
          case "column": {
            const key = it.column.name.toLowerCase();
            const existing = seen.get(key);
            const entry: Entry = { source, column: it.column, refs: it.refs, deps: it.deps };
            if (existing !== undefined) {
              if (entries[existing].source === 0 && source !== 0) break; // local definition wins over partials
              entries[existing] = entry;
            } else {
              seen.set(key, entries.length);
              entries.push(entry);
            }
            break;
          }
          case "index": {
            const sig = `${it.index.columns.join("|")}:${it.index.name || ""}:${it.index.unique ? "u" : ""}${it.index.pk ? "p" : ""}`;
            if (!idxSeen.has(sig)) {
              idxSeen.add(sig);
              table.indexes.push(it.index);
            }
            break;
          }
          case "check":
            table.checks.push(it.check);
            break;
          case "note":
            if (source === 0 || !table.note) table.note = it.text;
            break;
          case "records":
            table.records = it.records;
            break;
          case "inject": {
            const p = this.partials.get(it.name.toLowerCase());
            if (!p) {
              this.diagnostics.push({ message: `TablePartial '${it.name}' is not defined`, line: it.tok.line, col: it.tok.col, severity: "error" });
              break;
            }
            sourceCounter++;
            for (const s of p.settings) {
              if (s.key === "headercolor" && !table.headerColor) table.headerColor = this.settingText(s);
              else if (s.key === "note" && !table.note) table.note = this.settingText(s);
            }
            addItems(p.items, sourceCounter);
            break;
          }
        }
      }
    };
    addItems(items, 0);

    for (const e of entries) {
      table.columns.push(e.column);
      for (const r of e.refs) this.pendingRefs.push({ table, column: e.column, pending: r });
      const thisEp: EndpointParts = { parts: [...(table.schema ? [table.schema] : []), table.name, e.column.name] };
      for (const d of e.deps) {
        this.addDep(d.arrow === "<-" ? d.endpoint : thisEp, d.arrow === "<-" ? thisEp : d.endpoint, {});
      }
    }
  }

  private addDep(from: EndpointParts, to: EndpointParts, shared: { name?: string; note?: string; color?: string; custom?: Record<string, string> }, loc?: Tok) {
    const dep: DepModel = { name: shared.name, from: { table: "" }, to: { table: "" }, note: shared.note, color: shared.color, custom: shared.custom };
    if (loc) dep.loc = { line: loc.line, col: loc.col };
    this.depsRaw.push({ dep, from, to });
    this.model.deps.push(dep);
  }

  private parseBodyItems(): BodyItem[] {
    const t = this.tok;

    if (this.isPunct("~")) {
      this.next();
      const n = this.name();
      return [{ kind: "inject", name: n.value, tok: n }];
    }

    if (t.kind === "ident") {
      const lw = t.value.toLowerCase();
      const nx = this.peek();
      if (lw === "indexes" && this.isPunct("{", nx)) {
        this.next();
        this.next();
        return this.parseIndexesBlock();
      }
      if (lw === "checks" && this.isPunct("{", nx)) {
        this.next();
        this.next();
        return this.parseChecksBlock();
      }
      if (lw === "records" && (this.isPunct("{", nx) || this.isPunct("(", nx))) {
        this.next();
        let cols: string[] = [];
        if (this.isPunct("(")) cols = this.parseNameList();
        const raw = this.captureBraceBody();
        return [{ kind: "records", records: parseRecordRows(raw, cols) }];
      }
      if (lw === "note" && (this.isPunct(":", nx) || this.isPunct("{", nx))) {
        this.next();
        if (this.acceptPunct(":")) return [{ kind: "note", text: this.stringValue() }];
        this.next();
        const text = this.stringValue();
        this.expectPunct("}");
        return [{ kind: "note", text }];
      }
    }

    return [this.parseColumn()];
  }

  /** `(a, b, c)` → ["a","b","c"] */
  private parseNameList(): string[] {
    this.expectPunct("(");
    const names: string[] = [];
    while (!this.isPunct(")")) {
      if (this.tok.kind === "eof") this.fail("Unterminated list — expected ')'");
      if (this.acceptPunct(",")) continue;
      const t = this.tok;
      if (t.kind === "ident" || t.kind === "quoted" || t.kind === "string") {
        names.push(this.next().value);
      } else if (t.kind === "expr") {
        names.push("`" + this.next().value + "`");
      } else this.fail(`Unexpected ${describe(t)} in list`);
    }
    this.expectPunct(")");
    return names;
  }

  /** Captures the raw text of a `{ ... }` block (respecting strings) and advances past it. */
  private captureBraceBody(): string {
    const open = this.expectPunct("{");
    let depth = 1;
    const startOffset = open.end;
    while (this.tok.kind !== "eof") {
      const t = this.tok;
      if (t.kind === "punct" && t.value === "{") depth++;
      if (t.kind === "punct" && t.value === "}") {
        depth--;
        if (depth === 0) {
          const raw = this.src.slice(startOffset, t.start);
          this.next();
          return raw;
        }
      }
      this.next();
    }
    this.fail("Unterminated records block — expected '}'", open);
  }

  private parseIndexesBlock(): BodyItem[] {
    const list: BodyItem[] = [];
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail("Unterminated indexes block");
      let columns: string[];
      const t = this.tok;
      if (this.isPunct("(")) columns = this.parseNameList();
      else if (t.kind === "ident" || t.kind === "quoted") columns = [this.next().value];
      else if (t.kind === "expr") columns = ["`" + this.next().value + "`"];
      else this.fail(`Unexpected ${describe(t)} in indexes block`);
      const idx: IndexModel = { columns };
      if (this.isPunct("[")) {
        for (const s of this.parseSettings()) {
          switch (s.key) {
            case "pk":
            case "primary key":
              idx.pk = true;
              break;
            case "unique":
              idx.unique = true;
              break;
            case "name":
              idx.name = this.settingText(s);
              break;
            case "type":
              idx.type = this.settingText(s).toLowerCase();
              break;
            case "note":
              idx.note = this.settingText(s);
              break;
          }
        }
      }
      list.push({ kind: "index", index: idx });
    }
    this.expectPunct("}");
    return list;
  }

  private parseChecksBlock(): BodyItem[] {
    const list: BodyItem[] = [];
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail("Unterminated checks block");
      const t = this.tok;
      if (t.kind !== "expr") this.fail(`Expected a backtick expression but found ${describe(t)}`);
      this.next();
      const chk: CheckModel = { expression: t.value };
      if (this.isPunct("[")) {
        for (const s of this.parseSettings()) if (s.key === "name") chk.name = this.settingText(s);
      }
      list.push({ kind: "check", check: chk });
    }
    this.expectPunct("}");
    return list;
  }

  private parseColumn(): BodyItem {
    const nameTok = this.name();
    const type = this.parseType();
    const col: ColumnModel = { name: nameTok.value, type, loc: { line: nameTok.line, col: nameTok.col } };
    const refs: PendingRef[] = [];
    const deps: PendingDep[] = [];
    if (this.isPunct("[")) {
      for (const s of this.parseSettings()) {
        switch (s.key) {
          case "pk":
          case "primary key":
          case "primary":
            col.pk = true;
            break;
          case "null":
            col.notNull = false;
            break;
          case "not null":
            col.notNull = true;
            break;
          case "unique":
            col.unique = true;
            break;
          case "increment":
          case "auto_increment":
          case "autoincrement":
            col.increment = true;
            break;
          case "default": {
            const d = this.settingDefault(s);
            if (d) col.default = d;
            break;
          }
          case "note":
            col.note = this.settingText(s);
            break;
          case "check":
            (col.checks ||= []).push(this.settingText(s));
            break;
          case "ref": {
            const r = this.readRefValue(s);
            if (r) refs.push({ ...r, loc: s.keyTok });
            break;
          }
          case "dep": {
            const d = this.readDepValue(s);
            if (d) deps.push(d);
            break;
          }
          default:
            if (s.hasValue) (col.meta ||= {})[s.keyTok.value] = this.settingText(s);
            else this.diagnostics.push({ message: `Unknown column setting '${s.key}'`, line: s.keyTok.line, col: s.keyTok.col, severity: "warning" });
        }
      }
    }
    return { kind: "column", column: col, refs, deps };
  }

  /**
   * Words that legitimately continue a type on the same line. Anything else starts the next column, so
   * `Table t { id int name varchar }` still parses as two columns instead of one garbled type.
   */
  private typeContinuation(): string {
    const CONT = new Set(["precision", "varying", "unsigned", "signed", "zerofill", "with", "without", "zone", "local"]);
    let out = "";
    let prev = "";
    while (this.tok.kind === "ident" && !this.tok.nlBefore) {
      const w = this.tok.value.toLowerCase();
      const ok = CONT.has(w) || (w === "time" && (prev === "with" || prev === "without" || prev === "local"));
      if (!ok) break;
      out += " " + this.next().value;
      prev = w;
    }
    return out;
  }

  private parseType(): string {
    const t = this.tok;
    if (t.kind !== "ident" && t.kind !== "quoted") this.fail(`Expected a column type but found ${describe(t)}`);
    const first = this.next();
    let out = first.value;
    // schema-qualified enum / type
    while (this.isPunct(".") && (this.peek().kind === "ident" || this.peek().kind === "quoted")) {
      this.next();
      out += "." + this.next().value;
    }
    // multi-word types on the same line: `double precision`, `character varying`, `timestamp with time zone`
    out += this.typeContinuation();
    if (this.isPunct("(")) {
      const open = this.next();
      let depth = 1;
      let args = "";
      while (this.tok.kind !== "eof") {
        const c = this.tok;
        if (c.kind === "punct" && c.value === "(") depth++;
        if (c.kind === "punct" && c.value === ")") {
          depth--;
          if (depth === 0) break;
        }
        args += c.kind === "string" ? `'${c.value}'` : c.kind === "quoted" ? `"${c.value}"` : c.value;
        this.next();
      }
      if (!this.isPunct(")")) this.fail("Unterminated type arguments — expected ')'", open);
      this.next();
      out += `(${args})`;
      out += this.typeContinuation(); // `varchar(10) unsigned`, `timestamp(3) with time zone`
    }
    while (this.isPunct("[") && this.isPunct("]", this.peek())) {
      this.next();
      this.next();
      out += "[]";
    }
    return out;
  }

  // ── endpoints / refs ──

  private parseEndpoint(): EndpointParts {
    const parts: string[] = [];
    const first = this.tok;
    if (first.kind !== "ident" && first.kind !== "quoted") this.fail(`Expected a table or column reference but found ${describe(first)}`);
    parts.push(this.next().value);
    let columns: string[] | undefined;
    while (this.isPunct(".")) {
      this.next();
      if (this.isPunct("(")) {
        columns = this.parseNameList();
        break;
      }
      const t = this.tok;
      if (t.kind !== "ident" && t.kind !== "quoted") this.fail(`Expected a name after '.' but found ${describe(t)}`);
      parts.push(this.next().value);
    }
    return { parts, columns };
  }

  private readEndpointFromTokens(vals: Tok[]): EndpointParts | undefined {
    const parts: string[] = [];
    let columns: string[] | undefined;
    let i = 0;
    while (i < vals.length) {
      const t = vals[i];
      if (t.kind === "ident" || t.kind === "quoted") {
        parts.push(t.value);
        i++;
        if (vals[i]?.kind === "punct" && vals[i].value === ".") {
          i++;
          if (vals[i]?.kind === "punct" && vals[i].value === "(") {
            columns = [];
            i++;
            while (i < vals.length && !(vals[i].kind === "punct" && vals[i].value === ")")) {
              if (!(vals[i].kind === "punct" && vals[i].value === ",")) columns.push(vals[i].value);
              i++;
            }
            i++;
          }
        }
        continue;
      }
      i++;
    }
    return parts.length ? { parts, columns } : undefined;
  }

  private readRefValue(s: SettingItem): { op: string; endpoint: EndpointParts } | undefined {
    const vs = s.values;
    if (!vs.length || vs[0].kind !== "op") {
      this.diagnostics.push({ message: "Inline ref needs a relationship operator, e.g. [ref: > users.id]", line: s.keyTok.line, col: s.keyTok.col, severity: "error" });
      return undefined;
    }
    const ep = this.readEndpointFromTokens(vs.slice(1));
    if (!ep) return undefined;
    return { op: vs[0].value, endpoint: ep };
  }

  private readDepValue(s: SettingItem): { arrow: string; endpoint: EndpointParts } | undefined {
    const vs = s.values;
    if (!vs.length || vs[0].kind !== "op") return undefined;
    const ep = this.readEndpointFromTokens(vs.slice(1));
    if (!ep) return undefined;
    return { arrow: vs[0].value, endpoint: ep };
  }

  private parseRefStatement() {
    const kw = this.next();
    let refName: string | undefined;
    if (this.tok.kind === "ident" || this.tok.kind === "quoted") refName = this.next().value;
    const readOne = () => {
      const left = this.parseEndpoint();
      const opTok = this.tok;
      if (opTok.kind !== "op") this.fail(`Expected a relationship operator (<, >, -, <>) but found ${describe(opTok)}`);
      this.next();
      const right = this.parseEndpoint();
      let settings: SettingItem[] = [];
      if (this.isPunct("[")) settings = this.parseSettings();
      return { left, op: opTok.value, right, settings, opTok };
    };
    const emit = (r: ReturnType<typeof readOne>) => {
      const built = this.buildRef(refName, r.left, r.op, r.right, r.settings, r.opTok);
      if (built) this.model.refs.push(built);
    };
    if (this.acceptPunct(":")) {
      emit(readOne());
      return;
    }
    if (this.isPunct("{")) {
      this.next();
      while (!this.isPunct("}")) {
        if (this.tok.kind === "eof") this.fail("Unterminated Ref block — expected '}'", kw);
        emit(readOne());
      }
      this.next();
      return;
    }
    this.fail("Expected ':' or '{' after Ref");
  }

  private buildRef(name: string | undefined, left: EndpointParts, op: string, right: EndpointParts, settings: SettingItem[], opTok: Tok): RefModel | undefined {
    const parsedOp = parseOperator(op);
    if (!parsedOp) {
      this.diagnostics.push({ message: `Invalid relationship operator '${op}'`, line: opTok.line, col: opTok.col, severity: "error" });
      return undefined;
    }
    const ref: RefModel = {
      name,
      from: this.toEndpoint(left),
      to: this.toEndpoint(right),
      type: parsedOp.type,
      fromOptional: parsedOp.leftOptional || undefined,
      toOptional: parsedOp.rightOptional || undefined,
      loc: { line: opTok.line, col: opTok.col },
    };
    for (const s of settings) {
      if (s.key === "delete") ref.onDelete = normalizeAction(this.settingText(s));
      else if (s.key === "update") ref.onUpdate = normalizeAction(this.settingText(s));
      else if (s.key === "color") ref.color = this.settingText(s);
    }
    return ref;
  }

  private toEndpoint(e: EndpointParts): RefEndpoint {
    if (e.columns) {
      const tp = e.parts;
      return tp.length >= 2 ? { schema: tp[tp.length - 2], table: tp[tp.length - 1], columns: e.columns } : { table: tp[0], columns: e.columns };
    }
    const p = e.parts;
    if (p.length >= 3) return { schema: p[p.length - 3], table: p[p.length - 2], columns: [p[p.length - 1]] };
    if (p.length === 2) return { table: p[0], columns: [p[1]] };
    return { table: p[0], columns: [] };
  }

  // ── Enum ──

  private parseEnum() {
    const kw = this.next();
    const qn = this.qualifiedName();
    this.expectPunct("{");
    const en: EnumModel = { schema: qn.schema, name: qn.name, values: [] };
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail(`Unterminated enum '${qn.name}'`, kw);
      const t = this.tok;
      if (this.isWord("note", t) && (this.isPunct(":", this.peek()) || this.isPunct("{", this.peek()))) {
        this.next();
        if (this.acceptPunct(":")) en.note = this.stringValue();
        else {
          this.next();
          en.note = this.stringValue();
          this.expectPunct("}");
        }
        continue;
      }
      if (t.kind !== "ident" && t.kind !== "quoted" && t.kind !== "string" && t.kind !== "number") this.fail(`Unexpected ${describe(t)} in enum`);
      this.next();
      let note: string | undefined;
      if (this.isPunct("[")) {
        for (const s of this.parseSettings()) if (s.key === "note") note = this.settingText(s);
      }
      en.values.push(note ? { name: t.value, note } : { name: t.value });
      this.acceptPunct(","); // same leniency as TableGroup members — real DBML uses newlines, but a comma is a harmless slip to allow
    }
    this.expectPunct("}");
    this.model.enums.push(en);
  }

  // ── TableGroup ──

  private parseTableGroup() {
    const kw = this.next();
    const nameTok = this.name();
    const group: TableGroupModel = { name: nameTok.value, tables: [], loc: { line: nameTok.line, col: nameTok.col } };
    if (this.isPunct("[")) {
      for (const s of this.parseSettings()) {
        if (s.key === "color") group.color = this.settingText(s);
        else if (s.key === "note") group.note = this.settingText(s);
      }
    }
    this.expectPunct("{");
    const members: string[][] = [];
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail(`Unterminated TableGroup '${group.name}'`, kw);
      if (this.isWord("note") && (this.isPunct(":", this.peek()) || this.isPunct("{", this.peek()))) {
        this.next();
        if (this.acceptPunct(":")) group.note = this.stringValue();
        else {
          this.next();
          group.note = this.stringValue();
          this.expectPunct("}");
        }
        continue;
      }
      const parts: string[] = [this.name().value];
      if (this.isPunct(".")) {
        this.next();
        parts.push(this.name().value);
      }
      members.push(parts);
      this.acceptPunct(","); // real DBML separates members by newline, but a comma (an easy LLM/hand-typed slip) is harmless to allow
    }
    this.expectPunct("}");
    this.groupsRaw.push({ group, members });
    this.model.groups.push(group);
  }

  // ── sticky Note ──

  private parseStickyNote() {
    this.next();
    const nameTok = this.name();
    if (this.acceptPunct(":")) {
      this.model.notes.push({ name: nameTok.value, text: this.stringValue() });
      return;
    }
    this.expectPunct("{");
    const text = this.stringValue();
    this.expectPunct("}");
    this.model.notes.push({ name: nameTok.value, text });
  }

  // ── DiagramView ──

  private parseDiagramView() {
    const kw = this.next();
    const nameTok = this.name();
    this.expectPunct("{");
    const view: DiagramViewModel = {
      id: nameTok.value.toLowerCase() === "default" ? DEFAULT_VIEW_ID : slugify(nameTok.value) || `view_${this.viewsRaw.length + 1}`,
      name: nameTok.value,
      tables: [],
      groups: [],
      schemas: [],
    };
    let tablesAll = false;
    while (!this.isPunct("}")) {
      if (this.tok.kind === "eof") this.fail(`Unterminated DiagramView '${view.name}'`, kw);
      const sec = this.name();
      const lw = sec.value.toLowerCase();
      this.expectPunct("{");
      const items: string[] = [];
      while (!this.isPunct("}")) {
        if (this.atEof()) this.fail(`Unterminated ${sec.value} block`, sec);
        if (this.isPunct("*")) {
          this.next();
          items.push("*");
          continue;
        }
        let path = this.name().value;
        if (this.isPunct(".")) {
          this.next();
          path += "." + this.name().value;
        }
        items.push(path);
      }
      this.expectPunct("}");
      if (lw === "tables") {
        if (items.includes("*")) tablesAll = true;
        (view.tables as string[]).push(...items.filter((x) => x !== "*"));
      } else if (lw === "tablegroups") view.groups.push(...items.filter((x) => x !== "*"));
      else if (lw === "schemas") view.schemas.push(...items.filter((x) => x !== "*"));
      else if (lw === "notes") (view.notes ||= []).push(...items.filter((x) => x !== "*"));
      else this.diagnostics.push({ message: `Unknown DiagramView section '${sec.value}'`, line: sec.line, col: sec.col, severity: "warning" });
    }
    this.expectPunct("}");
    if (tablesAll) view.tables = "*";
    this.viewsRaw.push(view);
    this.model.views.push(view);
  }

  // ── Dep ──

  private parseDepStatement() {
    const kw = this.next();
    let depName: string | undefined;
    if (this.tok.kind === "ident" || this.tok.kind === "quoted") depName = this.next().value;
    const readEdge = () => {
      const a = this.parseEndpoint();
      const opTok = this.tok;
      if (opTok.kind !== "op" || (opTok.value !== "->" && opTok.value !== "<-")) {
        this.fail(`Expected '->' or '<-' in Dep but found ${describe(opTok)}`);
      }
      this.next();
      const b = this.parseEndpoint();
      return { a, b, arrow: opTok.value, opTok };
    };
    type Shared = { name?: string; note?: string; color?: string; custom?: Record<string, string> };
    const mk = (e: ReturnType<typeof readEdge>, shared: Shared) => {
      this.addDep(e.arrow === "->" ? e.a : e.b, e.arrow === "->" ? e.b : e.a, { ...shared, name: depName }, e.opTok);
    };
    if (this.acceptPunct(":")) {
      const e = readEdge();
      const shared: Shared = {};
      if (this.isPunct("[")) {
        for (const s of this.parseSettings()) {
          if (s.key === "note") shared.note = this.settingText(s);
          else if (s.key === "color") shared.color = this.settingText(s);
          else if (s.hasValue) (shared.custom ||= {})[s.keyTok.value] = this.settingText(s);
        }
      }
      mk(e, shared);
      return;
    }
    if (this.isPunct("{")) {
      this.next();
      const edges: ReturnType<typeof readEdge>[] = [];
      const shared: Shared = {};
      while (!this.isPunct("}")) {
        if (this.tok.kind === "eof") this.fail("Unterminated Dep block", kw);
        if ((this.tok.kind === "ident" || this.tok.kind === "quoted") && this.isPunct(":", this.peek())) {
          const key = this.next().value;
          this.next();
          const v = this.tok;
          if (v.kind === "string" || v.kind === "mstring" || v.kind === "color" || v.kind === "ident" || v.kind === "number" || v.kind === "quoted") {
            this.next();
            const lk = key.toLowerCase();
            if (lk === "note") shared.note = v.value;
            else if (lk === "color") shared.color = v.value;
            else (shared.custom ||= {})[key] = v.value;
          } else this.fail(`Unexpected ${describe(v)} in Dep block`);
          continue;
        }
        edges.push(readEdge());
      }
      this.next();
      for (const e of edges) mk(e, shared);
      return;
    }
    this.fail("Expected ':' or '{' after Dep");
  }

  // ── Records (top-level) ──

  private parseTopRecords() {
    const kw = this.next();
    const first = this.name();
    const tableParts = [first.value];
    while (this.isPunct(".")) {
      this.next();
      tableParts.push(this.name().value);
    }
    let cols: string[] = [];
    if (this.isPunct("(")) cols = this.parseNameList();
    const raw = this.captureBraceBody();
    this.recordsTop.push({ tableParts, records: parseRecordRows(raw, cols), tok: kw });
  }

  // ── resolution pass ──

  private findTable(schema: string | undefined, name: string): TableModel | undefined {
    const lname = name.toLowerCase();
    const cands = this.model.tables.filter((t) => t.name.toLowerCase() === lname || (t.alias && t.alias.toLowerCase() === lname));
    if (cands.length === 0) return undefined;
    if (schema) {
      const exact = cands.find((t) => (t.schema || "public").toLowerCase() === schema.toLowerCase());
      if (exact) return exact;
    }
    const pub = cands.find((t) => !t.schema || t.schema === "public");
    return pub || cands[0];
  }

  private resolveTableRef(parts: string[]): TableModel | undefined {
    if (parts.length >= 2) return this.findTable(parts[parts.length - 2], parts[parts.length - 1]) || this.findTable(undefined, parts[parts.length - 1]);
    return this.findTable(undefined, parts[0]);
  }

  private normalizeEndpoint(ep: RefEndpoint): RefEndpoint {
    const t = this.findTable(ep.schema, ep.table);
    if (!t) return ep;
    return { schema: t.schema, table: t.name, columns: ep.columns };
  }

  private resolve() {
    // inline refs (column settings)
    for (const pr of this.pendingRefs) {
      const opInfo = parseOperator(pr.pending.op);
      if (!opInfo) {
        this.diagnostics.push({ message: `Invalid relationship operator '${pr.pending.op}'`, line: pr.pending.loc.line, col: pr.pending.loc.col, severity: "error" });
        continue;
      }
      this.model.refs.push({
        from: { schema: pr.table.schema, table: pr.table.name, columns: [pr.column.name] },
        to: this.toEndpoint(pr.pending.endpoint),
        type: opInfo.type,
        fromOptional: opInfo.leftOptional || undefined,
        toOptional: opInfo.rightOptional || undefined,
        loc: { line: pr.pending.loc.line, col: pr.pending.loc.col },
      });
    }
    // alias → real table, missing schema → resolved schema
    for (const r of this.model.refs) {
      r.from = this.normalizeEndpoint(r.from);
      r.to = this.normalizeEndpoint(r.to);
    }
    // top-level records
    for (const rt of this.recordsTop) {
      const t = this.resolveTableRef(rt.tableParts);
      if (!t) {
        this.diagnostics.push({ message: `Records reference unknown table '${rt.tableParts.join(".")}'`, line: rt.tok.line, col: rt.tok.col, severity: "error" });
        continue;
      }
      const cols = rt.records.columns.length ? rt.records.columns : t.columns.map((c) => c.name);
      t.records = { columns: cols, rows: rt.records.rows };
    }
    // in-table records with implicit column list
    for (const t of this.model.tables) {
      if (t.records && t.records.columns.length === 0) t.records.columns = t.columns.map((c) => c.name);
    }
    // table groups
    for (const g of this.groupsRaw) {
      const keys: string[] = [];
      for (const parts of g.members) {
        const t = this.resolveTableRef(parts);
        if (t) keys.push(tableKey(t.schema, t.name));
        else {
          this.diagnostics.push({
            message: `TableGroup '${g.group.name}' references unknown table '${parts.join(".")}'`,
            line: g.group.loc?.line || 1,
            col: g.group.loc?.col || 1,
            severity: "warning",
          });
          keys.push(parts.join("."));
        }
      }
      g.group.tables = keys;
    }
    // views: resolve table keys
    for (const v of this.viewsRaw) {
      if (v.tables === "*") continue;
      v.tables = (v.tables as string[]).map((p) => {
        const t = this.resolveTableRef(p.split("."));
        return t ? tableKey(t.schema, t.name) : p;
      });
    }
    // lineage endpoints
    for (const d of this.depsRaw) {
      d.dep.from = this.toDepEndpoint(d.from);
      d.dep.to = this.toDepEndpoint(d.to);
    }
    // validate refs
    for (const r of this.model.refs) {
      for (const [side, ep] of [["from", r.from] as const, ["to", r.to] as const]) {
        const t = this.model.tables.find((x) => x.name === ep.table && (x.schema || "") === (ep.schema || ""));
        const shown = (ep.schema ? ep.schema + "." : "") + ep.table;
        if (!t) {
          this.diagnostics.push({ message: `Ref ${side} side references unknown table '${shown}'`, line: r.loc?.line || 1, col: r.loc?.col || 1, severity: "warning" });
          continue;
        }
        for (const c of ep.columns) {
          if (!t.columns.some((x) => x.name === c)) {
            this.diagnostics.push({ message: `Ref references unknown column '${t.name}.${c}'`, line: r.loc?.line || 1, col: r.loc?.col || 1, severity: "warning" });
          }
        }
      }
    }
  }

  private toDepEndpoint(e: EndpointParts): DepEndpoint {
    const p = e.parts;
    if (p.length >= 3) return { schema: p[p.length - 3], table: p[p.length - 2], column: p[p.length - 1] };
    if (p.length === 2) {
      // table.column  vs  schema.table
      const asColumn = this.findTable(undefined, p[0]);
      if (asColumn && asColumn.columns.some((c) => c.name === p[1])) return { schema: asColumn.schema, table: asColumn.name, column: p[1] };
      const asTable = this.findTable(p[0], p[1]);
      if (asTable) return { schema: asTable.schema, table: asTable.name };
      return { table: p[0], column: p[1] };
    }
    const t = this.findTable(undefined, p[0]);
    return t ? { schema: t.schema, table: t.name } : { table: p[0] };
  }
}

// ───────────────────────────── helpers ─────────────────────────────

function describe(t: Tok): string {
  if (t.kind === "eof") return "end of file";
  if (t.kind === "string") return `string '${t.value}'`;
  return `'${t.value}'`;
}

export function parseOperator(op: string): { type: RefType; leftOptional: boolean; rightOptional: boolean } | undefined {
  const m = /^(\?)?(<>|<|>|-)(\?)?$/.exec(op);
  if (!m) return undefined;
  const map: Record<string, RefType> = { "<": "one-to-many", ">": "many-to-one", "-": "one-to-one", "<>": "many-to-many" };
  return { type: map[m[2]], leftOptional: !!m[1], rightOptional: !!m[3] };
}

function normalizeAction(text: string): ReferentialAction | undefined {
  const t = text.toLowerCase().replace(/[_\s]+/g, " ").trim();
  if (t === "cascade" || t === "restrict" || t === "set null" || t === "set default" || t === "no action") return t;
  return undefined;
}

/** Parses the CSV-like body of a `records { ... }` block. */
export function parseRecordRows(raw: string, columns: string[]): RecordsModel {
  const rows: RecordValue[][] = [];
  let field = "";
  let inStr = false;
  let inExpr = false;
  let row: RecordValue[] = [];
  let hasContent = false;
  let quoted = false;

  const pushField = () => {
    let v: RecordValue;
    if (quoted) v = field;
    else {
      const t = field.trim();
      if (t === "" || /^null$/i.test(t)) v = null;
      else if (/^(true|false)$/i.test(t)) v = t.toLowerCase() === "true";
      else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) v = Number(t);
      else if (t.startsWith("`") && t.endsWith("`")) v = t;
      else if (t.includes(".")) v = t.slice(t.lastIndexOf(".") + 1); // Enum.value → value
      else v = t;
    }
    row.push(v);
    field = "";
    quoted = false;
  };
  const endRow = () => {
    if (row.length === 0 && field.trim() === "" && !quoted && !hasContent) return;
    pushField();
    rows.push(row);
    row = [];
    hasContent = false;
  };

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === "\\" && (raw[i + 1] === "'" || raw[i + 1] === "\\")) {
        field += raw[i + 1];
        i++;
      } else if (c === "'") {
        if (raw[i + 1] === "'") {
          field += "'";
          i++;
        } else inStr = false;
      } else field += c;
      continue;
    }
    if (inExpr) {
      field += c;
      if (c === "`") inExpr = false;
      continue;
    }
    if (c === "/" && raw[i + 1] === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      i--;
      continue;
    }
    if (c === "'") {
      inStr = true;
      quoted = true;
      field = ""; // drop whitespace that preceded the opening quote
      hasContent = true;
      continue;
    }
    if (c === "`") {
      inExpr = true;
      field += c;
      hasContent = true;
      continue;
    }
    if (c === ",") {
      pushField();
      hasContent = true; // a trailing comma implies another (empty) field
      continue;
    }
    if (c === "\n") {
      endRow();
      continue;
    }
    if (c === "\r") continue;
    if (quoted) continue; // ignore stray characters after a closing quote
    field += c;
    if (c.trim()) hasContent = true;
  }
  endRow();
  return { columns, rows };
}

// ───────────────────────────── public API ─────────────────────────────

export interface DbmlParseResult {
  model: DiagramModel;
  diagnostics: DbmlDiagnostic[];
  ok: boolean;
}

export function parseDbml(source: string): DbmlParseResult {
  const { toks, diagnostics: lexDiags } = tokenize(source);
  const p = new Parser(toks, source);
  let model: DiagramModel;
  try {
    model = p.parse();
  } catch (e: any) {
    model = emptyModel();
    p.diagnostics.push({ message: e?.message || "Failed to parse DBML", line: 1, col: 1, severity: "error" });
  }
  const diagnostics = [...lexDiags, ...p.diagnostics].sort((a, b) => a.line - b.line || a.col - b.col);
  return { model, diagnostics, ok: !diagnostics.some((d) => d.severity === "error") };
}
