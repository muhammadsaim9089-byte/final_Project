"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { Check, ChevronDown, ChevronRight, Crosshair, FoldVertical, Group, Pencil, Plus, Search, Trash2, UnfoldVertical, X } from "lucide-react";
import { isTableNode } from "@/lib/model/canvasAdapter";
import { GROUP_COLORS, assignGroup, createGroup, gatherGroup, groupNameProblem, groupOf, listGroups, nextGroupColor, patchGroupMeta, renameGroup, ungroupTables, type GroupSummary } from "@/lib/model/groups";
import { showToast } from "@/components/ui/toast";
import { requestCanvasDelete } from "../deleteRequest";
import { DrawerShell, drawerBtn, drawerBtnPrimary, drawerIconBtn, drawerInput, type DiagramOps } from "./DrawerShell";

/** dataTransfer type for a table chip being dragged between groups */
const DRAG_TYPE = "application/x-designdb-table";
const labelOf = (n?: Node) => String((n?.data as any)?.label ?? n?.id ?? "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

interface GroupsDrawerProps {
  ops: DiagramOps;
  /** tables selected on the canvas right now: a new group starts with them, and a group can take them in one click */
  selectedTableIds: string[];
  onFocusTables: (ids: string[]) => void;
  onClose: () => void;
}

/**
 * Table groups as their own panel: every group as a card (colour, name, size, focus / collapse / edit / ungroup), its
 * tables as chips you drag between groups or back to "Ungrouped", and a form for a new group that starts from the canvas
 * selection. Ctrl+G on the canvas and dropping a table onto a group frame do the same things without opening it.
 */
export function GroupsDrawer({ ops, selectedTableIds, onFocusTables, onClose }: GroupsDrawerProps) {
  const { nodes, meta } = ops;
  const tables = useMemo(() => nodes.filter(isTableNode), [nodes]);
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const groups = useMemo(() => listGroups(nodes, meta), [nodes, meta]);
  const ungrouped = tables.filter((t) => !groupOf(t));

  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null); // a group name, or "" for Ungrouped

  const expand = (name: string, on = true) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  const move = (ids: string[], group: string) => {
    const moving = ids.filter((id) => byId.has(id) && groupOf(byId.get(id)!) !== group);
    if (!moving.length) return;
    // into a group: gathered if its frame would cover other tables · out of one: moved clear of the frame
    ops.commit({ nodes: group ? gatherGroup(assignGroup(nodes, moving, group), meta, group) : ungroupTables(nodes, moving) });
    if (group) expand(group);
    const what = moving.length === 1 ? `“${labelOf(byId.get(moving[0]))}”` : plural(moving.length, "table");
    showToast(group ? `Moved ${what} into “${group}”` : `Took ${what} out of its group`, "success");
  };

  const dropTarget = (group: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOver !== group) setDragOver(group);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDragOver((d) => (d === group ? null : d));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      const id = e.dataTransfer.getData(DRAG_TYPE);
      if (id) move([id], group);
    },
  });

  const onEscape = useCallback(() => {
    if (editing) {
      setEditing(null);
      return true;
    }
    if (creating) {
      setCreating(false);
      return true;
    }
    return false;
  }, [editing, creating]);

  const subtitle = groups.length ? `${plural(groups.length, "group")} · ${plural(ungrouped.length, "table")} not in a group` : `${plural(tables.length, "table")}, no groups yet`;

  return (
    <DrawerShell
      label="Table groups"
      icon={<Group size={17} />}
      title="Table groups"
      subtitle={subtitle}
      onClose={onClose}
      onEscape={onEscape}
      toolbar={
        !creating && (
          <button onClick={() => setCreating(true)} disabled={!tables.length} className={`${drawerBtnPrimary} w-full`}>
            <Plus size={14} /> New group{selectedTableIds.length ? ` from ${plural(selectedTableIds.length, "selected table")}` : ""}
          </button>
        )
      }
    >
      {creating && (
        <NewGroupForm
          ops={ops}
          tables={tables}
          selectedTableIds={selectedTableIds}
          onCancel={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            expand(name);
          }}
        />
      )}

      {!groups.length && !creating && (
        <div className="rounded-xl border border-dashed border-white/[0.12] px-4 py-5 text-center">
          <p className="text-[12.5px] font-semibold text-white/85">Organise tables into modules</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-white/45">
            Billing, identity, analytics… each group gets a coloured frame on the canvas and is exported as a DBML <code className="text-white/60">TableGroup</code>.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {groups.map((g) => (
          <GroupCard
            key={g.name}
            group={g}
            ops={ops}
            byId={byId}
            selectedTableIds={selectedTableIds}
            expanded={expanded.has(g.name)}
            onToggle={() => expand(g.name, !expanded.has(g.name))}
            editing={editing === g.name}
            onEdit={(on) => setEditing(on ? g.name : null)}
            onRenamed={(to) => {
              expand(g.name, false);
              expand(to);
            }}
            onMove={move}
            onFocusTables={onFocusTables}
            highlighted={dragOver === g.name}
            dropTarget={dropTarget(g.name)}
          />
        ))}
      </div>

      {tables.length > 0 && (groups.length > 0 || creating) && (
        <div
          {...dropTarget("")}
          className={`mt-4 rounded-xl border border-dashed p-3 transition-colors ${dragOver === "" ? "border-white/40 bg-white/[0.05]" : "border-white/[0.12]"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Not in a group · {ungrouped.length}</span>
            <span className="text-[10.5px] text-white/30">drag a table onto a group</span>
          </div>
          {ungrouped.length ? (
            <div className="flex flex-wrap gap-1.5">
              {ungrouped.map((t) => (
                <TableChip key={t.id} node={t} onFocus={() => onFocusTables([t.id])} />
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] text-white/35">Every table is in a group. Drop one here to take it out.</p>
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-white/35">
        On the canvas: select tables and press <kbd className="px-1 rounded bg-white/[0.07] border border-white/[0.1] text-white/60 font-mono text-[10px]">Ctrl G</kbd> to group them, or drop a table onto a group&apos;s frame to add it.
      </p>
    </DrawerShell>
  );
}

function TableChip({ node, onFocus, onRemove, color }: { node: Node; onFocus: () => void; onRemove?: () => void; color?: string }) {
  const name = labelOf(node);
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, node.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group/chip inline-flex items-center max-w-full rounded-md border border-white/[0.1] bg-white/[0.04] hover:border-white/25 cursor-grab active:cursor-grabbing"
      style={color ? { borderLeft: `3px solid ${color}` } : undefined}
    >
      <button onClick={onFocus} className="min-w-0 truncate pl-2 pr-1.5 py-1 text-[11.5px] font-mono text-white/80 hover:text-white" title={`Show ${name} on the canvas (drag to move it to another group)`}>
        {name}
      </button>
      {onRemove && (
        <button onClick={onRemove} className="pr-1.5 py-1 text-white/30 hover:text-red-300" title={`Take ${name} out of this group`} aria-label={`Take ${name} out of this group`}>
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {GROUP_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full border transition-transform ${c.toLowerCase() === value.toLowerCase() ? "border-white ring-1 ring-white/50 scale-110" : "border-white/20 hover:scale-110"}`}
          style={{ background: c }}
          aria-label={`Colour ${c}`}
        />
      ))}
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : GROUP_COLORS[0]} onChange={(e) => onChange(e.target.value)} className="w-6 h-5 bg-transparent border-0 p-0 cursor-pointer" title="Custom colour" />
    </div>
  );
}

function NewGroupForm({ ops, tables, selectedTableIds, onCancel, onCreated }: { ops: DiagramOps; tables: Node[]; selectedTableIds: string[]; onCancel: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => nextGroupColor(ops.nodes, ops.meta));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(selectedTableIds));
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = q.trim() ? tables.filter((t) => labelOf(t).toLowerCase().includes(q.trim().toLowerCase())) : tables;

  const toggle = (id: string) => {
    setError(null);
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = () => {
    const problem = groupNameProblem(ops.nodes, ops.meta, name);
    if (problem) return setError(problem);
    if (!picked.size) return setError("Pick at least one table");
    const res = createGroup(ops.nodes, ops.meta, name, [...picked], color);
    if (!res) return setError("Couldn't create that group");
    ops.commit({ ...res, nodes: gatherGroup(res.nodes, res.meta, name.trim()) });
    showToast(`Created “${name.trim()}” with ${plural(picked.size, "table")}`, "success");
    onCreated(name.trim());
  };

  return (
    <div className="mb-4 rounded-xl border border-[#4A90D9]/35 bg-[#4A90D9]/[0.05] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-white">New group</span>
        <button onClick={onCancel} className={drawerIconBtn} aria-label="Cancel new group">
          <X size={14} />
        </button>
      </div>
      <div>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder="billing"
          aria-label="Group name"
          className={drawerInput}
        />
      </div>
      <Swatches value={color} onChange={setColor} />
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-white/55">Tables · {picked.size} picked</span>
          {selectedTableIds.length > 0 && (
            <button onClick={() => setPicked(new Set(selectedTableIds))} className="text-[11px] text-[#7ec8ff] hover:underline">
              Use canvas selection ({selectedTableIds.length})
            </button>
          )}
        </div>
        <div className="relative mb-1.5">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tables" aria-label="Filter tables" className={`${drawerInput} pl-7`} />
        </div>
        <div className="max-h-[220px] overflow-y-auto rounded-lg border border-white/[0.07] divide-y divide-white/[0.04] p-scrollbar">
          {shown.length === 0 && <p className="px-3 py-3 text-[11.5px] text-white/35">No table matches “{q}”.</p>}
          {shown.map((t) => {
            const on = picked.has(t.id);
            const g = groupOf(t);
            return (
              <button key={t.id} onClick={() => toggle(t.id)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${on ? "bg-[#4A90D9]/[0.1]" : "hover:bg-white/[0.04]"}`}>
                <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${on ? "bg-[#2563eb] border-[#3b82f6]" : "border-white/25"}`}>{on && <Check size={11} className="text-white" />}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-mono text-white/85">{labelOf(t)}</span>
                {g && <span className="shrink-0 text-[10.5px] text-white/35" title={`Now in ${g}; it moves to the new group`}>in {g}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {error && <p className="text-[11.5px] text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className={drawerBtn}>
          Cancel
        </button>
        <button onClick={create} className={drawerBtnPrimary}>
          Create group
        </button>
      </div>
    </div>
  );
}

function GroupCard({
  group: g,
  ops,
  byId,
  selectedTableIds,
  expanded,
  onToggle,
  editing,
  onEdit,
  onRenamed,
  onMove,
  onFocusTables,
  highlighted,
  dropTarget,
}: {
  group: GroupSummary;
  ops: DiagramOps;
  byId: Map<string, Node>;
  selectedTableIds: string[];
  expanded: boolean;
  onToggle: () => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onRenamed: (to: string) => void;
  onMove: (ids: string[], group: string) => void;
  onFocusTables: (ids: string[]) => void;
  highlighted: boolean;
  dropTarget: React.HTMLAttributes<HTMLDivElement>;
}) {
  const outsideSelected = selectedTableIds.filter((id) => byId.has(id) && groupOf(byId.get(id)!) !== g.name);
  const others = [...byId.values()].filter((t) => groupOf(t) !== g.name);

  return (
    <div
      {...dropTarget}
      className={`rounded-xl border transition-colors ${highlighted ? "bg-white/[0.06]" : "bg-white/[0.02]"}`}
      style={{ borderColor: highlighted ? g.color : "rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-center gap-1.5 pl-1.5 pr-1 py-1.5">
        <button onClick={onToggle} className={drawerIconBtn} aria-expanded={expanded} aria-label={expanded ? `Hide the tables in ${g.name}` : `Show the tables in ${g.name}`}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className="w-3 h-3 shrink-0 rounded-full border border-white/20" style={{ background: g.color }} />
        <button onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-semibold text-white/90" title={g.note || g.name}>
            {g.name}
          </span>
        </button>
        {g.collapsed && <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/35">card</span>}
        <span className="shrink-0 min-w-[22px] text-center text-[11px] font-mono text-white/55 rounded-full bg-white/[0.06] px-1.5">{g.tableIds.length}</span>
        <button onClick={() => onFocusTables(g.tableIds)} className={drawerIconBtn} title="Show on the canvas" aria-label={`Show ${g.name} on the canvas`}>
          <Crosshair size={14} />
        </button>
        <button
          onClick={() => ops.commit({ meta: patchGroupMeta(ops.meta, g.name, { collapsed: !g.collapsed }) })}
          className={drawerIconBtn}
          title={g.collapsed ? "Expand back into a frame" : "Collapse into a single card"}
          aria-label={g.collapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
        >
          {g.collapsed ? <UnfoldVertical size={14} /> : <FoldVertical size={14} />}
        </button>
        <button onClick={() => onEdit(!editing)} className={drawerIconBtn} title="Rename, colour and note" aria-label={`Edit ${g.name}`}>
          <Pencil size={13} />
        </button>
        <button
          onClick={(e) => requestCanvasDelete({ group: g.name, anchor: e.currentTarget })}
          className={`${drawerIconBtn} hover:!text-red-300 hover:!bg-red-500/10`}
          title="Ungroup (the tables stay)"
          aria-label={`Ungroup ${g.name}`}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {editing && <GroupEditor group={g} ops={ops} onDone={() => onEdit(false)} onRenamed={onRenamed} />}

      {expanded && (
        <div className="px-3 pb-3 pt-0.5 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {g.tableIds.map((id) => byId.get(id) && <TableChip key={id} node={byId.get(id)!} color={g.color} onFocus={() => onFocusTables([id])} onRemove={() => onMove([id], "")} />)}
          </div>
          <div className="flex items-center gap-1.5">
            {others.length > 0 && (
              <select
                value=""
                onChange={(e) => e.target.value && onMove([e.target.value], g.name)}
                aria-label={`Add a table to ${g.name}`}
                className="flex-1 min-w-0 h-7 bg-[#080E18] border border-white/[0.09] rounded-md px-2 text-[11.5px] text-white/70 outline-none cursor-pointer focus:border-[#4A90D9]/60"
              >
                <option value="">Add a table…</option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {labelOf(t)}
                    {groupOf(t) ? `  (from ${groupOf(t)})` : ""}
                  </option>
                ))}
              </select>
            )}
            {outsideSelected.length > 0 && (
              <button onClick={() => onMove(outsideSelected, g.name)} className={`${drawerBtn} !h-7 !px-2 !text-[11px] shrink-0`} title="Move the tables selected on the canvas into this group">
                <Plus size={12} /> Add selected ({outsideSelected.length})
              </button>
            )}
          </div>
          {g.note && <p className="text-[11px] text-white/40 italic line-clamp-3">{g.note}</p>}
        </div>
      )}
    </div>
  );
}

function GroupEditor({ group: g, ops, onDone, onRenamed }: { group: GroupSummary; ops: DiagramOps; onDone: () => void; onRenamed: (to: string) => void }) {
  const [name, setName] = useState(g.name);
  const [color, setColor] = useState(g.color);
  const [note, setNote] = useState(g.note);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    let nodes = ops.nodes;
    let meta = ops.meta;
    let target = g.name;
    const want = name.trim();
    if (want !== g.name) {
      const problem = groupNameProblem(nodes, meta, want, g.name);
      if (problem) return setError(problem);
      const r = renameGroup(nodes, meta, g.name, want);
      if (r) {
        nodes = r.nodes;
        meta = r.meta;
        target = want;
      }
    }
    meta = patchGroupMeta(meta, target, { color, note: note.trim() || undefined });
    ops.commit({ nodes, meta });
    if (target !== g.name) onRenamed(target);
    onDone();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <div className="mx-3 mb-3 p-3 rounded-lg border border-white/[0.08] bg-black/20 space-y-2.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          onKey(e);
        }}
        aria-label="Group name"
        className={drawerInput}
      />
      <Swatches value={color} onChange={setColor} />
      <textarea value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} rows={2} placeholder="What does this module cover?" aria-label="Group note" className={`${drawerInput} h-auto py-1.5 resize-none`} />
      {error && <p className="text-[11.5px] text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className={drawerBtn}>
          Cancel
        </button>
        <button onClick={save} className={drawerBtnPrimary}>
          Save
        </button>
      </div>
    </div>
  );
}
