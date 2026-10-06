"use client";

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { AlertTriangle, ArrowLeft, Check, Database, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Play, RotateCcw, Square, X } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { canvasToModel, isTableNode } from "@/lib/model/canvasAdapter";
import type { DiagramModel, ProjectMeta } from "@/lib/model/types";
import { databaseSignature, playgroundTables, type BuildReport, type PlaygroundTable } from "@/lib/sandbox/engine";
import { SqlEditor, type SqlEditorHandle } from "./sandbox/SqlEditor";
import { SchemaTree } from "./sandbox/SchemaTree";
import { ResultsPanel, type RunView } from "./sandbox/ResultsPanel";
import { CancelledError, startPlaygroundRuntime, type PlaygroundRuntime } from "./sandbox/runtime";

interface SqlSandboxProps {
  nodes: Node[];
  edges: Edge[];
  isOpen: boolean;
  onClose: () => void;
}

/** Stage 1: docked under the canvas (which shrinks to make room). Stage 2: the full-screen, three-pane IDE. */
type Mode = "docked" | "full";

const DOCK_HEIGHT_KEY = "designdb.playground.dockHeight";
const MIN_DOCK = 200;
/** What the docked panel always leaves above itself: the navbar plus a usable strip of canvas. */
const KEEP_ABOVE_DOCK = 300;
const TREE_W = { docked: 232, full: 272 };

const viewportH = () => (typeof window !== "undefined" ? window.innerHeight : 900);
const clampDock = (h: number) => Math.round(Math.max(MIN_DOCK, Math.min(h, viewportH() - KEEP_ABOVE_DOCK)));
const defaultDock = () => clampDock(viewportH() * 0.35);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The diagram as a DiagramModel, rebuilt only when something the database is built from changes — table data,
 * relationships, enums. Dragging or selecting never rebuilds it: React Flow keeps `node.data` / `edge.data` identical for
 * those, so the comparison is a cheap reference check and the playground costs the canvas nothing while you work.
 */
function useLiveModel(nodes: Node[], edges: Edge[], meta: ProjectMeta, active: boolean): DiagramModel | null {
  const cache = useRef<{ parts: unknown[]; model: DiagramModel | null }>({ parts: [], model: null });
  if (active) {
    const parts: unknown[] = [meta.enums, meta.project];
    for (const n of nodes) if (isTableNode(n)) parts.push(n.id, n.data);
    for (const e of edges) parts.push(e.id, e.source, e.target, e.sourceHandle, e.targetHandle, e.type, e.data);
    const prev = cache.current;
    if (!prev.model || prev.parts.length !== parts.length || parts.some((p, i) => p !== prev.parts[i])) cache.current = { parts, model: canvasToModel(nodes, edges, meta) };
  }
  return cache.current.model;
}

/** The first thing in a fresh editor: a SELECT on the first table and, when the diagram has one, a JOIN along a relationship. */
function starterQuery(tables: PlaygroundTable[]): string {
  const first = tables.find((t) => !t.junction) ?? tables[0];
  if (!first) return "-- Add tables to your diagram, then Re-sync schema.\n";
  const lines = ["-- SQLite, in your browser, seeded with sample rows from your diagram.", "-- Ctrl/⌘ + Enter runs every statement — or just the ones you select.", "", `SELECT * FROM ${first.sqlName} LIMIT 10;`];
  // a relationship between two drawn tables reads better than one through a junction table
  for (const child of [...tables.filter((t) => !t.junction), ...tables.filter((t) => t.junction)]) {
    const fk = child.columns.find((c) => c.ref);
    const parent = fk?.ref && tables.find((t) => t.label === fk.ref!.table);
    if (fk && parent && parent !== child) {
      lines.push("", `SELECT *`, `FROM ${child.sqlName} AS c`, `JOIN ${parent.sqlName} AS p ON p.${fk.ref!.column} = c.${fk.name}`, `LIMIT 10;`);
      break;
    }
  }
  return lines.join("\n") + "\n";
}

const iconBtn = "h-7 min-w-7 px-1.5 flex items-center justify-center gap-1.5 rounded-md text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors text-[11.5px] font-semibold disabled:opacity-40";

/**
 * Live SQL playground: SQLite (WebAssembly, in a Web Worker) seeded from the diagram.
 *
 * One mounted tree serves both stages — only CSS changes between docked and full-screen — so the editor keeps its text,
 * cursor, selection, undo history and scroll position across every switch, and across closing and reopening.
 */
export const SqlSandbox = memo(function SqlSandbox({ nodes, edges, isOpen, onClose }: SqlSandboxProps) {
  const layout = useLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // nothing (no editor, no WebAssembly) until the playground is first opened; afterwards it stays mounted, just hidden
  const [everOpened, setEverOpened] = useState(isOpen);
  useEffect(() => {
    if (isOpen) setEverOpened(true);
  }, [isOpen]);

  const model = useLiveModel(nodes, edges, layout.meta, isOpen);
  const tables = useMemo(() => (model ? playgroundTables(model) : []), [model]);
  const liveSig = useMemo(() => (model ? databaseSignature(model) : ""), [model]);
  const modelRef = useRef(model);
  modelRef.current = model;

  const [mode, setMode] = useState<Mode>("docked");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ── engine ──
  const runtimeRef = useRef<PlaygroundRuntime | null>(null);
  const alive = useRef(true);
  const [engine, setEngine] = useState<"idle" | "starting" | "ready" | "failed">("idle");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [built, setBuilt] = useState<{ sig: string; keys: Set<string>; report: BuildReport } | null>(null);
  const editorRef = useRef<SqlEditorHandle>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  const markBuilt = useCallback((m: DiagramModel, report: BuildReport) => {
    const keys = new Set<string>();
    for (const t of playgroundTables(m)) {
      keys.add(t.key);
      for (const c of t.columns) keys.add(`${t.key}.${c.name}`);
    }
    setBuilt({ sig: databaseSignature(m), keys, report });
  }, []);

  const start = useCallback(async () => {
    const m = modelRef.current;
    if (!m) return;
    setEngine("starting");
    setEngineError(null);
    runtimeRef.current?.dispose();
    runtimeRef.current = null;
    try {
      const { runtime, report } = await startPlaygroundRuntime(m);
      if (!alive.current) return runtime.dispose();
      runtimeRef.current = runtime;
      markBuilt(m, report);
      setEngine("ready");
      const ed = editorRef.current;
      if (ed && ed.isPristine() && !ed.getText().trim()) ed.setText(starterQuery(playgroundTables(m)));
    } catch (e) {
      if (!alive.current) return;
      setEngine("failed");
      setEngineError(errorText(e));
    }
  }, [markBuilt]);

  useEffect(() => {
    if (isOpen && engine === "idle" && model) void start();
  }, [isOpen, engine, model, start]);

  // ── running queries ──
  const [run, setRun] = useState<RunView>({ phase: "idle" });
  const [activeResult, setActiveResult] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const runToken = useRef(0);
  const lastError = useRef<{ from: number; to: number } | null>(null);

  /** `offset` is where `text` sits in the editor (null: not from the editor, e.g. a preview — errors aren't marked). */
  const execute = useCallback(async (text: string, offset: number | null, source?: string) => {
    const rt = runtimeRef.current;
    if (!rt || !text.trim()) return;
    const token = ++runToken.current;
    editorRef.current?.clearError();
    lastError.current = null;
    setRun((r) => ({ phase: "running", source, startedAt: performance.now(), outcome: r.outcome }));
    try {
      const outcome = await rt.run(text, offset ?? 0);
      if (token !== runToken.current) return;
      let errorLine: number | undefined;
      if (outcome.error && offset !== null && editorRef.current) {
        editorRef.current.showError(outcome.error.from, outcome.error.to, outcome.error.message);
        errorLine = editorRef.current.lineAt(outcome.error.from);
        lastError.current = { from: outcome.error.from, to: outcome.error.to };
      }
      setActiveResult(Math.max(0, outcome.resultSets.length - 1));
      setRun({ phase: "done", outcome, source, errorLine });
    } catch (e) {
      if (token !== runToken.current) return;
      setRun(e instanceof CancelledError ? { phase: "cancelled", source } : { phase: "done", source, failure: errorText(e) });
    }
  }, []);

  const runEditor = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const sel = ed.getSelection();
    if (sel && sel.text.trim()) void execute(sel.text, sel.from, "Selection");
    else void execute(ed.getText(), 0);
  }, [execute]);

  const preview = useCallback((t: PlaygroundTable) => void execute(`SELECT * FROM ${t.sqlName} LIMIT 100;`, null, `Preview · ${t.label}`), [execute]);
  const insert = useCallback((text: string) => editorRef.current?.insert(text), []);
  const showError = useCallback(() => {
    if (lastError.current) editorRef.current?.select(lastError.current.from, lastError.current.to);
  }, []);
  const locate = useCallback((t: PlaygroundTable) => {
    setMode("docked"); // the canvas has to be visible
    layoutRef.current.getCanvasApi()?.focusTable(t.key);
  }, []);

  /** Stop: abandon the running query by restarting the worker, and rebuild the database from the diagram. */
  const stop = useCallback(async () => {
    const rt = runtimeRef.current;
    const m = modelRef.current;
    if (!rt || !m) return;
    runToken.current++;
    setRun({ phase: "cancelled" });
    setSyncing(true);
    try {
      markBuilt(m, await rt.restart(m));
    } catch (e) {
      if (!(e instanceof CancelledError)) {
        setEngine("failed");
        setEngineError(errorText(e));
      }
    } finally {
      setSyncing(false);
    }
  }, [markBuilt]);

  const resync = useCallback(async () => {
    const rt = runtimeRef.current;
    const m = modelRef.current;
    if (!rt || !m) return void start();
    setSyncing(true);
    try {
      markBuilt(m, await rt.build(m));
    } catch (e) {
      if (!(e instanceof CancelledError)) setRun({ phase: "done", failure: `Re-sync failed: ${errorText(e)}` });
    } finally {
      setSyncing(false);
    }
  }, [markBuilt, start]);

  // a query that is still running after a moment turns the Run button into Stop
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (run.phase !== "running") return;
    const id = setTimeout(() => setSlow(true), 600);
    return () => clearTimeout(id);
  }, [run.phase, run.startedAt]);

  // ── stage switching & keyboard ──
  const toggleMode = useCallback(() => {
    setMode((m) => (m === "full" ? "docked" : "full"));
    requestAnimationFrame(() => editorRef.current?.focus());
  }, []);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return; // the editor used it: closing autocomplete, search, a tree filter…
      const inside = !!sectionRef.current?.contains(document.activeElement);
      if (e.key === "Escape") {
        if (modeRef.current === "full") {
          e.preventDefault();
          setMode("docked");
        } else if (inside) {
          e.preventDefault();
          onCloseRef.current();
        }
      } else if (e.key === "Enter" && e.altKey && !e.ctrlKey && !e.metaKey && (inside || modeRef.current === "full")) {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, toggleMode]);

  // ── sizes ──
  const [dockHeight, setDockHeight] = useState(320);
  const dockRef = useRef(dockHeight);
  dockRef.current = dockHeight;
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    let saved = NaN;
    try {
      saved = Number(localStorage.getItem(DOCK_HEIGHT_KEY));
    } catch {
      /* storage blocked */
    }
    setDockHeight(Number.isFinite(saved) && saved > 0 ? clampDock(saved) : defaultDock());
    const onResize = () => setDockHeight((h) => clampDock(h));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const saveDock = (h: number) => {
    try {
      localStorage.setItem(DOCK_HEIGHT_KEY, String(h));
    } catch {
      /* storage blocked */
    }
  };

  const onDockResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    const startY = e.clientY;
    const startH = dockRef.current;
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    // at most one height per frame — pointer events can outpace rendering, and every height change re-lays out the canvas
    let frame = 0;
    let latest = startH;
    const move = (ev: PointerEvent) => {
      latest = clampDock(startH - (ev.clientY - startY));
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setDockHeight(latest);
        });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      setDockHeight(latest);
      dockRef.current = latest;
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setResizing(false);
      saveDock(dockRef.current);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  const onDockKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 80 : 24;
    const next = e.key === "ArrowUp" ? dockHeight + step : e.key === "ArrowDown" ? dockHeight - step : e.key === "Home" ? MIN_DOCK : e.key === "End" ? viewportH() : null;
    if (next === null) return;
    e.preventDefault();
    const h = clampDock(next);
    setDockHeight(h);
    saveDock(h);
  };
  const resetDock = () => {
    const h = defaultDock();
    setDockHeight(h);
    saveDock(h);
  };

  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    let frame = 0;
    const ro = new ResizeObserver(([entry]) => {
      // next frame: re-laying out the panes inside the observer's callback resizes the editor (itself observed) in the
      // same frame, which browsers report as "ResizeObserver loop completed with undelivered notifications"
      const w = Math.round(entry.contentRect.width);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(w));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [everOpened]);

  const [treePref, setTreePref] = useState<boolean | null>(null); // null: automatic, by width
  const [split, setSplit] = useState({ docked: 0.5, full: 0.46 });
  const mainRef = useRef<HTMLDivElement>(null);

  const full = mode === "full";
  const showTree = treePref ?? (width === 0 || width >= (full ? 720 : 860));
  const mainW = width - (showTree ? TREE_W[mode] : 0);
  const vertical = full || (mainW > 0 && mainW < 620); // docked panels stack editor over results when narrow
  const frac = full ? split.full : split.docked;

  const onSplitStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !mainRef.current) return;
    e.preventDefault();
    const target = e.currentTarget;
    const box = mainRef.current.getBoundingClientRect();
    const key = full ? "full" : "docked";
    target.setPointerCapture(e.pointerId);
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const f = vertical ? (ev.clientY - box.top) / box.height : (ev.clientX - box.left) / box.width;
      setSplit((s) => ({ ...s, [key]: Math.min(0.8, Math.max(0.2, f)) }));
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setResizing(false);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  // ── header bits ──
  const [notesOpen, setNotesOpen] = useState(false);
  const notesRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!notesOpen) return;
    const close = (e: MouseEvent) => {
      if (!notesRef.current?.contains(e.target as globalThis.Node)) setNotesOpen(false);
    };
    document.addEventListener("pointerdown", close, true); // capture: the canvas stops mousedown from bubbling
    return () => document.removeEventListener("pointerdown", close, true);
  }, [notesOpen]);

  const modKey = useMemo(() => (typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"), []);

  if (!everOpened) return null;

  const ready = engine === "ready";
  const running = run.phase === "running";
  const outOfSync = ready && !!built && built.sig !== liveSig;
  const issues = built?.report.issues ?? [];
  const dbType = model?.project?.databaseType;
  const narrow = width > 0 && width < 640;

  let syncChip: React.ReactNode = null;
  if (engine === "starting" || engine === "idle" || syncing)
    syncChip = (
      <span className="flex items-center gap-1.5 text-[11px] text-white/45 whitespace-nowrap">
        <Loader2 size={11} className="animate-spin" />
        {engine === "ready" ? "Syncing…" : "Starting…"}
      </span>
    );
  else if (engine === "failed") syncChip = <span className="text-[11px] font-semibold text-red-300 whitespace-nowrap">Engine error</span>;
  else if (outOfSync)
    syncChip = (
      <button type="button" onClick={resync} title="The diagram changed since the database was built — rebuild it (rows you changed here are discarded)" className="flex items-center gap-1.5 h-6 px-2 rounded-md bg-amber-400/10 border border-amber-400/30 text-amber-200 hover:bg-amber-400/20 text-[11px] font-semibold whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        {narrow ? "Re-sync" : "Diagram changed · Re-sync"}
      </button>
    );
  else if (built)
    syncChip = (
      <span className="flex items-center gap-1 text-[11px] text-white/40 whitespace-nowrap" title={`${built.report.tables} tables · ${built.report.rows} sample rows · built in ${Math.round(built.report.timeMs)} ms`}>
        <Check size={11} className="text-lime-green" />
        In sync
      </span>
    );

  const runButton = running ? (
    <button
      type="button"
      onClick={slow ? stop : undefined}
      disabled={!slow}
      className={`flex items-center gap-2 h-8 px-3 rounded-lg text-[12px] font-semibold shadow-lg ${slow ? "bg-[#2a1618] border border-red-500/40 text-red-200 hover:bg-[#3a1c1f]" : "bg-[#4A90D9]/60 text-white/80 cursor-wait"}`}
    >
      {slow ? <Square size={10} fill="currentColor" /> : <Loader2 size={12} className="animate-spin" />}
      {slow ? "Stop" : "Running…"}
    </button>
  ) : (
    <button
      type="button"
      onClick={runEditor}
      disabled={!ready}
      title={`Run ${hasSelection ? "the selected SQL" : "every statement"} (${modKey}+Enter)`}
      className="flex items-center gap-2 h-8 pl-3 pr-1.5 rounded-lg bg-[#4A90D9] hover:bg-[#5ba0e9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-semibold shadow-[0_6px_20px_rgba(74,144,217,0.35)]"
    >
      <Play size={11} fill="currentColor" />
      {hasSelection ? "Run selection" : "Run"}
      <kbd className="ml-0.5 px-1.5 py-0.5 rounded bg-black/25 text-[10px] font-mono text-white/80">{modKey} ↵</kbd>
    </button>
  );

  return (
    <section
      ref={sectionRef}
      role={full ? "dialog" : "region"}
      aria-modal={full ? true : undefined}
      aria-label="SQL playground"
      className={`${isOpen ? "flex" : "hidden"} flex-col min-h-0 text-white bg-[#0b0f18] ${
        full ? "fixed inset-0 z-[70]" : "relative shrink-0 border-t border-white/[0.1] shadow-[0_-16px_40px_rgba(0,0,0,0.45)]"
      } ${resizing ? "select-none" : ""}`}
      style={full ? undefined : { height: dockHeight }}
    >
      {!full && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the SQL playground"
          aria-valuemin={MIN_DOCK}
          aria-valuemax={Math.max(MIN_DOCK, viewportH() - KEEP_ABOVE_DOCK)}
          aria-valuenow={dockHeight}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onDockResizeStart}
          onDoubleClick={resetDock}
          onKeyDown={onDockKey}
          className="group/handle absolute -top-[5px] inset-x-0 h-[10px] z-20 cursor-row-resize flex items-center justify-center outline-none"
        >
          <span className={`h-[3px] w-12 rounded-full transition-colors ${resizing ? "bg-[#4A90D9]" : "bg-white/15 group-hover/handle:bg-[#4A90D9] group-focus-visible/handle:bg-[#4A90D9]"}`} />
        </div>
      )}

      {/* ── header ── */}
      <header className={`${full ? "h-12 px-3" : "h-10 px-2.5"} shrink-0 flex items-center gap-2 border-b border-white/[0.08] bg-[#0d121d]`}>
        {full && (
          <>
            <button type="button" onClick={toggleMode} title="Back to the ERD canvas — the playground stays docked below it (Esc)" className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg bg-white/[0.05] border border-white/[0.09] text-[12px] font-semibold text-white/80 hover:text-white hover:bg-white/[0.09]">
              <ArrowLeft size={14} />
              Back to ERD canvas
            </button>
            <span className="w-px h-5 bg-white/[0.1] mx-1" />
          </>
        )}
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-6 h-6 rounded-md bg-[#4A90D9]/15 text-[#7fb6ef] flex items-center justify-center shrink-0">
            <Database size={13} />
          </span>
          <span className="text-[12.5px] font-bold tracking-wide whitespace-nowrap">SQL Playground</span>
        </span>
        {!narrow && (
          <span
            title={`SQLite compiled to WebAssembly (sql.js), running ${runtimeRef.current?.kind === "inline" ? "on the page" : "in a background worker"} — nothing leaves this browser.\nYour diagram's keys, NOT NULL / UNIQUE / CHECK constraints, foreign keys and their ON DELETE / ON UPDATE actions are enforced.${dbType && !/sqlite/i.test(dbType) ? `\nYour diagram targets ${dbType}: SQL written for it can differ from SQLite's dialect.` : ""}`}
            className="px-1.5 py-0.5 rounded border border-white/[0.1] bg-white/[0.03] text-[10px] font-mono text-white/50 whitespace-nowrap"
          >
            SQLite · WebAssembly
          </span>
        )}
        {syncChip}
        {issues.length > 0 && !syncing && (
          <span ref={notesRef} className="relative">
            <button type="button" onClick={() => setNotesOpen((o) => !o)} aria-expanded={notesOpen} className="flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-amber-200/80 hover:text-amber-100 hover:bg-white/[0.05] whitespace-nowrap">
              <AlertTriangle size={11} />
              {issues.length} note{issues.length === 1 ? "" : "s"}
            </button>
            {notesOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-30 w-[380px] max-w-[80vw] p-3 rounded-lg bg-[#111827] border border-white/[0.12] shadow-[0_16px_48px_rgba(0,0,0,0.7)] space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Built with notes</p>
                {issues.map((m, i) => (
                  <p key={i} className="text-[11.5px] leading-relaxed text-white/75">
                    {m}
                  </p>
                ))}
              </div>
            )}
          </span>
        )}

        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => setTreePref(!showTree)} title={showTree ? "Hide the schema" : "Show the schema"} aria-pressed={showTree} className={iconBtn}>
            {showTree ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <button type="button" onClick={resync} disabled={!ready || syncing} title="Rebuild the playground database from the diagram — rows you changed here are discarded" className={iconBtn}>
            <RotateCcw size={13} className={syncing ? "animate-spin" : ""} />
            {!narrow && <span>{full ? "Re-sync schema" : "Re-sync"}</span>}
          </button>
          <button type="button" onClick={toggleMode} title={full ? "Minimize to the docked panel (Esc or Alt+Enter)" : "Maximize — full-screen SQL IDE (Alt+Enter)"} aria-label={full ? "Minimize" : "Maximize"} className={iconBtn}>
            {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" onClick={onClose} title="Close the playground — your query and results are kept" aria-label="Close" className={iconBtn}>
            <X size={15} />
          </button>
        </span>
      </header>

      {/* ── body: schema | editor + results ── */}
      <div className="flex-1 min-h-0 flex">
        {showTree && (
          <aside className="shrink-0 min-h-0 border-r border-white/[0.07] bg-[#090d15]" style={{ width: TREE_W[mode] }} aria-label="Schema">
            <SchemaTree tables={tables} built={built?.keys ?? null} onInsert={insert} onPreview={preview} onLocate={locate} />
          </aside>
        )}
        <div ref={mainRef} className={`flex-1 min-w-0 min-h-0 flex ${vertical ? "flex-col" : "flex-row"}`}>
          <div className="relative min-w-0 min-h-0 overflow-hidden" style={{ flex: `0 0 ${Math.round(frac * 1000) / 10}%` }}>
            <SqlEditor ref={editorRef} tables={tables} onRun={runEditor} onSelectionChange={setHasSelection} />
            <div className="absolute bottom-3 right-4 z-10">{runButton}</div>
          </div>
          <div
            role="separator"
            aria-orientation={vertical ? "horizontal" : "vertical"}
            aria-label="Resize the editor and results"
            title="Drag to resize · double-click to reset"
            onPointerDown={onSplitStart}
            onDoubleClick={() => setSplit({ docked: 0.5, full: 0.46 })}
            className={`${vertical ? "h-[5px] cursor-row-resize" : "w-[5px] cursor-col-resize"} shrink-0 bg-white/[0.05] hover:bg-[#4A90D9]/60 transition-colors`}
          />
          <div className="flex-1 min-w-0 min-h-0">
            <ResultsPanel
              engine={engine === "ready" ? "ready" : engine === "failed" ? "failed" : "starting"}
              engineError={engineError}
              run={run}
              active={activeResult}
              onActive={setActiveResult}
              onShowError={showError}
              onStop={stop}
              onRetry={start}
              modKey={modKey}
            />
          </div>
        </div>
      </div>
    </section>
  );
});
