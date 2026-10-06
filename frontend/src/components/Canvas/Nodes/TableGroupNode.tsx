"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, NodeProps, Position, useReactFlow, useStore } from "@xyflow/react";
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { useDisplay } from "../DisplayContext";
import { groupNameFromId } from "@/lib/model/displayGraph";
import { requestCanvasDelete } from "../deleteRequest";
import { LOD_OVERVIEW_BELOW } from "@/lib/lod";

const COLORS = ["#4A90D9", "#8B5CF6", "#10B981", "#F87171", "#F59E0B", "#06B6D4", "#EC4899", "#84CC16"];

/** Dark text on light group colours, white text on dark ones. */
function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#0a0f1c" : "#ffffff";
}

/**
 * A Table Group (DBML `TableGroup`), drawn like dbdiagram.io: a frame around its tables with a full-width
 * title bar. Dragging the frame moves the whole group. Collapsed, it becomes a single card with the same
 * title bar (see displayGraph.ts, which re-routes every outside relationship to the card).
 */
function TableGroupNodeImpl({ id, data, selected }: NodeProps) {
  const { setNodes } = useReactFlow();
  const layout = useLayout();
  const display = useDisplay();
  const isReadOnly = !!display.readOnly;
  const name = groupNameFromId(id);
  const d = data as any;
  const color: string = d.color || "#4A90D9";
  const ink = inkFor(color);
  const dark = ink === "#ffffff";
  const collapsed = !!d.collapsed;
  const tables: string[] = d.tables || [];
  const count = d.count ?? tables.length;
  // a table is being dragged over this frame: dropping it adds it to the group
  const dropping = display.dropGroup === name;

  // Zoomed out, the title text grows (at most 2×) so the group name stays legible; the bar itself keeps its height.
  const zoomBoost = useStore((s) => Math.round(Math.min(2, Math.max(1, 0.8 / (s.transform[2] || 1))) * 10) / 10);
  const iconScale = Math.min(zoomBoost, 1.5);
  // zoomed far out (lib/lod overview): the name also floats above the frame — outside it, so it never covers a table —
  // in type that stays readable; 0 at closer zooms. Rounded to 4 px steps so it re-renders only now and then.
  const overviewLabel = useStore((s) => (s.transform[2] < LOD_OVERVIEW_BELOW ? Math.round(Math.max(36, Math.min(64, 16 / (s.transform[2] || 1))) / 4) * 4 : 0)); // ≤ 64: label + margin stay inside the 96 px between blocks

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [noteDraft, setNoteDraft] = useState(d.note || "");
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null); // the title bar — the editor opens right under it
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // re-anchor while the canvas is panned / zoomed (null when closed, so a closed group never re-renders for it)
  const viewport = useStore((s) => (editing ? s.transform : null));

  useEffect(() => {
    if (editing) {
      setNameDraft(name);
      setNoteDraft(d.note || "");
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, name, d.note]);

  const patchMembers = (patch: (data: any) => any) => setNodes((nds) => nds.map((n) => (n.type === "tableMode" && (n.data as any).group === name ? { ...n, data: patch(n.data) } : n)));

  const setGroupMeta = (patch: Record<string, unknown>) =>
    layout.setMeta((m) => ({ ...m, groups: { ...m.groups, [name]: { ...(m.groups[name] || {}), ...patch } } }));

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    setGroupMeta({ collapsed: !collapsed });
  };

  const commit = () => {
    const next = nameDraft.trim();
    setGroupMeta({ note: noteDraft.trim() || undefined });
    if (next && next !== name) {
      patchMembers((data) => ({ ...data, group: next }));
      layout.setMeta((m) => {
        const groups = { ...m.groups };
        groups[next] = { ...(groups[name] || {}), note: noteDraft.trim() || undefined };
        delete groups[name];
        return { ...m, groups };
      });
    }
    setEditing(false);
  };

  // The editor lives in document.body, not inside the node: group frames sit *behind* the tables (z-index −1), so an
  // editor rendered inside the node opened hidden under whatever table was below it — which read as "the edit button
  // does nothing". It also keeps its size at any zoom level.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useLayoutEffect(() => {
    if (!editing) {
      setPos(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 288;
    const H = popRef.current?.offsetHeight || 320;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
    let top = r.bottom + 8;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 8);
    setPos({ left, top });
  }, [editing, viewport]);
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      commitRef.current(); // clicking away saves, like every other inline editor in the app
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditing(false);
    };
    document.addEventListener("pointerdown", onDown, true); // capture: the canvas stops mousedown from bubbling
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  const ungroup = (e: React.MouseEvent) => {
    e.stopPropagation();
    requestCanvasDelete({ group: name, anchor: e.currentTarget }); // "You're deleting group …" — the tables stay
  };

  const editor =
    editing &&
    typeof document !== "undefined" &&
    createPortal(
    <div
      ref={popRef}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
      className="fixed z-[80] w-[288px] p-3.5 rounded-xl bg-[#0c101b] border border-white/[0.14] shadow-[0_20px_60px_rgba(0,0,0,0.7)] space-y-2.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Table group</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              commit();
              window.dispatchEvent(new CustomEvent("open-inspector", { detail: { nodeId: id } }));
            }}
            title="More settings — member tables, full editor"
            className="text-white/40 hover:text-white p-0.5 rounded"
          >
            <MoreHorizontal size={13} />
          </button>
          <button onClick={() => setEditing(false)} className="text-white/40 hover:text-white p-0.5 rounded">
            <X size={12} />
          </button>
        </div>
      </div>
      <input ref={inputRef} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-xs text-white outline-none focus:border-[#4A90D9]/60" />
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button key={c} onClick={() => setGroupMeta({ color: c })} className={`w-5 h-5 rounded-full border ${c === color ? "border-white ring-1 ring-white/50" : "border-white/20"}`} style={{ background: c }} />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#4A90D9"} onChange={(e) => setGroupMeta({ color: e.target.value })} className="w-6 h-5 bg-transparent border-0 p-0 cursor-pointer" title="Custom colour" />
      </div>
      <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="Markdown description of this group…" className="w-full bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1.5 text-[11px] text-white outline-none resize-none focus:border-[#4A90D9]/60" />
      <button onClick={commit} className="w-full py-1.5 rounded-md bg-[#4A90D9] text-white text-[11px] font-bold hover:bg-[#5ba0e9]">
        Save
      </button>
    </div>,
    document.body
    );

  // full-width title bar: collapse toggle · name · table count on the left, edit and ungroup on the right
  const btn = `shrink-0 p-1.5 rounded-md transition-colors ${dark ? "hover:bg-black/25" : "hover:bg-black/15"}`;
  const titleBar = (
    <div ref={anchorRef} className="flex items-center gap-2 pl-2 pr-2 h-[44px] rounded-t-[13px] select-none" style={{ background: color, color: ink }}>
      <button onClick={toggleCollapse} className={btn} title={collapsed ? "Expand group" : "Collapse group into a card"}>
        {collapsed ? <ChevronRight size={20 * iconScale} /> : <ChevronDown size={20 * iconScale} />}
      </button>
      <span className="min-w-0 flex-1 truncate font-bold leading-tight" style={{ fontSize: 17 * zoomBoost }} title={name}>
        {name}
      </span>
      <span className="shrink-0 font-mono font-semibold rounded-full px-2 leading-[22px]" style={{ fontSize: 13 * zoomBoost, background: dark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.13)" }} title={`${count} tables`}>
        {count}
      </span>
      {dropping && (
        <span className="shrink-0 rounded-full px-2.5 leading-[22px] font-semibold" style={{ fontSize: 12 * zoomBoost, background: dark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.45)" }}>
          Drop to add
        </span>
      )}
      {!isReadOnly && (
        <>
          <button
            onClick={() => setEditing(true)}
            className={btn}
            title="Edit group name, colour and note"
          >
            <Pencil size={16 * iconScale} />
          </button>
          <button onClick={ungroup} className={`shrink-0 p-1.5 rounded-md transition-colors ${dark ? "hover:bg-red-500/50" : "hover:bg-red-600/30"}`} title="Ungroup (tables are kept)">
            <Trash2 size={16 * iconScale} />
          </button>
        </>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div
        className="relative group w-[320px] rounded-2xl border-2 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
        style={{ borderColor: `${color}cc`, background: `linear-gradient(${color}1f, ${color}1f), #0a0f1c`, outline: selected ? `2px solid ${color}` : undefined }}
        onDoubleClick={() => !isReadOnly && setEditing(true)}
      >
        <Handle type="target" position={Position.Left} className="w-2 h-2 rounded-full border-none opacity-0" />
        <Handle type="source" position={Position.Right} className="w-2 h-2 rounded-full border-none opacity-0" />
        {titleBar}
        <div className="px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {tables.slice(0, 9).map((t) => (
              <span key={t} className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.07] text-white/80 border border-white/[0.08]">
                {t}
              </span>
            ))}
            {tables.length > 9 && <span className="text-[11px] text-white/45 self-center">+{tables.length - 9} more</span>}
          </div>
          {d.note && <p className="mt-2.5 text-xs text-white/55 italic line-clamp-2">{d.note}</p>}
        </div>
        {editor}
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full rounded-2xl border-2 transition-colors"
      style={{ borderColor: dropping ? color : `${color}cc`, borderStyle: dropping ? "dashed" : undefined, background: dropping ? `${color}33` : `${color}14`, outline: selected || dropping ? `2px solid ${color}88` : undefined }}
      onDoubleClick={() => setEditing(true)}
    >
      <div className="absolute inset-x-0 top-0">{titleBar}</div>
      {overviewLabel > 0 && (
        <div className="absolute left-1 bottom-full mb-2 font-bold whitespace-nowrap pointer-events-none select-none" style={{ fontSize: overviewLabel, lineHeight: 1.1, color }}>
          {name}
        </div>
      )}
      {editor}
    </div>
  );
}

export const TableGroupNode = memo(TableGroupNodeImpl);
