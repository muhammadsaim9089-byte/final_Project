"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { ArrowLeftRight, ArrowRight, GitBranch, LocateFixed, PenLine, Plus, Trash2, X } from "lucide-react";
import { isDepEdge, isTableNode } from "@/lib/model/canvasAdapter";
import { lineageStages, newDependency, type LineageResult } from "@/lib/model/lineage";
import { showToast } from "@/components/ui/toast";
import { requestCanvasDelete } from "../deleteRequest";
import { DrawerShell, drawerBtn, drawerBtnPrimary, drawerIconBtn, drawerInput, drawerSelect, type DiagramOps } from "./DrawerShell";

const labelOf = (n?: Node) => String((n?.data as any)?.label ?? n?.id ?? "");
const columnsOf = (n?: Node): string[] => (((n?.data as any)?.attributes as any[]) || []).map((a) => String(a.name));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface LineageDrawerProps {
  ops: DiagramOps;
  /** "Draw dependency": lines dragged on the canvas become dependencies instead of foreign keys */
  drawMode: boolean;
  setDrawMode: (on: boolean) => void;
  /** the table whose lineage is highlighted on the canvas, and what that trace covers */
  tracedTableId: string | null;
  lineage: LineageResult | null;
  onTrace: (tableId: string | null) => void;
  onShowEdge: (edgeId: string) => void;
  /** opened from the selection bar's "Link as dependency": the form starts with these two tables */
  prefill?: { from: string; to: string } | null;
  onClose: () => void;
}

/**
 * Data lineage (DBML `Dep`) as its own panel: a map of every table that takes part, in stages from sources to outputs
 * (click one to trace its whole upstream and downstream on the canvas), the list of dependencies with their columns and
 * notes, a "Draw dependency" mode for drawing them on the canvas, and a form for adding one by hand.
 */
export function LineageDrawer({ ops, drawMode, setDrawMode, tracedTableId, lineage, onTrace, onShowEdge, prefill, onClose }: LineageDrawerProps) {
  const { nodes, edges } = ops;
  const tables = useMemo(() => nodes.filter(isTableNode), [nodes]);
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const deps = useMemo(() => edges.filter(isDepEdge).filter((e) => byId.has(e.source) && byId.has(e.target)), [edges, byId]);
  const map = useMemo(() => lineageStages(deps), [deps]);
  const involved = map.stages.reduce((n, s) => n + s.length, 0);

  const [adding, setAdding] = useState(!!prefill);
  const [openRow, setOpenRow] = useState<string | null>(null);
  useEffect(() => {
    if (prefill) setAdding(true);
  }, [prefill]);

  const onEscape = useCallback(() => {
    if (drawMode) {
      setDrawMode(false);
      return true;
    }
    if (adding) {
      setAdding(false);
      return true;
    }
    if (openRow) {
      setOpenRow(null);
      return true;
    }
    return false;
  }, [drawMode, setDrawMode, adding, openRow]);

  return (
    <DrawerShell
      label="Data lineage"
      icon={<GitBranch size={17} />}
      title="Data lineage"
      subtitle={deps.length ? `${deps.length} ${deps.length === 1 ? "dependency" : "dependencies"} · ${plural(involved, "table")}` : "Where your data comes from and flows to"}
      onClose={onClose}
      onEscape={onEscape}
      toolbar={
        <div className="flex gap-2">
          <button
            onClick={() => setDrawMode(!drawMode)}
            disabled={tables.length < 1}
            aria-pressed={drawMode}
            className={`flex-1 h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold border transition-colors disabled:opacity-40 ${
              drawMode ? "bg-amber-500/20 border-amber-400/60 text-amber-200" : "bg-white/[0.04] border-white/[0.1] text-white/80 hover:bg-white/[0.08] hover:text-white"
            }`}
            title="Lines you drag between tables become dependencies instead of foreign keys"
          >
            <PenLine size={13} /> {drawMode ? "Drawing… (Esc to stop)" : "Draw dependency"}
          </button>
          <button onClick={() => setAdding((a) => !a)} disabled={tables.length < 1} aria-pressed={adding} className={`${drawerBtn} ${adding ? "!bg-white/[0.1] !text-white" : ""}`}>
            <Plus size={13} /> Add manually
          </button>
        </div>
      }
    >
      {drawMode && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-100/85">
          Drag from the <b className="text-amber-200">upstream</b> table to the <b className="text-amber-200">downstream</b> one — hover a column to drag from that column. The line becomes a dashed lineage arrow, not a foreign key.
        </div>
      )}

      {adding && <AddDependencyForm key={prefill ? `${prefill.from}>${prefill.to}` : "blank"} ops={ops} tables={tables} prefill={prefill} onDone={() => setAdding(false)} />}

      {deps.length === 0 ? (
        !adding && (
          <div className="rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center">
            <p className="text-[12.5px] font-semibold text-white/85">No dependencies yet</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-white/45">
              Lineage shows how data moves between tables — say <span className="font-mono text-white/60">orders → daily_revenue</span>. Turn on <b className="text-white/65">Draw dependency</b> and drag between tables, or add one manually.
            </p>
          </div>
        )
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Flow</span>
            {tracedTableId ? (
              <button onClick={() => onTrace(null)} className="text-[11px] text-amber-300 hover:underline">
                Clear trace · {labelOf(byId.get(tracedTableId))}
              </button>
            ) : (
              <span className="text-[10.5px] text-white/30">click a table to trace it</span>
            )}
          </div>
          <LineageMap stages={map.stages} links={map.links} byId={byId} traced={tracedTableId} lineage={lineage} onTrace={onTrace} />

          <div className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">Dependencies · {deps.length}</div>
          <div className="space-y-1.5">
            {deps.map((e) => (
              <DependencyRow key={e.id} edge={e} ops={ops} byId={byId} open={openRow === e.id} onToggle={() => setOpenRow(openRow === e.id ? null : e.id)} onShow={() => onShowEdge(e.id)} highlighted={!!lineage?.edgeIds.has(e.id)} />
            ))}
          </div>
        </>
      )}
    </DrawerShell>
  );
}

const CHIP_W = 92;
const CHIP_H = 26;
const COL_GAP = 24;
const ROW_GAP = 8;
const HEAD_H = 20;

function stageName(i: number, n: number): string {
  if (n === 1) return "Tables";
  if (i === 0) return "Sources";
  if (i === n - 1) return "Outputs";
  return n === 3 ? "Transforms" : `Stage ${i + 1}`;
}

/** The stage map: columns of table chips joined by curves, scrolling sideways when there are more than three stages. */
function LineageMap({
  stages,
  links,
  byId,
  traced,
  lineage,
  onTrace,
}: {
  stages: string[][];
  links: { id: string; source: string; target: string }[];
  byId: Map<string, Node>;
  traced: string | null;
  lineage: LineageResult | null;
  onTrace: (id: string | null) => void;
}) {
  const at = new Map<string, { x: number; y: number }>();
  stages.forEach((stage, i) => stage.forEach((t, row) => at.set(t, { x: i * (CHIP_W + COL_GAP), y: HEAD_H + row * (CHIP_H + ROW_GAP) })));
  const width = stages.length * CHIP_W + (stages.length - 1) * COL_GAP;
  const height = HEAD_H + Math.max(...stages.map((s) => s.length)) * (CHIP_H + ROW_GAP) - ROW_GAP;
  const lit = (id: string) => !!lineage?.columns.has(id);

  return (
    <div className="overflow-x-auto p-scrollbar rounded-xl border border-white/[0.07] bg-black/20 p-3">
      <div className="relative" style={{ width, height }}>
        {stages.map((_, i) => (
          <span key={i} className="absolute top-0 text-[10.5px] font-semibold uppercase tracking-wide text-white/35" style={{ left: i * (CHIP_W + COL_GAP), width: CHIP_W }}>
            {stageName(i, stages.length)}
          </span>
        ))}
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height} aria-hidden>
          {links.map((l) => {
            const a = at.get(l.source);
            const b = at.get(l.target);
            if (!a || !b) return null;
            const forward = b.x > a.x;
            const x1 = forward ? a.x + CHIP_W : a.x + CHIP_W / 2;
            const y1 = forward ? a.y + CHIP_H / 2 : a.y + CHIP_H;
            const x2 = forward ? b.x : b.x + CHIP_W / 2;
            const y2 = forward ? b.y + CHIP_H / 2 : b.y + CHIP_H;
            const d = forward ? `M${x1},${y1} C${x1 + COL_GAP / 2},${y1} ${x2 - COL_GAP / 2},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1},${y1 + 18} ${x2},${y2 + 18} ${x2},${y2}`; // same stage / back edge: a loop underneath
            const on = !!lineage?.edgeIds.has(l.id);
            return <path key={l.id} d={d} fill="none" stroke={on ? "#fbbf24" : lineage ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.55)"} strokeWidth={on ? 2 : 1.4} strokeDasharray={on ? undefined : "4 3"} />;
          })}
        </svg>
        {[...at.entries()].map(([id, p]) => {
          const isTraced = traced === id;
          const dim = !!lineage && !lit(id);
          return (
            <button
              key={id}
              onClick={() => onTrace(isTraced ? null : id)}
              title={`${labelOf(byId.get(id))} — ${isTraced ? "clear the trace" : "trace everything upstream and downstream of it"}`}
              className={`absolute truncate rounded-md border px-2 text-left text-[11px] font-mono transition-colors ${
                isTraced ? "bg-amber-500/25 border-amber-300 text-amber-100" : lit(id) ? "bg-amber-500/10 border-amber-400/60 text-amber-100" : "bg-[#101727] border-white/[0.12] text-white/80 hover:border-white/30"
              } ${dim ? "opacity-40" : ""}`}
              style={{ left: p.x, top: p.y, width: CHIP_W, height: CHIP_H }}
            >
              {labelOf(byId.get(id))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DependencyRow({ edge, ops, byId, open, onToggle, onShow, highlighted }: { edge: Edge; ops: DiagramOps; byId: Map<string, Node>; open: boolean; onToggle: () => void; onShow: () => void; highlighted: boolean }) {
  const d = (edge.data as any) || {};
  const a = byId.get(edge.source);
  const b = byId.get(edge.target);
  const patch = (p: Record<string, unknown>) => ops.commit({ edges: ops.edges.map((e) => (e.id === edge.id ? { ...e, data: { ...(e.data as any), ...p } } : e)) });
  const [note, setNote] = useState(String(d.note || ""));
  useEffect(() => setNote(String(d.note || "")), [d.note]);

  return (
    <div className={`rounded-lg border transition-colors ${highlighted ? "border-amber-400/50 bg-amber-500/[0.06]" : "border-white/[0.07] bg-white/[0.02]"}`}>
      <div className="flex items-center gap-1 pl-2.5 pr-1 py-1">
        {d.color && <span className="w-2 h-2 shrink-0 rounded-full" style={{ background: d.color }} />}
        <button onClick={onToggle} aria-expanded={open} className="min-w-0 flex-1 flex items-center gap-1.5 text-left text-[11.5px] font-mono py-1" title="Columns and note">
          <span className="truncate text-white/85">
            {labelOf(a)}
            {d.fromColumn ? <span className="text-white/45">.{d.fromColumn}</span> : null}
          </span>
          <ArrowRight size={12} className="shrink-0 text-amber-400/80" />
          <span className="truncate text-white/85">
            {labelOf(b)}
            {d.toColumn ? <span className="text-white/45">.{d.toColumn}</span> : null}
          </span>
        </button>
        <button onClick={onShow} className={drawerIconBtn} title="Show on the canvas" aria-label="Show this dependency on the canvas">
          <LocateFixed size={13} />
        </button>
        <button onClick={(e) => requestCanvasDelete({ edgeIds: [edge.id], anchor: e.currentTarget })} className={`${drawerIconBtn} hover:!text-red-300 hover:!bg-red-500/10`} title="Delete dependency" aria-label="Delete this dependency">
          <Trash2 size={13} />
        </button>
      </div>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <ColumnSelect label={`From ${labelOf(a)}`} value={String(d.fromColumn || "")} columns={columnsOf(a)} onChange={(v) => patch({ fromColumn: v })} />
            <ColumnSelect label={`Into ${labelOf(b)}`} value={String(d.toColumn || "")} columns={columnsOf(b)} onChange={(v) => patch({ toColumn: v })} />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== String(d.note || "") && patch({ note })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="How is it transformed? (note)"
            aria-label="Dependency note"
            className={drawerInput}
          />
        </div>
      )}
    </div>
  );
}

function ColumnSelect({ label, value, columns, onChange, disabled }: { label: string; value: string; columns: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="block min-w-0">
      <span className="block mb-1 truncate text-[10.5px] text-white/40">{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={drawerSelect}>
        <option value="">whole table</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddDependencyForm({ ops, tables, prefill, onDone }: { ops: DiagramOps; tables: Node[]; prefill?: { from: string; to: string } | null; onDone: () => void }) {
  const [draft, setDraft] = useState({ from: prefill?.from || "", fromColumn: "", to: prefill?.to || "", toColumn: "" });
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(tables.map((t) => [t.id, t]));
  const set = (p: Partial<typeof draft>) => {
    setError(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const add = () => {
    const res = newDependency(ops.nodes, ops.edges, draft);
    if ("error" in res) return setError(res.error);
    ops.commit({ edges: [...ops.edges, res.edge] });
    showToast(`Lineage added: ${labelOf(byId.get(draft.from))} → ${labelOf(byId.get(draft.to))}`, "success");
    onDone();
  };

  const tableSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="block min-w-0">
      <span className="block mb-1 text-[10.5px] text-white/40">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={drawerSelect}>
        <option value="">Table…</option>
        {tables.map((t) => (
          <option key={t.id} value={t.id}>
            {labelOf(t)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/[0.04] p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-white">New dependency</span>
        <button onClick={onDone} className={drawerIconBtn} aria-label="Cancel new dependency">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        {tableSelect(draft.from, (v) => set({ from: v, fromColumn: "" }), "Upstream (data comes from)")}
        <button
          onClick={() => set({ from: draft.to, fromColumn: draft.toColumn, to: draft.from, toColumn: draft.fromColumn })}
          className={`${drawerIconBtn} mb-0.5`}
          title="Swap direction"
          aria-label="Swap upstream and downstream"
        >
          <ArrowLeftRight size={13} />
        </button>
        {tableSelect(draft.to, (v) => set({ to: v, toColumn: "" }), "Downstream (flows into)")}
        <ColumnSelect label="column" value={draft.fromColumn} columns={columnsOf(byId.get(draft.from))} disabled={!draft.from} onChange={(v) => set({ fromColumn: v })} />
        <span />
        <ColumnSelect label="column" value={draft.toColumn} columns={columnsOf(byId.get(draft.to))} disabled={!draft.to} onChange={(v) => set({ toColumn: v })} />
      </div>
      {error && <p className="text-[11.5px] text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className={drawerBtn}>
          Cancel
        </button>
        <button onClick={add} className={drawerBtnPrimary}>
          <GitBranch size={13} /> Add dependency
        </button>
      </div>
    </div>
  );
}
