"use client";

import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { setDiagnostics } from "@codemirror/lint";
import { SQLite, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { tags as t } from "@lezer/highlight";
import type { PlaygroundTable } from "@/lib/sandbox/engine";
import { sqlIdent } from "@/lib/sandbox/engine";

/** Imperative API — the editor owns its text (no React state per keystroke), the playground drives it through this. */
export interface SqlEditorHandle {
  getText(): string;
  /** The selected text and where it starts, or null when nothing is selected. */
  getSelection(): { text: string; from: number } | null;
  setText(text: string): void;
  /** Inserts at the cursor (replacing the selection) and focuses the editor. */
  insert(text: string): void;
  focus(): void;
  /** Underlines the failing statement and shows the message in a tooltip / gutter marker. */
  showError(from: number, to: number, message: string): void;
  clearError(): void;
  select(from: number, to: number): void;
  lineAt(pos: number): number;
  isPristine(): boolean;
}

interface Props {
  tables: PlaygroundTable[];
  onRun: () => void;
  /** Called when "is there a selection" changes — the Run button then reads "Run selection". */
  onSelectionChange?: (hasSelection: boolean) => void;
}

// Same palette as the DBML editor, on the playground's navy background.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#7cc3ef" },
  { tag: [t.typeName, t.standard(t.name)], color: "#569cd6" },
  { tag: [t.string, t.special(t.string)], color: "#ce9178" },
  { tag: t.number, color: "#b5cea8" },
  { tag: [t.bool, t.null], color: "#569cd6" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#d4d4d4" },
  { tag: [t.lineComment, t.blockComment, t.comment], color: "#6f8f8c", fontStyle: "italic" },
  { tag: t.special(t.name), color: "#dcdcaa" },
  { tag: [t.name, t.propertyName], color: "#e6e6e6" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#070b14", color: "#e6e6e6", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace", lineHeight: "1.65", overflow: "auto" },
    ".cm-content": { caretColor: "#aeafad", padding: "10px 0 56px" },
    ".cm-gutters": { backgroundColor: "#070b14", color: "rgba(255,255,255,0.28)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px", minWidth: "40px" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.03)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "rgba(255,255,255,0.75)" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "#aeafad" },
    ".cm-selectionBackground": { backgroundColor: "#2a3346 !important" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "#264f78 !important" },
    ".cm-tooltip": { backgroundColor: "#111827", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", overflow: "hidden" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "ui-monospace, monospace", fontSize: "12.5px", maxHeight: "16em" },
    // the completion list scrolls too: same thin bar as the rest of the playground (.p-scrollbar)
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar": { width: "6px", height: "6px" },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-track": { background: "transparent" },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-button": { display: "none" },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.1)", borderRadius: "4px" },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb:hover": { background: "rgba(255,255,255,0.2)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "#1d4f7c", color: "#fff" },
    ".cm-completionDetail": { color: "rgba(255,255,255,0.4)", marginLeft: "10px", fontStyle: "normal" },
    ".cm-diagnostic": { fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px", padding: "6px 10px" },
    ".cm-diagnostic-error": { borderLeft: "3px solid #f87171" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #f87171", textUnderlineOffset: "3px" },
    ".cm-lint-marker": { width: "0.8em", height: "0.8em" },
    ".cm-panels": { backgroundColor: "#111827", color: "#e6e6e6" },
    ".cm-searchMatch": { backgroundColor: "rgba(234,192,92,0.28)" },
    ".cm-matchingBracket": { backgroundColor: "rgba(255,255,255,0.1)", outline: "1px solid rgba(255,255,255,0.28)" },
    ".cm-placeholder": { color: "rgba(255,255,255,0.3)" },
  },
  { dark: true }
);

const unquote = (name: string) => (name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name);

/** Schema-aware completion: table names (with column counts) and, after `table.`, that table's columns with their types. */
function sqlSupport(tables: PlaygroundTable[]) {
  const schema: Record<string, SQLNamespace> = {};
  for (const tb of tables) {
    const raw = unquote(tb.sqlName);
    const self: Completion = { label: raw, apply: tb.sqlName, type: "type", detail: `${tb.columns.length} col${tb.columns.length === 1 ? "" : "s"}${tb.junction ? " · junction" : ""}` };
    const children: Completion[] = tb.columns.map((c) => ({ label: c.name, apply: sqlIdent(c.name), type: "property", detail: `${c.type}${c.pk ? " · PK" : c.ref ? " · FK" : ""}` }));
    schema[raw.replace(/\./g, "\\.")] = { self, children };
  }
  return sql({ dialect: SQLite, schema, upperCaseKeywords: true });
}

export const SqlEditor = memo(
  forwardRef<SqlEditorHandle, Props>(function SqlEditor({ tables, onRun, onSelectionChange }, ref) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const language = useRef(new Compartment());
    const pristine = useRef(true);
    // the editor is created once — callbacks are read through refs so re-renders never rebuild it
    const onRunRef = useRef(onRun);
    onRunRef.current = onRun;
    const onSelRef = useRef(onSelectionChange);
    onSelRef.current = onSelectionChange;
    const tablesRef = useRef(tables);
    tablesRef.current = tables;

    useEffect(() => {
      if (!host.current) return;
      let hadSelection = false;
      const v = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: "",
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            autocompletion({ icons: false }),
            highlightActiveLine(),
            highlightSelectionMatches(),
            syntaxHighlighting(highlight),
            placeholder("Write SQL — Ctrl+Enter runs it (or just the selection)"),
            Prec.highest(
              keymap.of([
                {
                  key: "Mod-Enter",
                  run: () => {
                    onRunRef.current();
                    return true;
                  },
                },
              ])
            ),
            keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab, { key: "Mod-/", run: toggleComment }]),
            language.current.of(sqlSupport(tablesRef.current)),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) pristine.current = false;
              if (u.selectionSet || u.docChanged) {
                const has = !u.state.selection.main.empty;
                if (has !== hadSelection) {
                  hadSelection = has;
                  onSelRef.current?.(has);
                }
              }
            }),
            theme,
          ],
        }),
      });
      // the app's thin panel scrollbar (globals.css) instead of the native one with arrow buttons
      v.scrollDOM.classList.add("p-scrollbar");
      view.current = v;
      return () => {
        v.destroy();
        view.current = null;
      };
    }, []);

    // the live schema changed (tables / columns edited on the canvas) — swap the completion source, keep everything else
    useEffect(() => {
      view.current?.dispatch({ effects: language.current.reconfigure(sqlSupport(tables)) });
    }, [tables]);

    useImperativeHandle(
      ref,
      () => ({
        getText: () => view.current?.state.doc.toString() ?? "",
        getSelection: () => {
          const v = view.current;
          if (!v) return null;
          const { from, to, empty } = v.state.selection.main;
          return empty ? null : { text: v.state.sliceDoc(from, to), from };
        },
        setText: (text) => {
          const v = view.current;
          if (!v) return;
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length) });
          pristine.current = true;
        },
        insert: (text) => {
          const v = view.current;
          if (!v) return;
          v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true });
          v.focus();
        },
        focus: () => view.current?.focus(),
        showError: (from, to, message) => {
          const v = view.current;
          if (!v) return;
          const len = v.state.doc.length;
          const a = Math.max(0, Math.min(from, len));
          const b = Math.max(a, Math.min(to, len));
          v.dispatch(setDiagnostics(v.state, [{ from: a, to: b === a ? Math.min(len, a + 1) : b, severity: "error", message }]));
        },
        clearError: () => {
          const v = view.current;
          if (v) v.dispatch(setDiagnostics(v.state, []));
        },
        select: (from, to) => {
          const v = view.current;
          if (!v) return;
          const len = v.state.doc.length;
          v.dispatch({ selection: EditorSelection.range(Math.min(from, len), Math.min(to, len)), scrollIntoView: true });
          v.focus();
        },
        lineAt: (pos) => view.current?.state.doc.lineAt(Math.min(pos, view.current.state.doc.length)).number ?? 1,
        isPristine: () => pristine.current,
      }),
      []
    );

    return <div ref={host} className="h-full w-full min-h-0 min-w-0 overflow-hidden" />;
  })
);
