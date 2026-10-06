"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { PlusSquare, Component, X, Trash2, Key, Settings, ArrowRight, Eye, EyeOff, Search, Layers, ChevronDown, ChevronRight, Plus, MoreVertical, Table2, Pencil, CopyPlus, Check, StickyNote, GitBranch, Group, Ungroup, Palette, Code2, Link2, MousePointerClick, Rows3, Hash, ShieldCheck } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { parseDbml } from "@/lib/dbml/parser";
import { isDepEdge, isTableNode, nodeKey, normalizeRelType } from "@/lib/model/canvasAdapter";
import { confirmAction } from "@/components/ui/confirm";
import { requestCanvasDelete } from "./deleteRequest";
import { GROUP_NODE_PREFIX, activeView, groupNameFromId, isGroupNodeId, isTableInView } from "@/lib/model/displayGraph";
import { DiagramViewModel, ProjectMeta, rekeyViews, slugify } from "@/lib/model/types";
import { SQL_DIALECTS } from "@/lib/sql/dialects";
import { assignGroup, gatherGroup, ungroupTables } from "@/lib/model/groups";

/** Width of the Inspect drawer — the canvas moves its minimap / floating chat box out of the way by this much. */
export const INSPECT_DRAWER_WIDTH = 380;

const FONT_OPTIONS = ["Vagnola Regular", "Inter", "JetBrains Mono", "Roboto", "Fira Code"];
const PALETTE = ["#B8A9E8", "#6EE7B7", "#FCA5A5", "#FCD34D", "#7DD3FC", "#F9A8D4", "#BEF264", "#94A3B8"];
const NOTE_COLORS = ["#fcd34d", "#7dd3fc", "#6ee7b7", "#f9a8d4", "#c4b5fd"];
const ON_ACTIONS = ["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT"];
const CARDINALITY = [
  { type: "one-to-one", label: "1 : 1", hint: "One-to-one" },
  { type: "one-to-many", label: "1 : N", hint: "One-to-many" },
  { type: "many-to-many", label: "N : M", hint: "Many-to-many" },
];

const SINGLE_TABLE_PRESETS: { id: string; label: string; dbml: string }[] = [
  {
    id: "users",
    label: "Users",
    dbml: "Table users {\n  id integer [pk, increment]\n  name varchar(255) [not null]\n  email varchar(255) [unique, not null]\n  password_hash varchar(255) [not null]\n  created_at timestamp [default: `now()`]\n}",
  },
  {
    id: "products",
    label: "Products",
    dbml: "Table products {\n  id integer [pk, increment]\n  name varchar(255) [not null]\n  description text\n  price decimal(10,2) [not null]\n  stock integer [default: 0]\n  created_at timestamp [default: `now()`]\n}",
  },
  {
    id: "audit_log",
    label: "Audit log",
    dbml: "Table audit_log {\n  id integer [pk, increment]\n  actor varchar(120)\n  action varchar(60) [not null]\n  entity varchar(120)\n  payload text\n  created_at timestamp [default: `now()`]\n}",
  },
];

// ───────────────────────── shared style tokens ─────────────────────────
const inputCls = "w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.05] transition-all";
const selectCls = "w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-2.5 py-2 text-xs text-white outline-none cursor-pointer focus:border-[#4A90D9]/50 transition-all";
const btnPrimary = "w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl bg-[#4A90D9] text-white hover:bg-[#5ba0e9] transition-all shadow-lg shadow-[#4A90D9]/15 disabled:opacity-40 disabled:cursor-not-allowed";
const btnSoft = "flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 hover:bg-white/[0.08] hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed";
const btnDanger = "flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all";
const labelCls = "text-[10px] text-white/45 uppercase tracking-wide font-semibold block mb-1";

type Snap = { nodes?: Node[]; edges?: Edge[]; meta?: ProjectMeta };

interface UnifiedSidebarProps {
  nodes: Node[];
  setNodes: any;
  edges: Edge[];
  setEdges: any;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  onAutoLayout: () => void;
  generatedSql?: string;
  activeTab: "add" | "inspector" | "views";
  setActiveTab: (tab: "add" | "inspector" | "views") => void;
  onClose: () => void;
  sqlDialect: string;
  setSqlDialect: (dialect: string) => void;
  takeSnapshot: (override?: Snap) => void;
  onFocusNode?: (nodeId: string) => void;
  onOpenTableEditor?: (id: string | "new") => void;
}

/** Everything a panel needs to change the diagram: state, meta and one undo-aware `commit`. */
interface Ops {
  nodes: Node[];
  edges: Edge[];
  meta: ProjectMeta;
  commit: (next: Snap) => void;
  /** Live update without an undo step (typing, dragging a colour picker). */
  live: (next: Snap) => void;
  snapshot: () => void;
  patchNode: (id: string, patch: Record<string, any>, snapshot?: boolean) => void;
  uniqueName: (base: string, schema?: string) => string;
  focus: (id: string) => void;
}

const newId = (prefix: string) => (typeof crypto !== "undefined" && crypto.randomUUID ? `${prefix}_${crypto.randomUUID().slice(0, 8)}` : `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

function groupNames(nodes: Node[], meta: ProjectMeta): string[] {
  const set = new Set<string>(Object.keys(meta.groups));
  for (const n of nodes) if (isTableNode(n) && (n.data as any).group) set.add(String((n.data as any).group));
  return Array.from(set).filter((g) => nodes.some((n) => isTableNode(n) && (n.data as any).group === g)).sort((a, b) => a.localeCompare(b));
}

// ───────────────────────── small UI pieces ─────────────────────────
function SectionTitle({ children, badge }: { children: React.ReactNode; badge?: string }) {
  return (
    <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
      <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">{children}</span>
      {badge && <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">{badge}</span>}
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t border-white/[0.04] first:border-t-0">
      <div className="min-w-0">
        <span className="text-[11px] text-white/75 font-semibold tracking-wide block">{label}</span>
        {hint && <span className="text-[10px] text-white/35 block leading-snug">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`shrink-0 w-9 h-5 rounded-full transition-all relative border border-white/[0.06] shadow-inner ${on ? "bg-[#4A90D9] border-[#4A90D9]/20" : "bg-white/5 hover:bg-white/10"}`}
      >
        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ease-out shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${on ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/60"}`} />
      </button>
    </div>
  );
}

/** Text input that commits on blur / Enter (Esc cancels) so typing does not create an undo step per key. */
function CommitInput({ value, onCommit, placeholder, list, mono, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; list?: string; mono?: boolean; className?: string }) {
  const [v, setV] = useState(value);
  const cancel = useRef(false);
  useEffect(() => setV(value), [value]);
  return (
    <input
      value={v}
      list={list}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (cancel.current) cancel.current = false;
        else if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancel.current = true;
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
      className={`${inputCls} ${mono ? "font-mono" : ""} ${className || ""}`}
    />
  );
}

function CommitTextarea({ value, onCommit, placeholder, rows = 3 }: { value: string; onCommit: (v: string) => void; placeholder?: string; rows?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${inputCls} resize-none p-scrollbar`}
    />
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (hex: string, final: boolean) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PALETTE.map((hex) => {
        const selected = value.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            title={hex}
            aria-label={`Colour ${hex}`}
            onClick={() => onChange(selected ? "" : hex, true)}
            className={`w-5 h-5 rounded-full border-2 transition-all ${selected ? "border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.3)]" : "border-white/10 hover:border-white/40 hover:scale-105"}`}
            style={{ backgroundColor: hex }}
          />
        );
      })}
      <label className="relative w-5 h-5 rounded-full border border-dashed border-white/25 hover:border-white/50 flex items-center justify-center cursor-pointer overflow-hidden transition-all" title="Custom colour">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#6a5fc1"}
          onChange={(e) => onChange(e.target.value, false)}
          onBlur={() => onChange(value, true)}
          className="absolute inset-0 opacity-0 cursor-pointer scale-150"
        />
        <span className="text-[10px] text-white/40 pointer-events-none">+</span>
      </label>
      {value && (
        <button type="button" title="Clear colour" onClick={() => onChange("", true)} className="w-5 h-5 rounded-full border border-dashed border-white/20 text-[9px] text-white/35 hover:text-white/70 hover:border-white/40 transition-all">
          ✕
        </button>
      )}
    </div>
  );
}

// ───────────────────────── INSPECT: shared shell ─────────────────────────
// One anatomy for every selection kind — icon + kind + live label, an "identity" card for the fields you
// touch most, contextual content, rarely-used fields tucked behind "Advanced", and a footer for the one
// destructive action. Consistency here is what makes the panel scannable: you learn it once.

/** Icon + kind + live label at the top of every Inspect view, so the selection is confirmed at a glance. */
function PanelHeader({ icon, kind, label }: { icon: React.ReactNode; kind: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-3 border-b border-white/[0.06]">
      <div className="w-8 h-8 rounded-lg bg-[#4A90D9]/10 border border-[#4A90D9]/20 flex items-center justify-center text-[#4A90D9] shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[9.5px] uppercase tracking-wider font-bold text-white/40 leading-none mb-0.5">{kind}</div>
        <div className="text-[13px] font-semibold text-white/90 truncate leading-tight" title={label}>
          {label || "—"}
        </div>
      </div>
    </div>
  );
}

/** Groups related fields into one card. An untitled group is the subject's "identity" — its primary fields. */
function FieldGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
      {title && <span className="text-[10px] uppercase tracking-wider font-bold text-white/40 block">{title}</span>}
      {children}
    </div>
  );
}

/** Fields that are rarely touched — collapsed by default so the common case stays scannable. */
function Disclosure({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-white/[0.015] hover:bg-white/[0.035] transition-colors">
        <span className="text-[11px] font-semibold text-white/65">{title}</span>
        <span className="flex items-center gap-1.5">
          {hint && !open && <span className="text-[9.5px] text-white/30 normal-case font-normal">{hint}</span>}
          {open ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        </span>
      </button>
      {open && <div className="p-3 pt-2.5 space-y-3 border-t border-white/[0.06]">{children}</div>}
    </div>
  );
}

/** A small read-only count, e.g. 12 columns. */
function StatChip({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-white/40" title={`${value} ${label}`}>
      {icon}
      <span className="text-white/70 font-mono font-bold">{value}</span>
    </span>
  );
}

/** The bottom action row (duplicate / delete / ungroup) — always last, set off by a divider. */
function FooterActions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 pt-3 border-t border-white/[0.06]">{children}</div>;
}

// ───────────────────────── ADD TAB ─────────────────────────
function AddPanel({ ops, onOpenTableEditor }: { ops: Ops; onOpenTableEditor?: (id: string | "new") => void }) {
  const layout = useLayout();

  // a ready-made table, renamed if the name is taken, merged in where it is and brought into view
  const addPreset = (dbml: string) => {
    const api = layout.getCanvasApi();
    if (!api) return;
    const { model } = parseDbml(dbml);
    if (!model.tables.length) return;
    model.tables[0].name = ops.uniqueName(model.tables[0].name, model.tables[0].schema);
    const name = model.tables[0].name;
    api.applyModel(model, { mode: "merge", layout: "keep", fit: false });
    showToast(`Added table “${name}”`, "success");
    setTimeout(() => api.focusTable(name), 350);
  };

  return (
    <div className="space-y-5 flex flex-col">
      <div className="space-y-3">
        <SectionTitle badge="Table">New table</SectionTitle>
        {onOpenTableEditor && (
          <button onClick={() => onOpenTableEditor("new")} className={btnPrimary}>
            <PlusSquare size={14} /> Open Table Editor
          </button>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          {SINGLE_TABLE_PRESETS.map((p) => (
            <button key={p.id} onClick={() => addPreset(p.dbml)} className={btnSoft} title={`Add a ready-made “${p.label}” table`}>
              <Table2 size={11} /> {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-white/35 leading-snug">
        Table groups and data lineage have their own panels in the second row (next to Enums); sticky notes are in the bottom toolbar.
      </p>
    </div>
  );
}

// ───────────────────────── INSPECT: table ─────────────────────────
function TableInspector({ node, ops, onOpenTableEditor }: { node: Node; ops: Ops; onOpenTableEditor?: (id: string | "new") => void }) {
  const layout = useLayout();
  const { nodes, meta } = ops;
  const d = node.data as any;
  const attrs: any[] = d.attributes || [];
  const indexes: any[] = d.indexes || [];
  const constraints: any[] = d.constraints || [];
  const schemas = Array.from(new Set(nodes.filter(isTableNode).map((n) => String((n.data as any).schema || "")).filter(Boolean)));
  const groups = groupNames(nodes, meta);

  const rename = (value: string) => {
    const next = value.trim();
    if (!next || next === d.label) return;
    if (nodes.some((n) => n.id !== node.id && isTableNode(n) && String((n.data as any).label).toLowerCase() === next.toLowerCase() && String((n.data as any).schema || "") === String(d.schema || ""))) {
      showToast(`A table named “${next}” already exists`, "error");
      return;
    }
    const old = String(d.label);
    const oldKey = nodeKey(node);
    const newKey = nodeKey({ ...node, data: { ...d, label: next } });
    const nextNodes = nodes.map((n) => {
      if (n.id === node.id) return { ...n, data: { ...n.data, label: next } };
      if (!isTableNode(n)) return n;
      const at: any[] = (n.data as any).attributes || [];
      return at.some((a) => a.fkRefTable === old) ? { ...n, data: { ...n.data, attributes: at.map((a) => (a.fkRefTable === old ? { ...a, fkRefTable: next } : a)) } } : n;
    });
    ops.commit({ nodes: nextNodes, meta: rekeyViews(meta, oldKey, newKey) });
  };

  const setSchema = (value: string) => {
    const next = value.trim();
    if (next === String(d.schema || "")) return;
    const oldKey = nodeKey(node);
    const newKey = nodeKey({ ...node, data: { ...d, schema: next } });
    ops.commit({ nodes: nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, schema: next } } : n)), meta: rekeyViews(meta, oldKey, newKey) });
  };

  const setGroup = (value: string) => {
    const next = value.trim();
    if (next === String(d.group || "")) return;
    const nextMeta = next && !meta.groups[next] ? { ...meta, groups: { ...meta.groups, [next]: { color: PALETTE[Object.keys(meta.groups).length % PALETTE.length] } } } : meta;
    // gathered when the frame would otherwise cover other tables; a table leaving a group is moved clear of its frame
    ops.commit({ nodes: next ? gatherGroup(assignGroup(nodes, [node.id], next), nextMeta, next) : ungroupTables(nodes, [node.id]), meta: nextMeta });
  };

  const duplicate = () => {
    const data = JSON.parse(JSON.stringify(d));
    data.label = ops.uniqueName(`${d.label}_copy`, d.schema);
    data.spotlightActive = false;
    // a copy has no relationships, so it must not carry foreign-key badges either
    data.attributes = (data.attributes || []).map((a: any) => ({ ...a, isFk: false, fkRefTable: "", fkRefField: "" }));
    const copy: Node = { id: newId("tbl"), type: "tableMode", position: { x: node.position.x + 48, y: node.position.y + 48 }, sourcePosition: node.sourcePosition, targetPosition: node.targetPosition, data };
    ops.commit({ nodes: [...nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...copy, selected: true }] });
    showToast(`Duplicated as “${data.label}”`, "success");
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PanelHeader icon={<Table2 size={15} />} kind="Table" label={String(d.label || "")} />

      <FieldGroup>
        <div>
          <span className={labelCls}>Name</span>
          <CommitInput value={String(d.label || "")} onCommit={rename} mono />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className={labelCls}>Schema</span>
            <CommitInput value={String(d.schema || "")} onCommit={setSchema} placeholder="public" list="sb-schemas" mono />
            <datalist id="sb-schemas">{schemas.map((s) => <option key={s} value={s} />)}</datalist>
          </div>
          <div>
            <span className={labelCls}>Group</span>
            <CommitInput value={String(d.group || "")} onCommit={setGroup} placeholder="none" list="sb-groups" />
            <datalist id="sb-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
        </div>
        <div>
          <span className={labelCls}>Header colour</span>
          <Swatches value={String(d.color || "")} onChange={(hex, final) => ops.patchNode(node.id, { color: hex }, final)} />
        </div>
        <div>
          <span className={labelCls}>Note</span>
          <CommitTextarea value={String(d.comment || "")} onCommit={(v) => ops.patchNode(node.id, { comment: v })} placeholder="What is this table for?" rows={2} />
        </div>
      </FieldGroup>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider font-bold text-white/40">Columns</span>
          <div className="flex items-center gap-2.5">
            <StatChip icon={<Rows3 size={10} />} value={attrs.length} label="columns" />
            {indexes.length > 0 && <StatChip icon={<Hash size={10} />} value={indexes.length} label="indexes" />}
            {constraints.length > 0 && <StatChip icon={<ShieldCheck size={10} />} value={constraints.length} label="checks" />}
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04] max-h-[200px] overflow-y-auto p-scrollbar">
          {attrs.length === 0 ? (
            <div className="text-xs text-white/30 italic py-3 text-center">No columns defined.</div>
          ) : (
            attrs.map((a, i) => (
              <div key={`${a.name}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
                {a.isPk ? <Key size={11} className="text-yellow-400 shrink-0" /> : <span className="w-[11px] shrink-0" />}
                <span className="flex-1 text-[11px] text-white/80 font-mono truncate">{a.name}</span>
                <span className="text-[10px] text-white/35 font-mono truncate max-w-[80px] shrink-0">{a.type}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {a.isFk && <span title="Foreign key" className="text-[8.5px] font-bold text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/25 rounded px-1 leading-[14px]">FK</span>}
                  {a.unique && !a.isPk && <span title="Unique" className="text-[8.5px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded px-1 leading-[14px]">UQ</span>}
                  {a.allowNull === false && !a.isPk && <span title="Not null" className="text-[8.5px] font-bold text-white/50 bg-white/[0.06] border border-white/10 rounded px-1 leading-[14px]">NN</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {onOpenTableEditor && (
        <button onClick={() => onOpenTableEditor(node.id)} className={btnPrimary}>
          <Pencil size={12} /> Edit columns, keys &amp; indexes
        </button>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={() => window.dispatchEvent(new CustomEvent("open-sample-data-modal", { detail: { id: node.id } }))} className={btnSoft}>
          <Table2 size={12} /> Sample data{Array.isArray(d.seedData) && d.seedData.length ? ` (${d.seedData.length})` : ""}
        </button>
        <button onClick={() => layout.revealInEditor(String(d.label))} className={btnSoft}>
          <Code2 size={12} /> Show in DBML
        </button>
      </div>

      <FooterActions>
        <button onClick={duplicate} className={`${btnSoft} flex-1`}>
          <CopyPlus size={12} /> Duplicate
        </button>
        <button
          onClick={(e) => requestCanvasDelete({ nodeIds: [node.id], anchor: e.currentTarget })}
          className={`${btnDanger} flex-1`}
        >
          <Trash2 size={12} /> Delete
        </button>
      </FooterActions>
    </div>
  );
}

// ───────────────────────── INSPECT: relationship ─────────────────────────
function RefInspector({ edge, ops, onDeselect }: { edge: Edge; ops: Ops; onDeselect: () => void }) {
  const { nodes, edges } = ops;
  const parent = nodes.find((n) => n.id === edge.source);
  const child = nodes.find((n) => n.id === edge.target);
  const d = (edge.data as any) || {};
  const type = normalizeRelType(d.relationshipType);
  const pCol: string = d.sourceColumn || d.referencedKey || "";
  const cCol: string = d.targetColumn || d.foreignKey || "";
  const composite = (d.sourceColumns?.length ?? 0) > 1 || (d.targetColumns?.length ?? 0) > 1;
  const pCols: string[] = (((parent?.data as any)?.attributes as any[]) || []).map((a) => a.name);
  const cCols: string[] = (((child?.data as any)?.attributes as any[]) || []).map((a) => a.name);
  const parentLabel = String((parent?.data as any)?.label ?? edge.source);
  const childLabel = String((child?.data as any)?.label ?? edge.target);

  const patch = (p: Record<string, any>, final = true) => {
    const next = edges.map((e) => (e.id === edge.id ? { ...e, data: { ...(e.data as any), ...p } } : e));
    (final ? ops.commit : ops.live)({ edges: next });
  };

  const setMapping = (which: "parent" | "child", col: string) => {
    const nextP = which === "parent" ? col : pCol;
    const nextC = which === "child" ? col : cCol;
    let nextNodes = nodes;
    if (child && parent) {
      const usedElsewhere = (c: string) => edges.some((e) => e.id !== edge.id && !isDepEdge(e) && e.target === child.id && ((e.data as any)?.targetColumn || (e.data as any)?.foreignKey) === c);
      nextNodes = nodes.map((n) => {
        if (n.id !== child.id) return n;
        const at: any[] = (n.data as any).attributes || [];
        return {
          ...n,
          data: {
            ...n.data,
            attributes: at.map((a) => {
              if (a.name === nextC) return { ...a, isFk: true, fkRefTable: String((parent.data as any).label), fkRefField: nextP, fkRelationType: a.fkRelationType || "Many to One" };
              if (a.name === cCol && !usedElsewhere(cCol)) return { ...a, isFk: false, fkRefTable: "", fkRefField: "" };
              return a;
            }),
          },
        };
      });
    }
    const nextEdges = edges.map((e) => (e.id === edge.id ? { ...e, data: { ...(e.data as any), sourceColumn: nextP, referencedKey: nextP, targetColumn: nextC, foreignKey: nextC, sourceColumns: undefined, targetColumns: undefined } } : e));
    ops.commit({ nodes: nextNodes, edges: nextEdges });
  };

  // confirms by name, deletes (the FK column loses its marking when nothing else uses it), one undo step
  const remove = (e: React.MouseEvent<HTMLElement>) => requestCanvasDelete({ edgeIds: [edge.id], anchor: e.currentTarget, onDone: (ok) => ok && onDeselect() });

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PanelHeader icon={<Link2 size={15} />} kind="Relationship" label={`${parentLabel} → ${childLabel}`} />

      <FieldGroup>
        <div className="flex items-center justify-between text-[10px] text-white/40">
          <span>Parent · referenced</span>
          <span>Child · holds the FK</span>
        </div>
        <div className="flex items-center justify-between font-bold font-mono gap-2 text-[12px]">
          <span className="text-yellow-400 truncate">{parentLabel}{pCol ? `.${pCol}` : ""}</span>
          <ArrowRight size={12} className="text-[#4A90D9] shrink-0" />
          <span className="text-sky-400 truncate text-right">{childLabel}{cCol ? `.${cCol}` : ""}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 pt-0.5">
          {CARDINALITY.map((c) => (
            <button key={c.type} title={c.hint} onClick={() => patch({ relationshipType: c.type })} className={`py-2 text-[11px] font-bold border rounded-lg transition-all ${type === c.type ? "bg-[#4A90D9]/15 border-[#4A90D9]/40 text-white shadow-inner" : "bg-white/[0.01] border-white/[0.06] text-white/50 hover:text-white"}`}>
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-white/35">{CARDINALITY.find((c) => c.type === type)?.hint}. Many-to-many is exported through a junction table.</p>
      </FieldGroup>

      <FieldGroup title="Appearance">
        <div>
          <span className={labelCls}>Name</span>
          <CommitInput value={String(d.name || "")} onCommit={(v) => patch({ name: v })} placeholder="fk_orders_users" mono />
        </div>
        <div>
          <span className={labelCls}>Line colour</span>
          <Swatches value={String(d.color || "")} onChange={(hex, final) => patch({ color: hex }, final)} />
        </div>
      </FieldGroup>

      <Disclosure title="Advanced" hint="mapping · actions · optionality">
        {type !== "many-to-many" && (
          <div className="space-y-1.5">
            <span className={labelCls}>Key mapping</span>
            {composite ? (
              <p className="text-[10px] text-white/45 bg-white/[0.02] border border-white/[0.05] rounded-lg p-2.5 font-mono">
                Composite: ({(d.sourceColumns || [pCol]).join(", ")}) → ({(d.targetColumns || [cCol]).join(", ")}). Edit it in the DBML editor.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 bg-[#040810]/40 border border-white/[0.04] p-2.5 rounded-xl">
                <div>
                  <span className="text-[9px] text-white/40 uppercase block mb-1">Parent column</span>
                  <select value={pCol} onChange={(e) => setMapping("parent", e.target.value)} className={selectCls}>
                    {!pCols.includes(pCol) && <option value={pCol}>{pCol || "—"}</option>}
                    {pCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <span className="text-[9px] text-white/40 uppercase block mb-1">Child column</span>
                  <select value={cCol} onChange={(e) => setMapping("child", e.target.value)} className={selectCls}>
                    {!cCols.includes(cCol) && <option value={cCol}>{cCol || "—"}</option>}
                    {cCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {type !== "many-to-many" && (
          <div className="space-y-1.5">
            <span className={labelCls}>Referential actions</span>
            <div className="grid grid-cols-2 gap-2 bg-[#040810]/40 border border-white/[0.04] p-2.5 rounded-xl">
              {(["onDelete", "onUpdate"] as const).map((k) => (
                <div key={k}>
                  <span className="text-[9px] text-white/40 uppercase block mb-1">{k === "onDelete" ? "On delete" : "On update"}</span>
                  <select value={String(d[k] || "NO ACTION").toUpperCase()} onChange={(e) => patch({ [k]: e.target.value })} className={selectCls}>
                    {ON_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <span className={labelCls}>Optionality</span>
          <Toggle on={!!d.optionalSource} onChange={(v) => patch({ optionalSource: v })} label="Parent side optional" hint="A child may exist without a parent (zero-or-one)" />
          <Toggle on={!!d.optionalTarget} onChange={(v) => patch({ optionalTarget: v })} label="Child side optional" hint="A parent may have no children (zero-or-many)" />
        </div>
      </Disclosure>

      <FooterActions>
        <button onClick={remove} className={`${btnDanger} w-full`}>
          <Trash2 size={12} /> Delete relationship
        </button>
      </FooterActions>
    </div>
  );
}

// ───────────────────────── INSPECT: dependency (lineage) ─────────────────────────
function DepInspector({ edge, ops, onDeselect }: { edge: Edge; ops: Ops; onDeselect: () => void }) {
  const { nodes, edges } = ops;
  const a = nodes.find((n) => n.id === edge.source);
  const b = nodes.find((n) => n.id === edge.target);
  const d = (edge.data as any) || {};
  const cols = (n?: Node): string[] => (((n?.data as any)?.attributes as any[]) || []).map((x) => x.name);
  const patch = (p: Record<string, any>, final = true) => (final ? ops.commit : ops.live)({ edges: edges.map((e) => (e.id === edge.id ? { ...e, data: { ...(e.data as any), ...p } } : e)) });
  const aLabel = String((a?.data as any)?.label ?? edge.source);
  const bLabel = String((b?.data as any)?.label ?? edge.target);
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PanelHeader icon={<GitBranch size={15} />} kind="Data dependency" label={`${aLabel} → ${bLabel}`} />

      <div className="bg-amber-500/[0.05] border border-amber-500/20 p-3 rounded-xl text-xs space-y-1.5">
        <div className="flex items-center justify-between font-bold font-mono gap-2 text-amber-200">
          <span className="truncate">{aLabel}</span>
          <ArrowRight size={12} className="shrink-0 text-amber-400" />
          <span className="truncate text-right">{bLabel}</span>
        </div>
        <p className="text-[10px] text-white/40">Data flows from the upstream table to the downstream table.</p>
      </div>

      <FieldGroup title="Columns">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[9px] text-white/40 uppercase block mb-1">Upstream</span>
            <select value={String(d.fromColumn || "")} onChange={(e) => patch({ fromColumn: e.target.value })} className={selectCls}>
              <option value="">any</option>
              {cols(a).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <span className="text-[9px] text-white/40 uppercase block mb-1">Downstream</span>
            <select value={String(d.toColumn || "")} onChange={(e) => patch({ toColumn: e.target.value })} className={selectCls}>
              <option value="">any</option>
              {cols(b).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="Appearance">
        <div>
          <span className={labelCls}>Note</span>
          <CommitTextarea value={String(d.note || "")} onCommit={(v) => patch({ note: v })} placeholder="How is it transformed?" rows={2} />
        </div>
        <div>
          <span className={labelCls}>Colour</span>
          <Swatches value={String(d.color || "")} onChange={(hex, final) => patch({ color: hex }, final)} />
        </div>
      </FieldGroup>

      <FooterActions>
        <button onClick={(e) => requestCanvasDelete({ edgeIds: [edge.id], anchor: e.currentTarget, onDone: (ok) => ok && onDeselect() })} className={`${btnDanger} w-full`}>
          <Trash2 size={12} /> Delete dependency
        </button>
      </FooterActions>
    </div>
  );
}

// ───────────────────────── INSPECT: sticky note ─────────────────────────
function NoteInspector({ node, ops, onDeselect }: { node: Node; ops: Ops; onDeselect: () => void }) {
  const d = node.data as any;
  const idx = typeof d.colorIndex === "number" ? d.colorIndex : 0;
  const preview = String(d.text || "").trim();
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PanelHeader icon={<StickyNote size={15} />} kind="Sticky note" label={preview ? preview.slice(0, 40) : "Empty note"} />

      <FieldGroup>
        <div>
          <span className={labelCls}>Text</span>
          <CommitTextarea value={String(d.text || "")} onCommit={(v) => ops.patchNode(node.id, { text: v })} rows={5} />
        </div>
        <div>
          <span className={labelCls}>Colour</span>
          <div className="flex gap-2">
            {NOTE_COLORS.map((hex, i) => (
              <button key={hex} onClick={() => ops.patchNode(node.id, { colorIndex: i })} className={`w-6 h-6 rounded-md border-2 transition-all ${idx % NOTE_COLORS.length === i ? "border-white scale-110" : "border-white/10 hover:border-white/40"}`} style={{ backgroundColor: hex }} aria-label={`Note colour ${i + 1}`} />
            ))}
          </div>
        </div>
      </FieldGroup>

      <FooterActions>
        <button onClick={(e) => requestCanvasDelete({ nodeIds: [node.id], anchor: e.currentTarget, onDone: (ok) => ok && onDeselect() })} className={`${btnDanger} w-full`}>
          <Trash2 size={12} /> Delete note
        </button>
      </FooterActions>
    </div>
  );
}

// ───────────────────────── INSPECT: table group frame ─────────────────────────
function GroupInspector({ name, ops, onSelect, onDeselect }: { name: string; ops: Ops; onSelect: (id: string) => void; onDeselect: () => void }) {
  const { nodes, meta } = ops;
  const gm = meta.groups[name] || {};
  const members = nodes.filter((n) => isTableNode(n) && (n.data as any).group === name);

  const setGm = (patch: Partial<typeof gm>, final = true) => {
    const next: typeof gm = { ...gm, ...patch };
    if (!next.color) delete next.color;
    if (!next.note) delete next.note;
    if (!next.collapsed) delete next.collapsed;
    (final ? ops.commit : ops.live)({ meta: { ...meta, groups: { ...meta.groups, [name]: next } } });
  };

  const rename = (value: string) => {
    const next = value.trim();
    if (!next || next === name) return;
    if (groupNames(nodes, meta).some((g) => g.toLowerCase() === next.toLowerCase())) return showToast(`A group named “${next}” already exists`, "error");
    const { [name]: cur, ...rest } = meta.groups;
    ops.commit({
      nodes: nodes.map((n) => (isTableNode(n) && (n.data as any).group === name ? { ...n, data: { ...n.data, group: next } } : n)),
      meta: { ...meta, groups: { ...rest, [next]: cur || {} }, views: meta.views.map((v) => ({ ...v, groups: v.groups.map((g) => (g === name ? next : g)) })) },
    });
    onSelect(`${GROUP_NODE_PREFIX}${next}`);
  };

  const ungroup = (e: React.MouseEvent<HTMLElement>) => requestCanvasDelete({ group: name, anchor: e.currentTarget, onDone: (ok) => ok && onDeselect() });

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <PanelHeader icon={<Group size={15} />} kind="Table group" label={name} />

      <FieldGroup>
        <div>
          <span className={labelCls}>Name</span>
          <CommitInput value={name} onCommit={rename} />
        </div>
        <div>
          <span className={labelCls}>Colour</span>
          <Swatches value={gm.color || ""} onChange={(hex, final) => setGm({ color: hex || undefined }, final)} />
        </div>
        <div>
          <span className={labelCls}>Note</span>
          <CommitTextarea value={gm.note || ""} onCommit={(v) => setGm({ note: v || undefined })} placeholder="What does this module cover?" rows={2} />
        </div>
      </FieldGroup>

      <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-3 py-1">
        <Toggle on={!!gm.collapsed} onChange={(v) => setGm({ collapsed: v || undefined })} label="Collapse to a single card" hint="Relationships stay connected to the card" />
      </div>

      <div className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider font-bold text-white/40">Tables ({members.length})</span>
        <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04] max-h-[180px] overflow-y-auto p-scrollbar">
          {members.map((n) => (
            <button key={n.id} onClick={() => ops.focus(n.id)} className="w-full flex items-center gap-2 text-left px-2.5 py-1.5 hover:bg-white/[0.04] transition-colors">
              <Table2 size={11} className="text-white/40 shrink-0" />
              <span className="text-[11px] font-mono text-white/80 truncate">{String((n.data as any).label)}</span>
            </button>
          ))}
        </div>
      </div>

      <FooterActions>
        <button onClick={ungroup} className={`${btnDanger} w-full`}>
          <Ungroup size={12} /> Ungroup tables
        </button>
      </FooterActions>
    </div>
  );
}

// ───────────────────────── INSPECT: nothing selected → workspace settings ─────────────────────────
function SettingsPanel({ ops, showGrid, setShowGrid, sqlDialect, setSqlDialect, onAutoLayout }: { ops: Ops; showGrid: boolean; setShowGrid: (v: boolean) => void; sqlDialect: string; setSqlDialect: (d: string) => void; onAutoLayout: () => void }) {
  const layout = useLayout();
  const { meta } = ops;
  const [selectedFont, setSelectedFont] = useState("Vagnola Regular");
  const [nodeOpacity, setNodeOpacity] = useState(100);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--node-font", selectedFont === "Vagnola Regular" ? "Vagnola, sans-serif" : `${selectedFont}, sans-serif`);
    root.style.setProperty("--node-opacity", String(nodeOpacity / 100));
  }, [selectedFont, nodeOpacity]);

  const setDatabase = (id: string) => {
    setSqlDialect(id);
    const dbml = SQL_DIALECTS.find((x) => x.id === id)?.dbmlName;
    ops.commit({ meta: { ...meta, project: { ...meta.project, databaseType: dbml } } });
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Inspect's primary job is editing a selection — when there isn't one, say so first and keep it the
          most prominent thing on screen. Diagram-wide settings are still one scroll away, just visually secondary. */}
      <div className="flex flex-col items-center text-center gap-2 py-6 px-3 rounded-xl border border-dashed border-white/[0.1] bg-white/[0.015]">
        <div className="w-9 h-9 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/45">
          <MousePointerClick size={16} />
        </div>
        <p className="text-[12px] font-semibold text-white/70">Nothing selected</p>
        <p className="text-[11px] text-white/40 leading-snug max-w-[230px]">Click a table, relationship, note or group frame on the canvas to inspect and edit it here.</p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Settings size={11} className="text-white/35 shrink-0" />
        <span className="text-[10px] uppercase tracking-wider font-bold text-white/35">Diagram settings</span>
        <div className="h-px flex-1 bg-white/[0.06]" />
      </div>

      <FieldGroup>
        <div>
          <span className={labelCls}>Project name</span>
          <CommitInput value={meta.project.name || ""} onCommit={(v) => ops.commit({ meta: { ...meta, project: { ...meta.project, name: v || undefined } } })} placeholder="My schema" />
        </div>
        <div>
          <span className={labelCls}>Database</span>
          <select value={sqlDialect} onChange={(e) => setDatabase(e.target.value)} className={selectCls}>
            {SQL_DIALECTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <p className="text-[10px] text-white/35 mt-1">Drives data-type suggestions and the generated SQL.</p>
        </div>
        <div>
          <span className={labelCls}>Project note</span>
          <CommitTextarea value={meta.project.note || ""} onCommit={(v) => ops.commit({ meta: { ...meta, project: { ...meta.project, note: v || undefined } } })} placeholder="Describe the diagram…" rows={2} />
        </div>
      </FieldGroup>

      <FieldGroup title="Display">
        <Toggle on={meta.showRelationships} onChange={(v) => ops.commit({ meta: { ...meta, showRelationships: v } })} label="Show relationships" hint="Hide every line for a cleaner view" />
        <Toggle on={meta.showHubEdges} onChange={(v) => ops.commit({ meta: { ...meta, showHubEdges: v } })} label="Show hub connections" hint="Lines to tables nearly everything references (tenants, users). Off: a badge on each table instead" />
        <Toggle on={showGrid} onChange={setShowGrid} label="Show grid" />
      </FieldGroup>

      <FieldGroup title="Canvas style">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/70 font-semibold tracking-wide">Table opacity</span>
            <span className="text-[10px] text-[#C9C8C7] font-mono font-bold bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded">{nodeOpacity}%</span>
          </div>
          <input type="range" min="30" max="100" value={nodeOpacity} onChange={(e) => setNodeOpacity(parseInt(e.target.value))} className="w-full accent-[#4A90D9] h-1 bg-white/10 rounded-lg cursor-pointer appearance-none outline-none" />
        </div>
        <div>
          <span className={labelCls}>Table typography</span>
          <select value={selectedFont} onChange={(e) => setSelectedFont(e.target.value)} className={selectCls}>
            {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </FieldGroup>

      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={onAutoLayout} className={btnSoft}><Layers size={12} /> Auto layout</button>
        <button onClick={() => layout.openTool("versions")} className={btnSoft}><Check size={12} /> Version history</button>
        <button onClick={() => layout.openTool("colors")} className={`${btnSoft} col-span-2`} title="Show or hide tables by their header colour"><Palette size={12} /> Colours &amp; visibility</button>
      </div>
    </div>
  );
}

// ───────────────────────── VIEWS TAB ─────────────────────────
function ViewsPanel({ ops }: { ops: Ops }) {
  const { nodes, meta } = ops;
  const tables = nodes.filter(isTableNode);
  const selected = tables.filter((n) => n.selected);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<"schema" | "group">("schema");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const active = activeView(meta);
  const allKeys = tables.map(nodeKey);
  const countIn = (v: DiagramViewModel | null) => tables.filter((n) => isTableInView(v, n)).length;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) setMenuId(null);
    };
    document.addEventListener("pointerdown", close, true); // capture: the canvas stops mousedown from bubbling
    return () => document.removeEventListener("pointerdown", close, true);
  }, []);

  const withMeta = (m: ProjectMeta) => ops.commit({ meta: m });
  const uniqueViewId = (name: string) => {
    const base = slugify(name) || `view_${meta.views.length + 1}`;
    let id = base;
    let i = 2;
    while (meta.views.some((v) => v.id === id)) id = `${base}_${i++}`;
    return id;
  };
  const nameTaken = (name: string, exceptId?: string) => name.toLowerCase() === "default" || meta.views.some((v) => v.id !== exceptId && v.name.toLowerCase() === name.toLowerCase());

  const createView = (keys: string[]) => {
    const name = newName.trim() || `View ${meta.views.length + 1}`;
    if (nameTaken(name)) return showToast(`A view called “${name}” already exists`, "error");
    if (!keys.length) return showToast("Add some tables before creating a view", "validate");
    const id = uniqueViewId(name);
    withMeta({ ...meta, views: [...meta.views, { id, name, tables: keys, groups: [], schemas: [] }], activeViewId: id });
    setCreating(false);
    setNewName("");
  };

  const updateView = (id: string, patch: Partial<DiagramViewModel>) => withMeta({ ...meta, views: meta.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) });

  const renameView = (id: string) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    if (nameTaken(name, id)) return showToast(`A view called “${name}” already exists`, "error");
    const nextId = uniqueViewId(name);
    withMeta({ ...meta, views: meta.views.map((v) => (v.id === id ? { ...v, id: nextId, name } : v)), activeViewId: meta.activeViewId === id ? nextId : meta.activeViewId });
  };

  const duplicateView = (id: string) => {
    const src = meta.views.find((v) => v.id === id);
    if (!src) return;
    let name = `${src.name} copy`;
    let i = 2;
    while (nameTaken(name)) name = `${src.name} copy ${i++}`;
    const nid = uniqueViewId(name);
    const keys = tables.filter((n) => isTableInView(src, n)).map(nodeKey);
    withMeta({ ...meta, views: [...meta.views, { ...src, id: nid, name, tables: keys, groups: [], schemas: [] }], activeViewId: nid });
    setMenuId(null);
  };

  const deleteView = async (id: string, anchor: Element) => {
    const view = meta.views.find((v) => v.id === id);
    setMenuId(null);
    const ok = await confirmAction({
      message: ["You're deleting view ", { strong: view?.name || "this view" }, ". Are you sure?"],
      detail: "Only the view goes — its tables stay in the diagram.",
      note: "Ctrl+Z undoes it.",
      anchor,
    });
    if (!ok) return;
    withMeta({ ...meta, views: meta.views.filter((v) => v.id !== id), activeViewId: meta.activeViewId === id ? null : meta.activeViewId });
  };

  const visibleKeys = active ? tables.filter((n) => isTableInView(active, n)).map(nodeKey) : allKeys;
  const setKeys = (keys: string[]) => {
    if (!active) return;
    if (!keys.length) return showToast("A view needs at least one table", "validate");
    updateView(active.id, { tables: keys, groups: [], schemas: [] });
  };
  const toggleTable = (n: Node) => {
    const key = nodeKey(n);
    setKeys(visibleKeys.includes(key) ? visibleKeys.filter((k) => k !== key) : [...visibleKeys, key]);
  };
  const toggleMany = (list: Node[]) => {
    const keys = list.map(nodeKey);
    const allOn = keys.every((k) => visibleKeys.includes(k));
    setKeys(allOn ? visibleKeys.filter((k) => !keys.includes(k)) : Array.from(new Set([...visibleKeys, ...keys])));
  };

  const q = search.trim().toLowerCase();
  const filtered = tables.filter((n) => `${(n.data as any).label} ${(n.data as any).schema || ""} ${(n.data as any).group || ""}`.toLowerCase().includes(q));
  const grouped = new Map<string, Node[]>();
  for (const n of filtered) {
    const k = groupBy === "schema" ? String((n.data as any).schema || "public") : String((n.data as any).group || "Ungrouped");
    grouped.set(k, [...(grouped.get(k) || []), n]);
  }
  const sections = Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div className="space-y-4 flex flex-col">
      <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
        <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Diagram views</span>
        <button onClick={() => setCreating((c) => !c)} className="flex items-center gap-1 text-[10px] font-bold text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/25 hover:bg-[#4A90D9]/20 px-2 py-1 rounded-lg transition-all">
          <Plus size={11} /> New view
        </button>
      </div>

      {creating && (
        <div className="space-y-2 bg-white/[0.02] border border-white/[0.06] rounded-xl p-3">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createView(allKeys); if (e.key === "Escape") setCreating(false); e.stopPropagation(); }} placeholder={`View ${meta.views.length + 1}`} className={inputCls} />
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => createView(allKeys)} className={btnSoft}>All tables</button>
            <button onClick={() => createView(selected.map(nodeKey))} disabled={!selected.length} className={btnSoft} title="Select tables on the canvas first">Selected ({selected.length})</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <button onClick={() => withMeta({ ...meta, activeViewId: null })} className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${!active ? "bg-[#4A90D9]/12 border-[#4A90D9]/35 text-white" : "bg-white/[0.02] border-white/[0.05] text-white/70 hover:border-white/[0.15]"}`}>
          {!active ? <Check size={12} className="text-[#4A90D9] shrink-0" /> : <div className="w-3 shrink-0" />}
          <span className="text-[12px] font-semibold flex-1 truncate">Default view</span>
          <span className="text-[10px] text-white/40 font-mono">{tables.length}</span>
        </button>
        {meta.views.map((v) => {
          const isActive = active?.id === v.id;
          return (
            <div key={v.id} className="relative">
              {renamingId === v.id ? (
                <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={() => renameView(v.id)} onKeyDown={(e) => { if (e.key === "Enter") renameView(v.id); if (e.key === "Escape") setRenamingId(null); e.stopPropagation(); }} className={inputCls} />
              ) : (
                <div className={`flex items-center gap-2 pl-3 pr-1.5 py-2 rounded-xl border transition-all ${isActive ? "bg-[#4A90D9]/12 border-[#4A90D9]/35 text-white" : "bg-white/[0.02] border-white/[0.05] text-white/70 hover:border-white/[0.15]"}`}>
                  <button onClick={() => withMeta({ ...meta, activeViewId: v.id })} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {isActive ? <Check size={12} className="text-[#4A90D9] shrink-0" /> : <div className="w-3 shrink-0" />}
                    <span className="text-[12px] font-semibold truncate">{v.name}</span>
                    <span className="text-[10px] text-white/40 font-mono ml-auto">{countIn(v)}</span>
                  </button>
                  <button onClick={() => setMenuId(menuId === v.id ? null : v.id)} className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]" aria-label={`Options for ${v.name}`}>
                    <MoreVertical size={13} />
                  </button>
                </div>
              )}
              {menuId === v.id && (
                <div ref={menuRef} className="absolute right-0 top-full mt-1 z-20 w-36 rounded-xl bg-[#0b1220] border border-white/[0.1] shadow-xl overflow-hidden">
                  <button onClick={() => { setRenamingId(v.id); setRenameValue(v.name); setMenuId(null); }} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-white/80 hover:bg-white/[0.05]"><Pencil size={11} /> Rename</button>
                  <button onClick={() => duplicateView(v.id)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-white/80 hover:bg-white/[0.05]"><CopyPlus size={11} /> Duplicate</button>
                  <button onClick={(e) => void deleteView(v.id, e.currentTarget)} className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-400 hover:bg-red-500/10"><Trash2 size={11} /> Delete</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">{active ? `Tables in “${active.name}”` : "Tables"}</span>
          {active && (
            <div className="flex gap-1">
              <button onClick={() => setKeys(allKeys)} className="text-[9px] font-bold text-[#4A90D9] hover:underline">All</button>
              <span className="text-white/20">·</span>
              <button onClick={() => setKeys(selected.map(nodeKey))} disabled={!selected.length} className="text-[9px] font-bold text-[#4A90D9] hover:underline disabled:opacity-30 disabled:no-underline" title="Show only the tables selected on the canvas">Only selected</button>
            </div>
          )}
        </div>
        {!active && <p className="text-[10px] text-white/35 leading-snug">The default view shows every table. Create a view to work with a focused subset — views are saved with the diagram and exported as <code className="text-white/55">DiagramView</code>.</p>}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search tables" className={`${inputCls} pl-7`} />
          </div>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)} className={`${selectCls} !w-[92px] shrink-0`}>
            <option value="schema">Schema</option>
            <option value="group">Group</option>
          </select>
        </div>

        {tables.length === 0 ? (
          <p className="text-[11px] text-white/30 italic text-center py-4">No tables yet.</p>
        ) : (
          <div className="space-y-2">
            {sections.map(([name, list]) => {
              const isCollapsed = collapsed.has(name);
              const onCount = list.filter((n) => visibleKeys.includes(nodeKey(n))).length;
              return (
                <div key={name} className="border border-white/[0.05] rounded-xl overflow-hidden">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white/[0.02]">
                    <button onClick={() => setCollapsed((s) => { const nx = new Set(s); if (nx.has(name)) nx.delete(name); else nx.add(name); return nx; })} className="text-white/45 hover:text-white">
                      {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <span className="text-[11px] text-white/80 font-semibold flex-1 truncate">{name}</span>
                    <span className="text-[9px] text-white/35 font-mono">{onCount}/{list.length}</span>
                    {active && (
                      <button onClick={() => toggleMany(list)} className="text-white/45 hover:text-white p-0.5" title={onCount === list.length ? "Hide these tables from the view" : "Show these tables in the view"}>
                        {onCount === list.length ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                    )}
                  </div>
                  {!isCollapsed && (
                    <div className="divide-y divide-white/[0.03]">
                      {list.map((n) => {
                        const on = visibleKeys.includes(nodeKey(n));
                        return (
                          <div key={n.id} className={`flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/[0.03] transition-colors ${on ? "" : "opacity-45"}`}>
                            {active ? (
                              <button onClick={() => toggleTable(n)} className="text-white/45 hover:text-white shrink-0" aria-label={on ? "Hide table from view" : "Show table in view"}>
                                {on ? <Eye size={12} /> : <EyeOff size={12} />}
                              </button>
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: String((n.data as any).color || "#4A90D9") }} />
                            )}
                            <button onClick={() => ops.focus(n.id)} className="flex-1 min-w-0 text-left text-[11px] font-mono text-white/80 truncate hover:text-white">{String((n.data as any).label)}</button>
                            <span className="text-[9px] text-white/30 font-mono">{((n.data as any).attributes || []).length}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {sections.length === 0 && <p className="text-[11px] text-white/30 italic text-center py-3">No table matches “{search}”.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── SIDEBAR SHELL ─────────────────────────
export function UnifiedSidebar({
  nodes,
  setNodes,
  edges,
  setEdges,
  selectedNodeId,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId,
  showGrid,
  setShowGrid,
  onAutoLayout,
  activeTab,
  setActiveTab,
  onClose,
  sqlDialect,
  setSqlDialect,
  takeSnapshot,
  onFocusNode,
  onOpenTableEditor,
}: UnifiedSidebarProps) {
  const layout = useLayout();
  const meta = layout.meta;

  const ops: Ops = {
    nodes,
    edges,
    meta,
    commit: (next) => {
      if (next.nodes) setNodes(next.nodes);
      if (next.edges) setEdges(next.edges);
      if (next.meta) layout.setMeta(next.meta);
      takeSnapshot({ nodes: next.nodes ?? nodes, edges: next.edges ?? edges, meta: next.meta ?? meta });
    },
    live: (next) => {
      if (next.nodes) setNodes(next.nodes);
      if (next.edges) setEdges(next.edges);
      if (next.meta) layout.setMeta(next.meta);
    },
    snapshot: () => takeSnapshot(),
    patchNode: (id, patch, snapshot = true) => {
      const next = nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
      if (snapshot) ops.commit({ nodes: next });
      else setNodes(next);
    },
    uniqueName: (base, schema) => {
      const taken = new Set(nodes.filter(isTableNode).filter((n) => String((n.data as any).schema || "") === String(schema || "")).map((n) => String((n.data as any).label).toLowerCase()));
      let name = base;
      let i = 2;
      while (taken.has(name.toLowerCase())) name = `${base}_${i++}`;
      return name;
    },
    focus: (id) => {
      if (isGroupNodeId(id)) {
        setSelectedEdgeId(null);
        setSelectedNodeId(id);
        setActiveTab("inspector");
        return;
      }
      onFocusNode?.(id);
    },
  };

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : undefined;
  const selectedGroup = selectedNodeId && isGroupNodeId(selectedNodeId) ? groupNameFromId(selectedNodeId) : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : undefined;
  const deselect = () => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const tabBtn = (id: "add" | "inspector" | "views", label: string, icon: React.ReactNode, clear: boolean) => (
    <button
      onClick={() => {
        setActiveTab(id);
        if (clear) deselect();
      }}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${activeTab === id ? "bg-[#4A90D9]/20 border border-[#4A90D9]/35 text-white shadow-inner" : "text-white/55 hover:text-white hover:bg-white/[0.05] border border-transparent"}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    // A real side drawer: flush with the right edge, full height of the canvas area, one straight edge with a shadow
    // (no floating card). The canvas keeps its size and this slides over it.
    <aside
      id="design-unified-sidebar"
      aria-label="Inspector"
      style={{ width: INSPECT_DRAWER_WIDTH }}
      className="absolute right-0 top-0 bottom-0 z-40 max-w-[92vw] flex flex-col bg-[#080C16] border-l border-white/[0.09] shadow-[-18px_0_48px_rgba(0,0,0,0.55)] pointer-events-auto select-none animate-in slide-in-from-right duration-200"
    >
      <div className="flex items-center gap-2 px-3 h-[58px] shrink-0 border-b border-white/[0.07] bg-white/[0.015]">
        <div className="flex flex-1 items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.05]">
          {tabBtn("add", "Add", <PlusSquare size={13} />, true)}
          {tabBtn("inspector", "Inspect", <Component size={13} />, false)}
          {tabBtn("views", "Views", <Layers size={13} />, true)}
        </div>
        <button onClick={onClose} className="p-2 text-white/60 hover:text-white hover:bg-white/[0.07] rounded-lg transition-all shrink-0" aria-label="Close sidebar" title="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 p-scrollbar flex flex-col gap-5">
        {activeTab === "add" && <AddPanel ops={ops} onOpenTableEditor={onOpenTableEditor} />}

        {activeTab === "inspector" && (
          <div className="space-y-4 flex flex-col">
            {selectedNode && isTableNode(selectedNode) && <TableInspector node={selectedNode} ops={ops} onOpenTableEditor={onOpenTableEditor} />}
            {selectedNode && selectedNode.type === "stickyNote" && <NoteInspector node={selectedNode} ops={ops} onDeselect={deselect} />}
            {!selectedNode && selectedGroup && <GroupInspector name={selectedGroup} ops={ops} onSelect={(id) => setSelectedNodeId(id)} onDeselect={deselect} />}
            {!selectedNode && !selectedGroup && selectedEdge && (isDepEdge(selectedEdge) ? <DepInspector edge={selectedEdge} ops={ops} onDeselect={deselect} /> : <RefInspector edge={selectedEdge} ops={ops} onDeselect={deselect} />)}
            {!(selectedNode && (isTableNode(selectedNode) || selectedNode.type === "stickyNote")) && !selectedGroup && !selectedEdge && (
              <SettingsPanel ops={ops} showGrid={showGrid} setShowGrid={setShowGrid} sqlDialect={sqlDialect} setSqlDialect={setSqlDialect} onAutoLayout={onAutoLayout} />
            )}
          </div>
        )}

        {activeTab === "views" && <ViewsPanel ops={ops} />}
      </div>
    </aside>
  );
}
