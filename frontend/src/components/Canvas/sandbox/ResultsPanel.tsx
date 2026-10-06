"use client";

import { memo, useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, RotateCcw, Square, TableProperties, XCircle } from "lucide-react";
import type { ResultSet, RunOutcome } from "@/lib/sandbox/engine";

export interface RunView {
  phase: "idle" | "running" | "done" | "cancelled";
  outcome?: RunOutcome;
  /** Not the editor's text: "Selection", "Preview · customers". */
  source?: string;
  /** Line of the failing statement in the editor (not set for previews). */
  errorLine?: number;
  /** The engine itself failed (worker crashed, WASM didn't load) — not an SQL error. */
  failure?: string;
  startedAt?: number;
}

interface Props {
  engine: "starting" | "ready" | "failed";
  engineError: string | null;
  run: RunView;
  active: number;
  onActive: (i: number) => void;
  onShowError: () => void;
  onStop: () => void;
  onRetry: () => void;
  modKey: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const ms = (t: number) => (t < 1 ? "<1 ms" : t < 1000 ? `${t.toFixed(t < 10 ? 1 : 0)} ms` : `${(t / 1000).toFixed(2)} s`);

function Grid({ rs }: { rs: ResultSet }) {
  if (!rs.rows.length)
    return (
      <div className="h-full flex flex-col items-center justify-center gap-1 text-white/40 select-none">
        <span className="text-[12px]">No rows</span>
        <span className="font-mono text-[10.5px] text-white/25 max-w-[80%] truncate">{rs.columns.join(" · ")}</span>
      </div>
    );
  return (
    <div className="h-full overflow-auto p-scrollbar overscroll-contain">
      <table className="min-w-full border-separate border-spacing-0 font-mono text-[12px]">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-[2] bg-[#0f1522] border-b border-r border-white/[0.08] px-2 h-8 text-right text-[10px] font-medium text-white/30 w-10">#</th>
            {rs.columns.map((c, i) => (
              <th key={i} className="sticky top-0 z-[1] bg-[#0f1522] border-b border-white/[0.08] px-3 h-8 text-left font-semibold text-white/75 whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rs.rows.map((row, r) => (
            <tr key={r} className="group/row">
              <td className="sticky left-0 z-[1] bg-[#0a0f19] group-hover/row:bg-[#111827] border-b border-r border-white/[0.05] px-2 h-7 text-right text-[10.5px] text-white/25 tabular-nums">{r + 1}</td>
              {row.map((v, c) => (
                <td
                  key={c}
                  title={v === null ? "NULL" : String(v)}
                  className={`border-b border-white/[0.04] group-hover/row:bg-white/[0.025] px-3 h-7 whitespace-nowrap max-w-[360px] truncate ${typeof v === "number" ? "text-right tabular-nums text-[#b5cea8]" : "text-slate-200"}`}
                >
                  {v === null ? <span className="italic text-white/25">NULL</span> : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rs.truncated && <p className="px-3 py-2 text-[11px] text-white/40">Showing the first {fmt(rs.rows.length)} rows — add a LIMIT or narrow the query to see others.</p>}
    </div>
  );
}

function toTsv(rs: ResultSet): string {
  const cell = (v: unknown) => (v === null ? "" : String(v).replace(/[\t\n\r]+/g, " "));
  return [rs.columns.join("\t"), ...rs.rows.map((r) => r.map(cell).join("\t"))].join("\n");
}

/** Status line, result-set tabs and the data grid of the playground. */
export const ResultsPanel = memo(function ResultsPanel({ engine, engineError, run, active, onActive, onShowError, onStop, onRetry, modKey }: Props) {
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (run.phase !== "running" || !run.startedAt) return;
    const start = run.startedAt;
    setElapsed(0);
    const id = setInterval(() => setElapsed(performance.now() - start), 250);
    return () => clearInterval(id);
  }, [run.phase, run.startedAt]);

  const out = run.outcome;
  const sets = out?.resultSets ?? [];
  const rs = sets[Math.min(active, sets.length - 1)];
  const error = out?.error;

  const copy = async () => {
    if (!rs) return;
    try {
      await navigator.clipboard.writeText(toTsv(rs));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };

  // ── status line ──
  let status: React.ReactNode;
  if (engine === "starting") status = <span className="flex items-center gap-2 text-white/55"><Loader2 size={13} className="animate-spin text-[#4A90D9]" />Starting SQLite…</span>;
  else if (engine === "failed") status = <span className="flex items-center gap-2 text-red-300"><XCircle size={13} />SQLite didn’t start</span>;
  else if (run.phase === "running")
    status = (
      <span className="flex items-center gap-2 text-white/60">
        <Loader2 size={13} className="animate-spin text-[#4A90D9]" />
        Running{run.source ? ` · ${run.source}` : ""}…{elapsed > 600 && <span className="tabular-nums text-white/35">{ms(elapsed)}</span>}
        {elapsed > 600 && (
          <button type="button" onClick={onStop} className="ml-1 flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/15 border border-red-500/30 text-red-200 hover:bg-red-500/25 text-[11px] font-semibold">
            <Square size={9} fill="currentColor" />
            Stop
          </button>
        )}
      </span>
    );
  else if (run.phase === "cancelled") status = <span className="flex items-center gap-2 text-amber-300"><Square size={11} />Stopped — the database was reset from the diagram</span>;
  else if (run.failure) status = <span className="flex items-center gap-2 text-red-300"><XCircle size={13} />{run.failure}</span>;
  else if (out && error) status = <span className="flex items-center gap-2 text-red-300"><XCircle size={13} />Error{run.source ? ` · ${run.source}` : ""}</span>;
  else if (out)
    status = (
      <span className="flex items-center gap-2 text-white/60 min-w-0">
        <CheckCircle2 size={13} className="text-lime-green shrink-0" />
        <span className="truncate">
          {run.source && <span className="text-white/80">{run.source} · </span>}
          {rs ? `${fmt(rs.totalRows)} row${rs.totalRows === 1 ? "" : "s"}` : out.statements ? `${fmt(out.rowsAffected)} row${out.rowsAffected === 1 ? "" : "s"} affected` : "Nothing to run"}
          {out.statements > 1 && ` · ${out.statements} statements`}
          {rs && out.rowsAffected > 0 && ` · ${fmt(out.rowsAffected)} affected`}
        </span>
        <span className="tabular-nums text-white/35 shrink-0">{ms(out.timeMs)}</span>
      </span>
    );
  else status = <span className="text-white/40">Results</span>;

  // ── body ──
  let body: React.ReactNode;
  if (engine === "failed")
    body = (
      <div className="m-3 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-[12px] text-red-200 leading-relaxed">
        <p className="font-semibold mb-1">The SQLite engine couldn’t start.</p>
        <p className="text-red-200/80 font-mono text-[11px] break-words">{engineError}</p>
        <button type="button" onClick={onRetry} className="mt-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-white/80 hover:text-white text-[11px] font-semibold">
          <RotateCcw size={11} />
          Try again
        </button>
      </div>
    );
  else if (engine === "starting" || run.phase === "running")
    body = rs && run.phase === "running" ? <div className="h-full opacity-40 pointer-events-none"><Grid rs={rs} /></div> : <div className="h-full flex items-center justify-center text-[12px] text-white/35">{engine === "starting" ? "Loading SQLite (WebAssembly) and building your tables…" : "Running…"}</div>;
  else if (run.failure)
    body = <div className="m-3 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-[12px] text-red-200">{run.failure}</div>;
  else if (out) {
    body = (
      <div className="h-full flex flex-col min-h-0">
        {error && (
          <div className="mx-3 mt-3 mb-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 flex items-start gap-2.5 shrink-0">
            <AlertTriangle size={14} className="text-red-300 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-red-100 font-mono break-words">{error.message}</p>
              <p className="mt-1 text-[11px] text-red-200/60">
                Statement {error.statementIndex + 1}
                {run.errorLine ? ` · line ${run.errorLine}` : ""}
                {error.statementIndex > 0 && ` — the ${error.statementIndex === 1 ? "statement" : `${error.statementIndex} statements`} before it ran`}
              </p>
            </div>
            {run.errorLine !== undefined && (
              <button type="button" onClick={onShowError} className="shrink-0 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-[11px] font-semibold text-white/80 hover:text-white">
                Show in editor
              </button>
            )}
          </div>
        )}
        {out.notice && <p className="mx-3 mt-2 text-[11px] text-amber-300/90 shrink-0">{out.notice}</p>}
        <div className="flex-1 min-h-0">
          {rs ? (
            <Grid rs={rs} />
          ) : !error ? (
            <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-6 select-none">
              <CheckCircle2 size={22} className="text-lime-green/70" />
              <span className="text-[12.5px] text-white/70">
                {out.statements ? `${out.statements === 1 ? "Statement" : `${out.statements} statements`} ran — ${fmt(out.rowsAffected)} row${out.rowsAffected === 1 ? "" : "s"} affected.` : "Nothing to run — the editor only has comments."}
              </span>
              <span className="text-[11px] text-white/35">Changes live in this browser session until you Re-sync schema.</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  } else
    body = (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 select-none">
        <TableProperties size={24} className="text-white/15" />
        <span className="text-[12.5px] text-white/55">Run a query to see its results here</span>
        <span className="text-[11px] text-white/30 leading-relaxed">
          <kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/[0.08] font-mono text-[10px]">{modKey}</kbd>{" "}
          <kbd className="px-1 py-px rounded bg-white/[0.06] border border-white/[0.08] font-mono text-[10px]">Enter</kbd> runs · select text to run part of it · click a table or column to insert it
        </span>
      </div>
    );

  return (
    <div className="h-full flex flex-col min-h-0 bg-[#0a0f19]">
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-white/[0.07] text-[11.5px]">
        <div className="min-w-0 flex-1 flex items-center">{status}</div>
        {sets.length > 1 && run.phase !== "running" && (
          <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto scrollbar-hide max-w-[55%]" role="tablist" aria-label="Result sets">
            {sets.map((s, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === Math.min(active, sets.length - 1)}
                onClick={() => onActive(i)}
                title={s.sql}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${i === Math.min(active, sets.length - 1) ? "bg-[#4A90D9]/20 text-white" : "text-white/45 hover:text-white hover:bg-white/[0.05]"}`}
              >
                Result {i + 1}
                <span className="ml-1 font-normal text-white/35 tabular-nums">{fmt(s.totalRows)}</span>
              </button>
            ))}
          </div>
        )}
        {rs && rs.rows.length > 0 && run.phase === "done" && (
          <button type="button" onClick={copy} title="Copy the rows as tab-separated text (pastes into spreadsheets)" className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-white/45 hover:text-white hover:bg-white/[0.06] text-[11px]">
            {copied ? <Check size={11} className="text-lime-green" /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">{body}</div>
    </div>
  );
});
