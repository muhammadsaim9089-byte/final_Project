"use client";

import React, { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Annotation, EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, toggleBlockComment } from "@codemirror/commands";
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap, foldService, foldAll, unfoldAll } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { setDiagnostics, lintGutter, Diagnostic } from "@codemirror/lint";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import type { DbmlDiagnostic } from "@/lib/dbml/parser";
import type { RevealTarget } from "./LayoutContext";

// ───────────────────────────── language ─────────────────────────────

const TOP = new Set(["table", "tablepartial", "ref", "enum", "tablegroup", "project", "note", "diagramview", "dep", "records", "indexes", "checks", "as", "tables", "tablegroups", "schemas", "notes"]);
const SETTINGS = new Set(["pk", "primary", "key", "null", "not", "unique", "increment", "default", "ref", "note", "headercolor", "color", "delete", "update", "name", "type", "cascade", "restrict", "set", "no", "action", "check", "dep", "database_type"]);
const TYPES = new Set([
  "int", "integer", "bigint", "smallint", "tinyint", "serial", "bigserial", "varchar", "char", "text", "boolean", "bool", "decimal", "numeric", "float", "double", "real",
  "date", "time", "timestamp", "timestamptz", "datetime", "uuid", "json", "jsonb", "blob", "bytea", "string", "number", "money", "binary", "varbinary",
]);
const NAME_AFTER = new Set(["table", "enum", "tablegroup", "tablepartial", "project", "diagramview"]);

interface LangState {
  block: boolean;
  triple: boolean;
  expectName: boolean;
}

const dbmlLanguage = StreamLanguage.define<LangState>({
  name: "dbml",
  startState: () => ({ block: false, triple: false, expectName: false }),
  languageData: {
    commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
  },
  token(stream, state) {
    if (state.block) {
      if (stream.match(/^.*?\*\//)) state.block = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (state.triple) {
      if (stream.match(/^.*?'''/)) state.triple = false;
      else stream.skipToEnd();
      return "string";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      const rest = stream.string.slice(stream.pos).trim();
      stream.skipToEnd();
      return /^#(end)?region/.test(rest) ? "meta" : "comment";
    }
    if (stream.match("/*")) {
      state.block = true;
      if (stream.match(/^.*?\*\//)) state.block = false;
      else stream.skipToEnd();
      return "comment";
    }
    if (stream.match("'''")) {
      state.triple = true;
      if (stream.match(/^.*?'''/)) state.triple = false;
      else stream.skipToEnd();
      return "string";
    }
    if (stream.match(/^'(?:[^'\\]|\\.|'')*'?/)) return "string";
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "variableName";
    if (stream.match(/^`[^`]*`?/)) return "string.special";
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return "atom";
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";
    if (stream.match(/^(<>|->|<-|\?[<>-]\??|[<>-]\??)/)) return "operator";
    if (stream.match(/^[{}()[\]]/)) return "bracket";
    if (stream.match(/^[~*:,.;]/)) return "punctuation";
    const m = stream.match(/^[A-Za-z_-￿][\w$-￿]*/) as RegExpMatchArray | null;
    if (m) {
      const w = m[0].toLowerCase();
      if (state.expectName) {
        state.expectName = false;
        return "className";
      }
      if (TOP.has(w)) {
        if (NAME_AFTER.has(w)) state.expectName = true;
        return "keyword";
      }
      if (w === "true" || w === "false") return "bool";
      if (w === "null") return "null";
      if (SETTINGS.has(w)) return "propertyName";
      if (TYPES.has(w)) return "typeName";
      return "variableName";
    }
    stream.next();
    return null;
  },
});

// Palette taken from dbdiagram.io's editor: neutral dark background, light-blue keywords, blue types and settings,
// orange strings, muted teal comments.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#7cc3ef" },
  { tag: t.className, color: "#e6e6e6" },
  { tag: t.typeName, color: "#569cd6" },
  { tag: t.propertyName, color: "#569cd6" },
  { tag: t.string, color: "#ce9178" },
  { tag: t.special(t.string), color: "#d7ba7d" },
  { tag: t.number, color: "#e6e6e6" },
  { tag: t.atom, color: "#d7ba7d" },
  { tag: t.bool, color: "#569cd6" },
  { tag: t.null, color: "#569cd6" },
  { tag: t.operator, color: "#e6e6e6" },
  { tag: t.comment, color: "#6f8f8c" },
  { tag: t.meta, color: "#6f8f8c", fontWeight: "700" },
  { tag: t.variableName, color: "#e6e6e6" },
  { tag: t.bracket, color: "#e6e6e6" },
  { tag: t.punctuation, color: "#e6e6e6" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#1e1e1e", color: "#e6e6e6", fontSize: "14px" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace", lineHeight: "1.7", overflow: "auto" },
    ".cm-content": { caretColor: "#aeafad", padding: "12px 0" },
    ".cm-gutters": { backgroundColor: "#1e1e1e", color: "#b4b4b4", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 20px", minWidth: "44px" },
    ".cm-foldGutter .cm-gutterElement": { color: "#8a8a8a", cursor: "pointer" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.035)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#ffffff" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "#aeafad" },
    ".cm-selectionBackground": { backgroundColor: "#3a3d41 !important" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "#264f78 !important" },
    ".cm-foldPlaceholder": { backgroundColor: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#c8c8c8", borderRadius: "4px", padding: "0 6px" },
    ".cm-tooltip": { backgroundColor: "#252526", border: "1px solid #3c3c3c", borderRadius: "6px", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "ui-monospace, monospace", fontSize: "12.5px" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#04395e", color: "#fff" },
    ".cm-completionDetail": { color: "rgba(255,255,255,0.4)", marginLeft: "8px", fontStyle: "normal" },
    ".cm-diagnostic": { fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #f87171", textUnderlineOffset: "3px" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #fbbf24", textUnderlineOffset: "3px" },
    ".cm-panels": { backgroundColor: "#252526", color: "#e6e6e6" },
    ".cm-searchMatch": { backgroundColor: "rgba(234,192,92,0.28)" },
    ".cm-matchingBracket": { backgroundColor: "rgba(255,255,255,0.1)", outline: "1px solid rgba(255,255,255,0.28)" },
    ".cm-placeholder": { color: "#6f8f8c" },
    ".cm-reveal-flash": { backgroundColor: "rgba(194,239,78,0.22)", transition: "background-color 1.2s" },
  },
  { dark: true }
);

// ── folding: `{ … }` blocks and `// #region … // #endregion` ──
const dbmlFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = line.text;
  if (/^\s*\/\/\s*#region\b/.test(text)) {
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      if (/^\s*\/\/\s*#endregion\b/.test(l.text)) return { from: line.to, to: state.doc.line(n - 1).to >= line.to ? state.doc.line(n - 1).to : line.to };
    }
    return null;
  }
  const stripped = text.replace(/\/\/.*$/, "").trimEnd();
  if (!stripped.endsWith("{")) return null;
  let depth = 0;
  for (let n = line.number; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    const s = (n === line.number ? stripped : l.text.replace(/\/\/.*$/, "")).replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/`[^`]*`/g, "``");
    for (const ch of s) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          if (n === line.number) return null;
          return { from: line.to, to: state.doc.line(n).from - 1 >= line.to ? state.doc.line(n).from - 1 : line.to };
        }
      }
    }
  }
  return null;
});

// ───────────────────────────── completions ─────────────────────────────

export interface EditorSchemaInfo {
  tables: { name: string; alias?: string; schema?: string; columns: string[] }[];
  enums: string[];
  types: string[];
  partials: string[];
}

function currentTable(doc: string, pos: number): string | null {
  const before = doc.slice(0, pos);
  const re = /(?:^|\n)\s*Table\s+(?:"?[\w ]+"?\.)?("?[\w ]+"?)(?:\s+as\s+\w+)?\s*(?:\[[^\]]*\])?\s*\{/gi;
  let m: RegExpExecArray | null;
  let last: { name: string; end: number } | null = null;
  while ((m = re.exec(before))) last = { name: m[1].replace(/"/g, ""), end: m.index + m[0].length };
  if (!last) return null;
  let depth = 1;
  for (let i = last.end; i < before.length; i++) {
    if (before[i] === "{") depth++;
    else if (before[i] === "}") depth--;
    if (depth === 0) return null;
  }
  return last.name;
}

function makeCompletionSource(getInfo: () => EditorSchemaInfo) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const info = getInfo();
    const word = ctx.matchBefore(/[\w.~"]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const beforeWord = before.slice(0, before.length - (ctx.pos - word.from));
    const doc = ctx.state.doc.toString();
    const opts = (labels: string[], type: string, detail?: string) => labels.map((label) => ({ label, type, detail }));

    // inside [ settings ]
    const openBracket = before.lastIndexOf("[");
    const inSettings = openBracket >= 0 && before.lastIndexOf("]") < openBracket;
    if (inSettings) {
      if (/ref:\s*[<>\-?]*\s*[\w"]*\.?$/.test(before) || /ref\s*:\s*[<>\-?]+\s*$/i.test(before)) {
        return refTargets(word, info);
      }
      return {
        from: word.from,
        options: [
          ...opts(["pk", "primary key", "not null", "null", "unique", "increment", "default: ", "note: ''", "ref: > ", "check: ``", "headercolor: #", "color: #", "delete: cascade", "update: cascade", "name: ''", "type: btree"], "property"),
        ],
      };
    }
    // Ref: a.b > c.<here>  /  Dep endpoints
    if (/^\s*(Ref|Dep)\b/i.test(before) || /^\s*[\w."]+\s*[<>\-?]+\s*[\w."]*$/.test(before)) return refTargets(word, info);
    // table names in group / view blocks
    if (/^\s*[A-Za-z_"][\w". ]*$/.test(before) && isInsideBlock(doc, ctx.pos, /(?:TableGroup|Tables)\b[^{]*\{/gi)) {
      return { from: word.from, options: opts(info.tables.map((x) => (x.schema ? `${x.schema}.${x.name}` : x.name)), "class", "table") };
    }
    // indexes { col } — columns of the current table
    if (isInsideBlock(doc, ctx.pos, /\bindexes\s*\{/gi)) {
      const tbl = currentTable(doc, ctx.pos);
      const cols = info.tables.find((x) => x.name === tbl)?.columns || [];
      return { from: word.from, options: [...opts(cols, "property", "column"), ...opts(["type: btree", "unique", "pk"], "keyword")] };
    }
    const depthAtLine = braceDepth(doc, line.from);
    const indentOnly = /^\s*[\w~"]*$/.test(before);
    // top-level statement
    if (depthAtLine === 0 && indentOnly) {
      return {
        from: word.from,
        options: [
          { label: "Table", type: "keyword", apply: "Table name {\n  id integer [pk, increment]\n}", detail: "new table" },
          { label: "Ref", type: "keyword", apply: "Ref: a.id > b.id", detail: "relationship" },
          { label: "Enum", type: "keyword", apply: "Enum name {\n  value\n}", detail: "enum" },
          { label: "TableGroup", type: "keyword", apply: "TableGroup name [color: #4A90D9] {\n  \n}", detail: "group tables" },
          { label: "TablePartial", type: "keyword", apply: "TablePartial name {\n  created_at timestamp\n}", detail: "reusable fields" },
          { label: "Project", type: "keyword", apply: "Project name {\n  database_type: 'PostgreSQL'\n}" },
          { label: "Note", type: "keyword", apply: "Note name {\n  'text'\n}", detail: "sticky note" },
          { label: "DiagramView", type: "keyword", apply: "DiagramView name {\n  Tables { * }\n}", detail: "saved view" },
          { label: "Dep", type: "keyword", apply: "Dep: source -> target", detail: "data lineage" },
          { label: "Records", type: "keyword", apply: "Records table(col) {\n  \n}", detail: "sample data" },
        ],
      };
    }
    // inside a Table body
    if (depthAtLine >= 1) {
      const tokensBefore = beforeWord.trim().split(/\s+/).filter(Boolean);
      if (indentOnly) {
        return {
          from: word.from,
          options: [
            ...opts(["indexes", "checks", "Note: ''", "records"], "keyword"),
            ...opts(info.partials.map((p) => `~${p}`), "class", "partial"),
          ],
        };
      }
      if (tokensBefore.length === 1) {
        return { from: word.from, options: [...opts(info.types, "type"), ...opts(info.enums, "enum", "enum")] };
      }
    }
    return null;
  };
}

function refTargets(word: { from: number; to: number; text: string }, info: EditorSchemaInfo): CompletionResult {
  const dot = word.text.lastIndexOf(".");
  if (dot >= 0) {
    const tbl = word.text.slice(0, dot).replace(/"/g, "");
    const parts = tbl.split(".");
    const name = parts[parts.length - 1];
    const t = info.tables.find((x) => x.name === name || x.alias === name);
    return { from: word.from + dot + 1, options: (t?.columns || []).map((c) => ({ label: c, type: "property", detail: "column" })) };
  }
  return { from: word.from, options: info.tables.map((x) => ({ label: x.schema ? `${x.schema}.${x.name}` : x.name, type: "class", detail: "table" })) };
}

function braceDepth(doc: string, pos: number): number {
  let d = 0;
  const s = doc.slice(0, pos).replace(/\/\/.*$/gm, "").replace(/'''[\s\S]*?'''/g, "").replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`[^`]*`/g, "``");
  for (const ch of s) {
    if (ch === "{") d++;
    else if (ch === "}") d = Math.max(0, d - 1);
  }
  return d;
}

function isInsideBlock(doc: string, pos: number, opener: RegExp): boolean {
  const before = doc.slice(0, pos);
  let last = -1;
  let m: RegExpExecArray | null;
  const re = new RegExp(opener.source, opener.flags.includes("g") ? opener.flags : opener.flags + "g");
  while ((m = re.exec(before))) last = m.index + m[0].length;
  if (last < 0) return false;
  let depth = 1;
  for (let i = last; i < before.length; i++) {
    if (before[i] === "{") depth++;
    else if (before[i] === "}") depth--;
    if (depth === 0) return false;
  }
  return true;
}

// ───────────────────────────── component ─────────────────────────────

const External = Annotation.define<boolean>();

export interface DbmlEditorHandle {
  focus(): void;
  foldAll(): void;
  unfoldAll(): void;
  toggleComment(): void;
  jumpToLine(line: number, col?: number): void;
  getCursor(): { line: number; col: number };
}

interface Props {
  value: string;
  onChange: (text: string) => void;
  diagnostics: DbmlDiagnostic[];
  schema: EditorSchemaInfo;
  reveal: RevealTarget | null;
  onNavigate: (name: string) => void;
  onCursor?: (line: number, col: number) => void;
}

export const DbmlCodeEditor = forwardRef<DbmlEditorHandle, Props>(function DbmlCodeEditor({ value, onChange, diagnostics, schema, reveal, onNavigate, onCursor }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const schemaRef = useRef(schema);
  const onChangeRef = useRef(onChange);
  const onNavigateRef = useRef(onNavigate);
  const onCursorRef = useRef(onCursor);
  schemaRef.current = schema;
  onChangeRef.current = onChange;
  onNavigateRef.current = onNavigate;
  onCursorRef.current = onCursor;
  const lintCompartment = useRef(new Compartment());

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    foldAll: () => viewRef.current && foldAll(viewRef.current),
    unfoldAll: () => viewRef.current && unfoldAll(viewRef.current),
    toggleComment: () => viewRef.current && toggleComment(viewRef.current),
    jumpToLine: (line, col = 1) => {
      const v = viewRef.current;
      if (!v) return;
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
      const pos = Math.min(l.from + Math.max(0, col - 1), l.to);
      v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
      v.focus();
    },
    getCursor: () => {
      const v = viewRef.current;
      if (!v) return { line: 1, col: 1 };
      const head = v.state.selection.main.head;
      const l = v.state.doc.lineAt(head);
      return { line: l.number, col: head - l.from + 1 };
    },
  }));

  // create the editor once
  useEffect(() => {
    if (!host.current) return;
    const navigateAt = (view: EditorView, pos: number) => {
      const w = view.state.wordAt(pos);
      if (!w) return false;
      const text = view.state.sliceDoc(w.from, w.to);
      const known = schemaRef.current.tables.find((x) => x.name === text || x.alias === text);
      if (known) {
        onNavigateRef.current(known.name);
        return true;
      }
      return false;
    };
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        lintGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        dbmlLanguage,
        syntaxHighlighting(highlight),
        dbmlFold,
        theme,
        placeholder("// Write DBML here — the diagram updates as you type\nTable users {\n  id integer [pk, increment]\n  email varchar [unique, not null]\n}"),
        autocompletion({ override: [makeCompletionSource(() => schemaRef.current)], activateOnTyping: true, maxRenderedOptions: 40 }),
        lintCompartment.current.of([]),
        keymap.of([
          { key: "Mod-/", run: toggleComment },
          { key: "Shift-Alt-a", run: toggleBlockComment },
          {
            key: "Mod-F12",
            run: (v) => navigateAt(v, v.state.selection.main.head),
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...foldKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            if (navigateAt(view, pos)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) onChangeRef.current(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            const l = u.state.doc.lineAt(head);
            onCursorRef.current?.(l.number, head - l.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // external value changes (canvas → editor, tab switch, import)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    const head = Math.min(v.state.selection.main.head, value.length);
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, selection: { anchor: head }, annotations: External.of(true) });
  }, [value]);

  // diagnostics → squiggles
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const doc = v.state.doc;
    const list: Diagnostic[] = diagnostics.map((d) => {
      const ln = Math.min(Math.max(1, d.line), doc.lines);
      const line = doc.line(ln);
      const from = Math.min(line.from + Math.max(0, d.col - 1), line.to);
      const endLine = d.endLine ? doc.line(Math.min(Math.max(1, d.endLine), doc.lines)) : line;
      const to = d.endCol ? Math.min(endLine.from + d.endCol - 1, endLine.to) : Math.min(from + 1, line.to);
      return { from, to: Math.max(to, from), severity: d.severity, message: d.message } as Diagnostic;
    });
    v.dispatch(setDiagnostics(v.state, list));
  }, [diagnostics, value]);

  // diagram → code
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !reveal) return;
    const text = v.state.doc.toString();
    const esc = reveal.table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)([ \\t]*Table(?:Partial)?[ \\t]+(?:"?[\\w ]+"?\\.)?"?${esc}"?(?:[ \\t]+as[ \\t]+\\w+)?[ \\t]*(?:\\[[^\\]]*\\])?[ \\t]*\\{)`, "i");
    const m = re.exec(text);
    if (!m) return;
    let pos = m.index + m[1].length;
    if (reveal.column) {
      const bodyStart = m.index + m[0].length;
      let depth = 1;
      let end = bodyStart;
      while (end < text.length && depth > 0) {
        if (text[end] === "{") depth++;
        else if (text[end] === "}") depth--;
        end++;
      }
      const body = text.slice(bodyStart, end);
      const ce = reveal.column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cm = new RegExp(`(^|\\n)([ \\t]*"?${ce}"?[ \\t]+[^\\n]*)`).exec(body);
      if (cm) pos = bodyStart + cm.index + cm[1].length;
    }
    const line = v.state.doc.lineAt(pos);
    v.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    v.focus();
  }, [reveal]);

  return <div ref={host} className="code-scroll h-full w-full min-h-0 overflow-hidden" />;
});
