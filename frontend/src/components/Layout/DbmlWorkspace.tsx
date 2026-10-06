"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, MessageSquareCode, RefreshCw, Sparkles, X } from "lucide-react";
import { useLayout, AiProposalView } from "./LayoutContext";
import { DbmlCodeEditor, DbmlEditorHandle, EditorSchemaInfo } from "./DbmlCodeEditor";
import { parseDbml } from "@/lib/dbml/parser";
import { modelToDbml } from "@/lib/dbml/serializer";
import { dialectFromDbmlName, typesForDialect } from "@/lib/sql/dialects";
import { showToast } from "@/components/ui/toast";
import { diffLines, diffStats } from "@/lib/model/diff";

/**
 * The full-size twin of the diff shown in the AI chat: the same proposal, but with the whole file visible and
 * its own Accept/Reject (dbdiagram.io shows the diff both places too — review it wherever you're already looking).
 */
function AiDiffOverlay({ proposal }: { proposal: AiProposalView }) {
  const ops = useMemo(() => diffLines(proposal.before, proposal.after), [proposal.before, proposal.after]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/[0.08] bg-white/[0.03] shrink-0">
        <span className="flex items-center gap-2 min-w-0">
          <Sparkles size={13} className="text-[#4A90D9] shrink-0" />
          <span className="text-[11.5px] font-semibold text-white/85 truncate" title={proposal.label}>{proposal.label}</span>
        </span>
        <span className="text-[10px] font-mono shrink-0">
          <span className="text-emerald-400">+{stats.added}</span> <span className="text-red-400 ml-1.5">−{stats.removed}</span>
        </span>
      </div>

      <div className="flex-1 overflow-auto code-scroll font-mono text-[12px] leading-[1.6]">
        {ops.map((o, i) => (
          <div key={i} className={`flex px-2 whitespace-pre ${o.type === "add" ? "bg-emerald-500/[0.1]" : o.type === "del" ? "bg-red-500/[0.1]" : ""}`}>
            <span className="select-none inline-block w-9 shrink-0 text-right pr-2 text-white/25">{o.type === "del" ? o.aLine : o.bLine}</span>
            <span className="select-none inline-block w-3 shrink-0 text-white/30">{o.type === "add" ? "+" : o.type === "del" ? "−" : ""}</span>
            <span className={o.type === "add" ? "text-emerald-200" : o.type === "del" ? "text-red-200/75 line-through decoration-red-400/40" : "text-white/65"}>{o.text || " "}</span>
          </div>
        ))}
      </div>

      {proposal.changes.length > 0 && (
        <div className="shrink-0 border-t border-white/[0.08] bg-white/[0.02] px-3 py-2 max-h-24 overflow-y-auto code-scroll">
          <span className="text-[9px] uppercase tracking-wider font-bold text-white/35 block mb-1">Schema changes</span>
          <ul className="text-[10.5px] text-white/55 space-y-0.5 list-disc pl-4">
            {proposal.changes.slice(0, 20).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="shrink-0 flex gap-2 px-3 py-2.5 border-t border-white/[0.08] bg-[#181a1f]">
        <button onClick={() => proposal.resolve(true)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#4A90D9] text-white text-[12px] font-bold hover:bg-[#5ba0e9] transition-colors">
          <Check size={13} /> Accept
        </button>
        <button onClick={() => proposal.resolve(false)} className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.1] text-[12px] font-medium transition-colors">
          <X size={13} /> Reject
        </button>
      </div>
    </div>
  );
}

/**
 * DBML code workspace: type DBML and the diagram follows (and the other way round).
 * Powered by CodeMirror with highlighting, folding, autocomplete, comment toggling and live diagnostics.
 */
export function DbmlWorkspace() {
  const layout = useLayout();
  const editorRef = useRef<DbmlEditorHandle>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [showProblems, setShowProblems] = useState(true);
  const [pending, setPending] = useState(false);

  const parsed = useMemo(() => parseDbml(layout.dbmlText), [layout.dbmlText]);
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  const warnings = parsed.diagnostics.filter((d) => d.severity === "warning");

  // publish diagnostics so other parts of the UI (status bar, toasts) can see them
  useEffect(() => {
    layout.setDbmlDiagnostics(parsed.diagnostics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  // brief "applying…" indicator while the debounced canvas update is pending
  useEffect(() => {
    setPending(true);
    const t = setTimeout(() => setPending(false), 900);
    return () => clearTimeout(t);
  }, [layout.dbmlText]);

  const dialect = dialectFromDbmlName(parsed.model.project.databaseType) || dialectFromDbmlName(layout.meta.project.databaseType);
  const schema: EditorSchemaInfo = useMemo(
    () => ({
      tables: parsed.model.tables.map((t) => ({ name: t.name, alias: t.alias, schema: t.schema, columns: t.columns.map((c) => c.name) })),
      enums: parsed.model.enums.map((e) => e.name),
      types: typesForDialect(dialect),
      partials: Array.from(layout.dbmlText.matchAll(/^\s*TablePartial\s+("?[\w ]+"?)/gim)).map((m) => m[1].replace(/"/g, "")),
    }),
    [parsed, dialect, layout.dbmlText]
  );

  const handleRegenerate = () => {
    const api = layout.getCanvasApi();
    if (!api) return;
    layout.setDbmlText(modelToDbml(api.getModel()));
    showToast("Editor refreshed from the diagram", "success");
  };

  const btn = "flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30";

  return (
    <div className="flex-1 flex flex-col gap-2 min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => editorRef.current?.toggleComment()} disabled={!!layout.aiProposal} className={btn} title="Toggle line comment (Ctrl+/)">
            <MessageSquareCode size={11} />
          </button>
          <button onClick={handleRegenerate} disabled={!!layout.aiProposal} className={btn} title="Rewrite the code from the current diagram">
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      <div className={`relative flex-1 flex flex-col rounded-xl overflow-hidden border ${errors.length ? "border-red-500/40" : "border-white/[0.06]"} bg-[#1e1e1e] min-h-0`}>
        {layout.aiProposal ? (
          <AiDiffOverlay proposal={layout.aiProposal} />
        ) : (
          <DbmlCodeEditor
            ref={editorRef}
            value={layout.dbmlText}
            onChange={layout.editDbml}
            diagnostics={parsed.diagnostics}
            schema={schema}
            reveal={layout.reveal}
            onNavigate={layout.focusTableFromEditor}
            onCursor={(line, col) => setCursor({ line, col })}
          />
        )}
      </div>

      {!layout.aiProposal && (errors.length > 0 || warnings.length > 0) && (
        <div className="shrink-0 rounded-xl border border-white/[0.06] bg-[#252526] overflow-hidden">
          <button onClick={() => setShowProblems((s) => !s)} className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/[0.03]">
            <span className="flex items-center gap-2">
              <AlertTriangle size={11} className={errors.length ? "text-red-400" : "text-amber-400"} />
              {errors.length} error{errors.length !== 1 ? "s" : ""} · {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
            </span>
            <span className="text-white/30">{showProblems ? "hide" : "show"}</span>
          </button>
          {showProblems && (
            <div className="max-h-28 overflow-y-auto p-scrollbar border-t border-white/[0.04]">
              {parsed.diagnostics.slice(0, 40).map((d, i) => (
                <button key={i} onClick={() => editorRef.current?.jumpToLine(d.line, d.col)} className="w-full text-left flex items-start gap-2 px-3 py-1 text-[11px] hover:bg-white/[0.04]">
                  <span className={`shrink-0 font-mono ${d.severity === "error" ? "text-red-400" : "text-amber-400"}`}>{d.line}:{d.col}</span>
                  <span className="text-white/70">{d.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-white/35 font-mono shrink-0 pb-1">
        <span className="flex items-center gap-1.5">
          {layout.aiProposal ? (
            <>
              <Sparkles size={10} className="text-[#4A90D9]" /> reviewing an AI proposal — accept or reject above
            </>
          ) : errors.length ? (
            <>
              <AlertTriangle size={10} className="text-red-400" /> fix errors to update the diagram
            </>
          ) : pending ? (
            <>
              <Loader2 size={10} className="animate-spin text-[#4A90D9]" /> syncing
            </>
          ) : (
            <>
              <CheckCircle2 size={10} className="text-[#9be7a6]" /> in sync
            </>
          )}
        </span>
        <span>
          {parsed.model.tables.length} tables · {parsed.model.refs.length} refs · Ln {cursor.line}, Col {cursor.col}
        </span>
      </div>
    </div>
  );
}
