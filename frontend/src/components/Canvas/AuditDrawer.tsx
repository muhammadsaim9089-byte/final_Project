"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import {
  ChevronDown, ChevronLeft, CircleCheck, Crosshair, FileText, History, Lightbulb, OctagonAlert, RefreshCw, ScanSearch,
  ShieldCheck, SkipForward, Sparkles, TriangleAlert, X,
} from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { canvasToModel, isTableNode } from "@/lib/model/canvasAdapter";
import { RULE_COUNT, SEVERITY_ORDER, applyAllFixes, applyFix, auditModel, type Finding, type Severity } from "@/lib/audit";
import { relativeTime } from "@/lib/projects";

/**
 * AI Architecture Audit — a drawer docked to the right of the canvas (it replaced a floating box that covered the
 * diagram). Deterministic checks from lib/audit, grouped by severity, each with "Focus" (pan / zoom to the tables
 * involved) and "Auto-Fix" (one undo step). After the first scan the results follow the diagram live: fix something
 * by hand and its card goes away.
 *
 *   Interactive Wizard — one issue at a time: Focus, Auto-Fix, Skip, Previous
 *   Audit Log          — every issue grouped by severity, "Fix all", what was fixed this session
 */
const SEV: Record<Severity, { label: string; Icon: typeof OctagonAlert; badge: string; text: string; hover: string; bar: string }> = {
  critical: { label: "Critical", Icon: OctagonAlert, badge: "bg-red-500/10 border-red-400/25 text-red-300", text: "text-red-300", hover: "hover:border-red-400/45", bar: "bg-red-400" },
  warning: { label: "Warning", Icon: TriangleAlert, badge: "bg-amber-500/10 border-amber-400/25 text-amber-300", text: "text-amber-300", hover: "hover:border-amber-400/45", bar: "bg-amber-400" },
  suggestion: { label: "Suggestion", Icon: Lightbulb, badge: "bg-sky-500/10 border-sky-400/25 text-sky-300", text: "text-sky-300", hover: "hover:border-sky-400/45", bar: "bg-sky-400" },
};

const AI_GRADIENT = "bg-gradient-to-r from-violet-500 via-indigo-500 to-[#4A90D9] hover:brightness-110 shadow-[0_6px_18px_rgba(99,102,241,0.3)]";

interface FixedEntry {
  at: number;
  severity: Severity;
  summary: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  nodes: Node[];
  edges: Edge[];
  /** pan / zoom to these tables (keys) */
  onFocus: (tableKeys: string[]) => void;
  /** the normalization report of a diagram generated from a prompt, if any */
  generationReport?: string;
}

export const AuditDrawer = memo(function AuditDrawer({ open, onClose, nodes, edges, onFocus, generationReport }: Props) {
  const layout = useLayout();
  const [tab, setTab] = useState<"wizard" | "log">("log");
  const [scan, setScan] = useState<{ at: number; findings: Finding[] } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [cursor, setCursor] = useState(0);
  const [fixed, setFixed] = useState<FixedEntry[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [, tick] = useState(0);

  const meta = layout.meta;
  const tableCount = useMemo(() => nodes.filter(isTableNode).length, [nodes]);
  const audit = useCallback(() => auditModel(canvasToModel(nodes, edges, meta)), [nodes, edges, meta]);

  // "Run Full Scan": a short visible scan (the checks themselves are instant)
  const runScan = useCallback(() => {
    setScanning(true);
    setSkipped(new Set());
    setCursor(0);
    setTimeout(() => {
      const findings = audit();
      setScan({ at: Date.now(), findings });
      setScanning(false);
      if (findings.length && findings.some((f) => f.severity === "critical")) setTab("wizard");
    }, 450);
  }, [audit]);

  // first open scans by itself; afterwards the results follow the diagram (fix something by hand → its card goes)
  const scanned = useRef(false);
  useEffect(() => {
    if (open && !scanned.current) {
      scanned.current = true;
      runScan();
    }
  }, [open, runScan]);
  useEffect(() => {
    if (!open || !scan) return;
    const t = setTimeout(() => setScan({ at: Date.now(), findings: audit() }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, meta, open]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((x) => x + 1), 30_000); // "scanned 2 minutes ago"
    return () => clearInterval(t);
  }, [open]);

  const findings = useMemo(() => scan?.findings ?? [], [scan]);
  const bySeverity = useMemo(() => SEVERITY_ORDER.map((s) => ({ severity: s, items: findings.filter((f) => f.severity === s) })), [findings]);
  const pending = useMemo(() => findings.filter((f) => !skipped.has(f.id)), [findings, skipped]);
  const current = pending[Math.min(cursor, Math.max(0, pending.length - 1))];

  // ── actions ──
  const fixOne = (f: Finding) => {
    const api = layout.getCanvasApi();
    if (!api) return;
    const res = applyFix(api.getModel(), f);
    if (!res) {
      showToast("Already resolved — the list is up to date", "success");
      setScan({ at: Date.now(), findings: audit() });
      return;
    }
    api.applyModel(res.model, { mode: "replace", layout: "keep", fit: false });
    setFixed((xs) => [{ at: Date.now(), severity: f.severity, summary: res.summary }, ...xs]);
    showToast(`Fixed: ${res.summary} — Ctrl+Z undoes it`, "success");
  };
  const fixMany = (list: Finding[]) => {
    const api = layout.getCanvasApi();
    if (!api || !list.length) return;
    const res = applyAllFixes(api.getModel(), list);
    if (!res.summaries.length) return;
    api.applyModel(res.model, { mode: "replace", layout: "keep", fit: false });
    const now = Date.now();
    setFixed((xs) => [...res.summaries.map((summary, i) => ({ at: now, severity: list[Math.min(i, list.length - 1)].severity, summary })), ...xs]);
    showToast(`Fixed ${res.summaries.length} issue${res.summaries.length === 1 ? "" : "s"} — one Ctrl+Z undoes them all`, "success");
  };

  if (!open) return null;

  const counts = Object.fromEntries(bySeverity.map((g) => [g.severity, g.items.length])) as Record<Severity, number>;

  return (
    <aside
      aria-label="AI Architecture Audit"
      className="absolute right-0 top-0 bottom-0 z-40 w-96 max-w-full flex flex-col bg-[#0b1020] border-l border-white/[0.08] shadow-[-24px_0_60px_rgba(0,0,0,0.45)] animate-in slide-in-from-right duration-200 select-none"
    >
      {/* header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <div className="flex items-start gap-3">
          <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-white ${AI_GRADIENT}`}>
            <Sparkles size={17} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-white leading-tight">AI Architecture Audit</h2>
            <p className="text-[11.5px] text-white/45 truncate">
              {scanning ? "Scanning…" : scan ? `${RULE_COUNT} checks · ${tableCount} table${tableCount === 1 ? "" : "s"} · scanned ${relativeTime(scan.at)}` : `${RULE_COUNT} checks: integrity, normalization, performance`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close the audit" title="Close (Esc)" className="w-8 h-8 -mr-1 shrink-0 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors">
            <X size={16} />
          </button>
        </div>
        {/* segmented control */}
        <div role="tablist" aria-label="Audit view" className="mt-3 grid grid-cols-2 p-1 rounded-xl bg-black/30 border border-white/[0.07]">
          {(
            [
              ["wizard", "Interactive Wizard", pending.length],
              ["log", "Audit Log", findings.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`h-8 rounded-lg text-[12.5px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === id ? "bg-[#1f2a44] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-white/50 hover:text-white/80"}`}
            >
              {label}
              {scan && n > 0 && <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] flex items-center justify-center ${tab === id ? "bg-white/15" : "bg-white/[0.07]"}`}>{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-scrollbar px-4 py-4">
        {scanning ? (
          <ScanningState tables={tableCount} />
        ) : !scan ? null : !findings.length ? (
          <EmptyState tables={tableCount} fixedCount={fixed.length} onScan={runScan} />
        ) : tab === "wizard" ? (
          pending.length && current ? (
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-[11.5px] text-white/50">
                  <span>
                    Issue <b className="text-white/85">{Math.min(cursor, pending.length - 1) + 1}</b> of {pending.length}
                  </span>
                  <span>
                    {fixed.length} fix{fixed.length === 1 ? "" : "es"} applied{skipped.size ? ` · ${skipped.size} skipped` : ""}
                  </span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-[#4A90D9] transition-all duration-300" style={{ width: `${(fixed.length / Math.max(1, fixed.length + pending.length)) * 100}%` }} />
                </div>
              </div>
              <FindingCard finding={current} large onFocus={() => onFocus(current.tables)} onFix={() => fixOne(current)} />
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCursor((c) => Math.max(0, Math.min(c, pending.length - 1) - 1))}
                  disabled={Math.min(cursor, pending.length - 1) === 0}
                  className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-white/55 hover:text-white hover:bg-white/[0.06] disabled:opacity-30 disabled:pointer-events-none inline-flex items-center gap-1"
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <button
                  onClick={() => {
                    setSkipped((s) => new Set(s).add(current.id));
                  }}
                  className="h-8 px-2.5 rounded-lg text-[12px] font-semibold text-white/55 hover:text-white hover:bg-white/[0.06] inline-flex items-center gap-1"
                >
                  Skip <SkipForward size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center">
              <CircleCheck size={30} className="mx-auto text-emerald-300" />
              <p className="mt-3 text-[14px] font-semibold text-white">You&apos;ve been through every issue</p>
              <p className="mt-1 text-[12.5px] text-white/50">{skipped.size} skipped — they are still listed in the Audit Log.</p>
              <button onClick={() => { setSkipped(new Set()); setCursor(0); }} className="mt-4 h-9 px-4 rounded-lg border border-white/[0.14] text-[12.5px] font-semibold text-white/80 hover:text-white hover:bg-white/[0.06]">
                Go through the skipped ones
              </button>
            </div>
          )
        ) : (
          <div className="space-y-5">
            {/* summary */}
            <div className="grid grid-cols-3 gap-2">
              {SEVERITY_ORDER.map((s) => {
                const { Icon, label, text } = SEV[s];
                return (
                  <div key={s} className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-2.5 py-2">
                    <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${counts[s] ? text : "text-white/35"}`}>
                      <Icon size={12} /> {label}
                    </div>
                    <div className={`mt-0.5 text-[18px] font-bold tabular-nums ${counts[s] ? "text-white" : "text-white/30"}`}>{counts[s]}</div>
                  </div>
                );
              })}
            </div>
            {bySeverity
              .filter((g) => g.items.length)
              .map((g) => (
                <section key={g.severity} aria-label={`${SEV[g.severity].label} issues`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${SEV[g.severity].text}`}>
                      {SEV[g.severity].label} <span className="text-white/35">· {g.items.length}</span>
                    </h3>
                    {g.items.length > 1 && (
                      <button onClick={() => fixMany(g.items)} className="text-[11.5px] font-semibold text-[#9ab8ff] hover:text-white">
                        Fix all {g.items.length}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {g.items.map((f) => (
                      <FindingCard key={f.id} finding={f} onFocus={() => onFocus(f.tables)} onFix={() => fixOne(f)} />
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )}

        {/* what happened this session, and the report of a diagram generated from a prompt */}
        {!scanning && scan && (fixed.length > 0 || (tab === "log" && generationReport)) && (
          <div className="mt-6 space-y-4">
            {fixed.length > 0 && (
              <section aria-label="Fixes applied this session">
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300/90 mb-2">
                  <History size={12} /> Fixes applied this session · {fixed.length}
                </h3>
                <ul className="space-y-1.5">
                  {fixed.slice(0, 12).map((e, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-white/60 leading-snug">
                      <CircleCheck size={13} className="mt-[1px] shrink-0 text-emerald-400/80" />
                      <span className="flex-1 min-w-0">{e.summary}</span>
                      <span className="shrink-0 text-[10.5px] text-white/30">{relativeTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-white/35">Each fix is an undo step — Ctrl+Z takes it back.</p>
              </section>
            )}
            {tab === "log" && generationReport && (
              <section>
                <button onClick={() => setShowReport((v) => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40 hover:text-white/70">
                  <FileText size={12} /> Normalization report from generation
                  <ChevronDown size={12} className={`ml-auto transition-transform ${showReport ? "rotate-180" : ""}`} />
                </button>
                {showReport && <pre className="mt-2 max-h-72 overflow-auto p-scrollbar whitespace-pre-wrap rounded-lg bg-black/25 border border-white/[0.06] p-3 text-[11.5px] leading-relaxed text-white/60 select-text">{generationReport.replace(/\*\*/g, "")}</pre>}
              </section>
            )}
          </div>
        )}
      </div>

      {/* footer: everything at once (the log view) or a rescan */}
      {!scanning && scan && findings.length > 0 && (
        <div className="shrink-0 px-4 py-3 border-t border-white/[0.07] flex items-center gap-2">
          <button onClick={runScan} title="Run the checks again" className="h-9 px-3 rounded-lg border border-white/[0.12] text-[12.5px] font-semibold text-white/70 hover:text-white hover:bg-white/[0.06] inline-flex items-center gap-1.5">
            <RefreshCw size={13} /> Rescan
          </button>
          <button onClick={() => fixMany(findings)} className={`flex-1 h-9 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center justify-center gap-1.5 transition ${AI_GRADIENT}`}>
            <Sparkles size={14} /> Auto-Fix all {findings.length}
          </button>
        </div>
      )}
    </aside>
  );
});

function FindingCard({ finding: f, onFocus, onFix, large = false }: { finding: Finding; onFocus: () => void; onFix: () => void; large?: boolean }) {
  const s = SEV[f.severity];
  return (
    <article className={`group rounded-xl border border-white/[0.07] bg-white/[0.025] ${s.hover} hover:bg-white/[0.04] transition-colors ${large ? "p-4" : "p-3.5"}`}>
      <div className="flex gap-3">
        <span className={`w-7 h-7 shrink-0 rounded-lg border flex items-center justify-center ${s.badge}`} title={s.label}>
          <s.Icon size={14} />
        </span>
        <div className="flex-1 min-w-0">
          <p className={`${large ? "text-[14px]" : "text-[13px]"} font-semibold text-white leading-snug break-words`}>{f.title}</p>
          <p className={`mt-1 ${large ? "text-[12.5px]" : "text-[12px]"} text-white/55 leading-relaxed break-words`}>{f.description}</p>
          <p className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/30">
            {s.label} · {f.category}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button onClick={onFocus} title="Pan and zoom to the tables involved" className="h-8 px-3 rounded-lg border border-white/[0.12] text-[12px] font-semibold text-white/75 hover:text-white hover:bg-white/[0.07] hover:border-white/[0.2] inline-flex items-center gap-1.5 transition-colors">
              <Crosshair size={13} /> Focus
            </button>
            <button onClick={onFix} title={f.fixLabel} className={`h-8 px-3 rounded-lg text-[12px] font-semibold text-white inline-flex items-center gap-1.5 transition ${AI_GRADIENT}`}>
              <Sparkles size={13} /> Auto-Fix
            </button>
          </div>
          <p className="mt-2 text-[11px] text-white/40 leading-snug">
            <span className="text-white/25">Fix:</span> {f.fixLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

function ScanningState({ tables }: { tables: number }) {
  return (
    <div className="py-16 flex flex-col items-center text-center" aria-live="polite">
      <span className="relative w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
        <ScanSearch size={24} className="text-[#9ab8ff]" />
        <span className="absolute inset-0 rounded-2xl border-2 border-transparent border-t-violet-400/70 animate-spin" />
      </span>
      <p className="mt-4 text-[13.5px] font-semibold text-white">Scanning {tables} table{tables === 1 ? "" : "s"}…</p>
      <p className="mt-1 text-[12px] text-white/45">Keys, types, normal forms, indexes, relationships and naming.</p>
    </div>
  );
}

/** "No active warnings" — one prominent action. */
function EmptyState({ tables, fixedCount, onScan }: { tables: number; fixedCount: number; onScan: () => void }) {
  return (
    <div className="py-12 flex flex-col items-center text-center">
      <span className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-400/25 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.12)]">
        <ShieldCheck size={28} className="text-emerald-300" />
      </span>
      <p className="mt-5 text-[16px] font-semibold text-white">{tables ? "No active warnings" : "Nothing to audit yet"}</p>
      <p className="mt-1.5 text-[12.5px] text-white/50 leading-relaxed max-w-[260px]">
        {tables
          ? `All ${RULE_COUNT} checks passed — keys, types, normal forms, indexes, relationships and naming.${fixedCount ? ` ${fixedCount} fix${fixedCount === 1 ? "" : "es"} applied this session.` : ""}`
          : "Add tables to the diagram, then scan it for design issues."}
      </p>
      <button onClick={onScan} className={`mt-6 h-11 px-6 rounded-xl text-[13.5px] font-semibold text-white inline-flex items-center gap-2 transition ${AI_GRADIENT}`}>
        <ScanSearch size={16} /> Run Full Scan
      </button>
    </div>
  );
}
