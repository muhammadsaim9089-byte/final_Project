import { memo, useLayoutEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps, useReactFlow, useStore, NodeToolbar } from "@xyflow/react";
import { Key, Type, Server, ShoppingCart, Link, ChevronDown, ChevronUp, Pencil, Copy, Trash2, Table2, Palette, Layers, Code2, MessageSquare, Info, KeyRound, UserRound, Orbit } from "lucide-react";
import { useHoverSync } from "../HoverContext";
import { useDisplay } from "../DisplayContext";
import { WHOLE_TABLE } from "@/lib/model/lineage";
import { requestCanvasDelete } from "../deleteRequest";
import { cardDetail, lodForZoom } from "@/lib/lod";
import { estimateNodeSize } from "@/lib/nodeSize";
import type { HubKind } from "@/lib/model/hubs";

// tone: text + border; tint: the translucent fill used where the badge sits inside the card
const HUB_STYLE: Record<HubKind, { Icon: typeof KeyRound; tone: string; tint: string }> = {
  tenant: { Icon: KeyRound, tone: "border-amber-400/40 text-amber-300", tint: "bg-amber-500/10" },
  user: { Icon: UserRound, tone: "border-sky-400/40 text-sky-300", tint: "bg-sky-500/10" },
  hub: { Icon: Orbit, tone: "border-violet-400/40 text-violet-300", tint: "bg-violet-500/10" },
};

const SWATCHES = ["", "#4A90D9", "#10B981", "#F59E0B", "#F87171", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16", "#64748b"];

function TableNodeImpl(props: NodeProps) {
  const { data, id } = props;
  const { label, schema = "", alias = "", icon = "server", attributes = [], isActive, spotlightActive, color = "", group = "", diffStatus, errors = [], warnings = [] } = data as any;
  const { activeHover, setActiveHover } = useHoverSync();
  const display = useDisplay();
  const { getNodes, getEdges, setNodes } = useReactFlow();
  const [popover, setPopover] = useState<"color" | "group" | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const HeaderIcon = icon === "cart" ? ShoppingCart : Server;
  const isTargetNode = activeHover?.targetNodeId === id;

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;
  const commentsCount = Array.isArray((data as any).comments) ? (data as any).comments.length : 0;

  const globalDetailsLevel = display.detailsLevel || (data as any).globalDetailsLevel || "all";
  const isIndividualCollapsed = !!(data as any).isCollapsed;
  const isCollapsed = globalDetailsLevel === "headers" || (globalDetailsLevel === "all" && isIndividualCollapsed);

  // ── semantic zoom (lib/lod): the card shows only what is readable at this zoom. The selector returns a level, so a
  // card re-renders when a threshold is crossed — not on every frame of a pan or zoom.
  const lod = useStore((s) => lodForZoom(s.transform[2]));
  const userDetail = isCollapsed ? "headers" : globalDetailsLevel === "keys" ? "keys" : "all";
  const detail = cardDetail(userDetail, lod);
  const reduced = detail !== userDetail;
  // The card keeps the height it has at the user's own level, so group frames, relationship lines and the layout do not
  // move while zooming: measured whenever the card shows that level, estimated if it has not been shown yet.
  const boxRef = useRef<HTMLDivElement>(null);
  const naturalH = useRef<number | null>(null);
  const naturalW = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (reduced || !boxRef.current) return;
    naturalH.current = boxRef.current.offsetHeight;
    naturalW.current = boxRef.current.offsetWidth;
  });
  const lockedH = reduced ? naturalH.current ?? estimateNodeSize({ id, type: "tableMode", position: { x: 0, y: 0 }, data: { ...(data as any), globalDetailsLevel: userDetail, isCollapsed: false } }).height : undefined;
  const showRows = detail === "all" || detail === "keys";
  const keyCount = attributes.filter((a: any) => a.isPk || a.isFk).length;

  // ── hub tables: a badge per hub this table references while those lines are hidden; a hub says it is one ──
  const hubSelf = display.hubs.hubs.get(id);
  const hubRefs = new Map<string, { hub: string; kind: HubKind; columns: string[] }>();
  if (!display.hubEdgesShown) {
    for (const r of display.hubs.refsByTable.get(id) || []) {
      const cur = hubRefs.get(r.hubId) || { hub: r.hub, kind: r.kind, columns: [] };
      if (r.column && !cur.columns.includes(r.column)) cur.columns.push(r.column);
      hubRefs.set(r.hubId, cur);
    }
  }

  // ── lineage highlighting ──
  const lineage = display.lineage;
  const inLineage = !!lineage && lineage.columns.has(id);
  const lineageCols = lineage?.columns.get(id);
  const dimmed = !!lineage && !inLineage;
  const hasDeps = display.lineageTables.has(id);

  const isReadOnly = !!display.readOnly;

  const patchData = (patch: Record<string, unknown>) => {
    if (isReadOnly) return;
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    patchData({ isCollapsed: !isIndividualCollapsed });
  };

  const handleOpenEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly) return;
    window.dispatchEvent(new CustomEvent("open-table-editor", { detail: { id } }));
  };

  const handleOpenSampleData = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly) return;
    window.dispatchEvent(new CustomEvent("open-sample-data-modal", { detail: { id } }));
  };

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly) return;
    const nodes = getNodes();
    const currentNode = nodes.find((n) => n.id === id);
    if (!currentNode) return;
    const newId = `table_${Date.now()}`;
    const baseLabel = ((currentNode.data as any).label as string) || "table";
    let copyLabel = `${baseLabel}_copy`;
    let count = 1;
    while (nodes.some((n) => (n.data as any).label === copyLabel)) {
      count++;
      copyLabel = `${baseLabel}_copy${count}`;
    }
    const newNode = {
      ...currentNode,
      id: newId,
      selected: true,
      position: { x: currentNode.position.x + 40, y: currentNode.position.y + 40 },
      data: { ...currentNode.data, label: copyLabel },
    };
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly) return;
    requestCanvasDelete({ nodeIds: [id], anchor: e.currentTarget }); // confirms by name, then deletes (one undo step)
  };

  const titleText = (schema && schema !== "public" ? `${schema}.` : "") + label;

  return (
    <>
      {/* Node-level handles come first in the DOM so edges without a column default to them. */}
      <Handle type="target" position={Position.Left} isConnectable={!isReadOnly} className="w-2 h-2 rounded-full border-none opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={!isReadOnly} className="w-2 h-2 rounded-full border-none opacity-0" />

      {/* Node Floating Action Toolbar */}
      <NodeToolbar
        isVisible={props.selected && !isReadOnly}
        position={Position.Top}
        offset={8}
        className="flex items-center gap-1 bg-[#0c101b]/95 border border-white/[0.12] backdrop-blur-md shadow-2xl rounded-xl p-1.5 transition-all duration-200 select-none z-50"
      >
        <button type="button" onClick={handleOpenEditor} className="p-1.5 rounded-lg text-blue-400 hover:text-white hover:bg-blue-500/20 transition-all flex items-center justify-center cursor-pointer" title="Edit table (columns, keys, indexes, notes)">
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            display.onReveal(id);
          }}
          className="p-1.5 rounded-lg text-violet-300 hover:text-white hover:bg-violet-500/20 transition-all flex items-center justify-center cursor-pointer"
          title="Go to DBML definition"
        >
          <Code2 size={14} />
        </button>
        <button type="button" onClick={handleOpenSampleData} className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-500/20 transition-all flex items-center justify-center cursor-pointer" title="Sample data records">
          <Table2 size={14} />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPopover(popover === "color" ? null : "color");
            }}
            className="p-1.5 rounded-lg text-amber-300 hover:text-white hover:bg-amber-500/20 transition-all flex items-center justify-center cursor-pointer"
            title="Header colour"
          >
            <Palette size={14} />
          </button>
          {popover === "color" && (
            <div className="absolute top-full left-0 mt-2 p-2 bg-[#0c101b] border border-white/[0.12] rounded-xl shadow-2xl flex flex-wrap gap-1.5 w-[132px] z-50" onClick={(e) => e.stopPropagation()}>
              {SWATCHES.map((c) => (
                <button
                  key={c || "none"}
                  onClick={() => {
                    patchData({ color: c });
                    setPopover(null);
                  }}
                  className={`w-5 h-5 rounded-full border ${color === c ? "border-white ring-1 ring-white/60" : "border-white/20"} hover:scale-110 transition-transform`}
                  style={{ background: c || "transparent" }}
                  title={c || "No colour"}
                >
                  {!c && <span className="text-[9px] text-white/50 leading-none">∅</span>}
                </button>
              ))}
              <label className="w-full flex items-center gap-1.5 mt-1 text-[10px] text-white/50">
                Custom
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#4A90D9"} onChange={(e) => patchData({ color: e.target.value })} className="w-8 h-5 bg-transparent border-0 p-0 cursor-pointer" />
              </label>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPopover(popover === "group" ? null : "group");
            }}
            className={`p-1.5 rounded-lg hover:text-white hover:bg-sky-500/20 transition-all flex items-center justify-center cursor-pointer ${group ? "text-sky-300" : "text-sky-400"}`}
            title="Table group"
          >
            <Layers size={14} />
          </button>
          {popover === "group" && (
            <div className="absolute top-full left-0 mt-2 p-2 bg-[#0c101b] border border-white/[0.12] rounded-xl shadow-2xl w-[180px] z-50 space-y-1" onClick={(e) => e.stopPropagation()}>
              <div className="text-[9px] uppercase tracking-wider text-white/40 px-1">Move to group</div>
              {display.groupNames.map((g) => (
                <button
                  key={g}
                  onClick={() => {
                    if (!isReadOnly) display.onSetTableGroup(id, g);
                    setPopover(null);
                  }}
                  className={`w-full text-left px-2 py-1 rounded-md text-[11px] hover:bg-white/[0.06] ${g === group ? "text-sky-300" : "text-white/75"}`}
                >
                  {g}
                </button>
              ))}
              <div className="flex gap-1 pt-1">
                <input
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newGroup.trim()) {
                      if (!isReadOnly) display.onSetTableGroup(id, newGroup.trim());
                      setNewGroup("");
                      setPopover(null);
                    }
                  }}
                  placeholder="New group…"
                  className="flex-1 min-w-0 bg-white/[0.05] border border-white/[0.1] rounded-md px-2 py-1 text-[11px] text-white outline-none"
                />
              </div>
              {group && (
                <button
                  onClick={() => {
                    if (!isReadOnly) display.onSetTableGroup(id, "");
                    setPopover(null);
                  }}
                  className="w-full text-left px-2 py-1 rounded-md text-[11px] text-red-300 hover:bg-red-500/10"
                >
                  Remove from group
                </button>
              )}
            </div>
          )}
        </div>

        <button type="button" onClick={handleDuplicate} className="p-1.5 rounded-lg text-sky-400 hover:text-white hover:bg-sky-500/20 transition-all flex items-center justify-center cursor-pointer" title="Duplicate table">
          <Copy size={14} />
        </button>
        <button type="button" onClick={handleDelete} className="p-1.5 rounded-lg text-red-400 hover:text-white hover:bg-red-500/20 transition-all flex items-center justify-center cursor-pointer" title="Delete table">
          <Trash2 size={14} />
        </button>
      </NodeToolbar>

      <div
        ref={boxRef}
        onDoubleClick={handleOpenEditor}
        className={`node-panel relative w-60 p-4 bg-[#080D1A]/90 shadow-[0_16px_40px_rgba(0,0,0,0.6)] border transition-all duration-300 rounded-2xl
          ${hasErrors
            ? "border-red-500/50 ring-2 ring-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]"
            : diffStatus === "added"
              ? "border-emerald-500 ring-2 ring-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.2)]"
              : diffStatus === "modified"
                ? "border-amber-500 ring-2 ring-amber-500/30 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
                : diffStatus === "deleted"
                  ? "border-red-500/40 ring-1 ring-red-500/20 opacity-50 bg-[#080D1A]/50"
                  : isActive
                    ? "border-transparent ring-2 ring-lime-green shadow-[0_0_30px_rgba(194,239,78,0.25)]"
                    : inLineage
                      ? "border-amber-400/60 ring-1 ring-amber-400/40"
                      : "border-white/[0.08] hover:border-white/[0.15] hover:shadow-[0_20px_48px_rgba(0,0,0,0.7)]"
          }
          ${isTargetNode ? "border-purple-500/60 ring-1 ring-purple-500/40 shadow-[0_0_30px_rgba(124,58,237,0.3)]" : ""}
          ${spotlightActive ? "spotlight-pulse-node" : ""}`}
        style={{
          borderTopColor: hasErrors ? "#ef4444" : diffStatus === "added" ? "#10b981" : diffStatus === "modified" ? "#f59e0b" : diffStatus === "deleted" ? "#ef4444" : color || "var(--theme-color, #C2EF4E)",
          borderTopWidth: "4px",
          fontFamily: "var(--node-font, Vagnola, sans-serif)",
          opacity: dimmed ? 0.28 : ("var(--node-opacity, 1)" as any),
          height: lockedH,
          overflow: reduced ? "hidden" : undefined,
        }}
      >
        {detail === "overview" ? (
          // zoomed far out: name, icon and size in type large enough to read at this zoom
          <div className={`h-full min-h-0 flex items-center justify-center text-center ${(lockedH ?? 0) < 150 ? "flex-row gap-3" : "flex-col gap-3"}`}>
            <div className="p-2 rounded-xl shrink-0 bg-lime-green/10 text-lime-green" style={color ? { background: `${color}22`, color } : undefined}>
              <HeaderIcon size={(lockedH ?? 0) < 150 ? 22 : 34} />
            </div>
            <div className="min-w-0 max-w-full">
              <div
                className={`font-bold uppercase leading-tight [overflow-wrap:anywhere] ${diffStatus === "deleted" ? "line-through text-white/40" : "text-white"}`}
                // as large as fits the card's width on one line (the card font's capitals ≈ 0.8 em each; beside the icon on a
                // short card); a name too long even at the smallest size wraps after an underscore
                style={{ fontSize: Math.max(15, Math.min((lockedH ?? 0) < 150 ? 22 : 30, Math.floor(((naturalW.current ?? 240) - 34 - ((lockedH ?? 0) < 150 ? 62 : 0)) / (Math.max(1, titleText.length) * 0.8)))) }}
                title={titleText}
              >
                {titleText.replace(/_/g, "_​")}
              </div>
              {(lockedH ?? 0) >= 150 && (
                <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                  <span className="px-3 py-1 rounded-full text-[17px] font-semibold bg-white/[0.08] text-white/70">{attributes.length} cols</span>
                  {hubSelf && <span className={`px-3 py-1 rounded-full text-[17px] font-semibold border ${HUB_STYLE[hubSelf.kind].tint} ${HUB_STYLE[hubSelf.kind].tone}`}>hub · {hubSelf.referencedBy}</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        {/* hub references whose lines are hidden */}
        {hubRefs.size > 0 && (
          <div className="absolute -top-2.5 right-3 flex items-center gap-1 z-10">
            {[...hubRefs].map(([hubId, r]) => {
              const { Icon, tone } = HUB_STYLE[r.kind];
              return (
                <button
                  key={hubId}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    display.onGoToTable(hubId);
                  }}
                  // tabs on the card's top edge, out of the header's flow: the card keeps the height the layout planned for
                  className={`nodrag flex items-center gap-0.5 text-[8px] leading-none font-mono font-bold px-1 py-0.5 rounded-full border bg-[#0c111d] hover:brightness-125 ${tone}`}
                  aria-label={`References ${r.hub}`}
                  title={`🔑 Scoped to ${r.hub}${r.columns.length ? ` through ${r.columns.join(", ")}` : ""}. The line is hidden because ${r.hub} is a hub table (nearly every table references it) — select this table to see it, or turn on hub connections in the bottom toolbar. Click to go to ${r.hub}.`}
                >
                  <Icon size={9} className="shrink-0" />
                  {r.columns.length > 1 && <span>{r.columns.length}</span>}
                </button>
              );
            })}
          </div>
        )}
        {/* Node Header */}
        <div className={`flex items-center justify-between px-0.5 ${showRows ? "mb-4 border-b border-white/[0.06] pb-3" : ""}`}>
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className={`p-1 rounded-lg shrink-0 ${isTargetNode ? "bg-purple-500/10 text-purple-400" : "bg-lime-green/10 text-lime-green"} transition-colors`} style={color ? { background: `${color}22`, color } : undefined}>
              <HeaderIcon size={13} className="font-bold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                <h3 className={`font-bold tracking-wide text-xs uppercase truncate ${diffStatus === "deleted" ? "line-through text-white/40" : "text-white"}`} title={titleText}>
                  {titleText}
                </h3>
                {alias && <span className="text-[8px] font-mono text-white/40 shrink-0">as {alias}</span>}
                {diffStatus && (
                  <span
                    className={`text-[7.5px] font-mono font-bold tracking-widest px-1 py-0.2 rounded uppercase select-none shrink-0 ${
                      diffStatus === "added" ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : diffStatus === "modified" ? "bg-amber-500/10 border border-amber-500/20 text-amber-400" : "bg-red-500/10 border border-red-500/20 text-red-400"
                    }`}
                  >
                    {diffStatus === "added" ? "New" : diffStatus === "modified" ? "Mod" : "Del"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-sans font-semibold text-[10px] tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">{attributes.length} columns</span>
                {group && (
                  <span
                    className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border truncate max-w-[80px]"
                    style={{ backgroundColor: color ? `${color}15` : "rgba(74,144,217,0.1)", borderColor: color ? `${color}40` : "rgba(74,144,217,0.2)", color: color || "#4A90D9" }}
                  >
                    {group}
                  </span>
                )}
                {commentsCount > 0 && (
                  <span className="flex items-center gap-0.5 text-[9px] text-sky-300/80" title={`${commentsCount} comment${commentsCount > 1 ? "s" : ""}`}>
                    <MessageSquare size={9} /> {commentsCount}
                  </span>
                )}
                {hubSelf && (
                  <span
                    className={`flex items-center gap-0.5 text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${HUB_STYLE[hubSelf.kind].tint} ${HUB_STYLE[hubSelf.kind].tone}`}
                    title={`Hub table: referenced by ${hubSelf.referencedBy} tables. ${display.hubEdgesShown ? "" : "Their lines are hidden (each shows a badge instead) — select a table to see its lines, or turn on hub connections in the bottom toolbar."}`}
                  >
                    <Orbit size={9} /> hub · {hubSelf.referencedBy}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Collapse Chevron & Status Indicators */}
          <div className="flex items-center gap-1.5 shrink-0 ml-1.5">
            {globalDetailsLevel === "all" && (
              <button onClick={toggleCollapse} className="p-1 rounded hover:bg-white/5 text-white/40 hover:text-white transition-colors" title={isIndividualCollapsed ? "Expand table" : "Collapse table"}>
                {isIndividualCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            )}
            {hasErrors ? (
              <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-[9px] font-bold text-white shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse" title={`${errors.length} validation errors`}>
                !
              </div>
            ) : hasWarnings ? (
              <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-[9px] font-bold text-black shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse" title={`${warnings.length} validation warnings`}>
                !
              </div>
            ) : (
              <div className="w-1.5 h-1.5 rounded-full bg-lime-green/80 animate-pulse" />
            )}
          </div>
        </div>

        {/* Node Properties */}
        {showRows && (
          <div className="flex flex-col gap-1.5">
            {attributes.length > 0 ? (
              attributes
                .filter((attr: any) => (detail === "keys" ? attr.isPk || attr.isFk : true))
                .map((attr: any, idx: number) => {
                  let FieldIcon = attr.isPk || attr.isFk ? Key : Type;
                  if (attr.isFk && !attr.isPk) FieldIcon = Link;

                  const isHighlightedPk = isTargetNode && attr.isPk;
                  const isHoveredFk = activeHover !== null && activeHover.sourceAttr === attr.name && !isTargetNode;
                  const colErrors = errors.filter((e: any) => e.column === attr.name);
                  const colWarnings = warnings.filter((w: any) => w.column === attr.name);
                  const hasColError = colErrors.length > 0;
                  const hasColWarning = colWarnings.length > 0;
                  const lineageOn = !!lineageCols && (lineageCols.has(attr.name) || lineageCols.has(WHOLE_TABLE));
                  const lineageFocused = display.lineageFocus?.tableId === id && display.lineageFocus.column === attr.name;
                  const tip = hasColError ? colErrors[0].message : hasColWarning ? colWarnings[0].message : attr.comment ? `${attr.name}: ${attr.comment}` : undefined;

                  return (
                    <div
                      key={idx}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          e.stopPropagation();
                          display.onReveal(id, attr.name);
                        } else if (hasDeps) {
                          e.stopPropagation();
                          display.onColumnClick(id, attr.name);
                        }
                      }}
                      onMouseEnter={() => {
                        if (!attr.isFk) return;
                        const edges = getEdges();
                        const nodes = getNodes();
                        let edge = edges.find((e) => e.target === id && (e.data as any)?.targetColumn === attr.name);
                        let targetNodeId = edge ? edge.source : null;
                        if (!edge) {
                          const targetLabel = String(attr.name).toLowerCase().replace("_id", "");
                          const targetNode = nodes.find((n) => n.type === "tableMode" && (String((n.data as any).label).toLowerCase() === targetLabel || String((n.data as any).label).toLowerCase().startsWith(targetLabel)));
                          if (targetNode) {
                            edge = edges.find((e) => (e.source === id && e.target === targetNode.id) || (e.target === id && e.source === targetNode.id));
                            targetNodeId = targetNode.id;
                          }
                        }
                        if (edge && targetNodeId) setActiveHover({ edgeId: edge.id, targetNodeId, sourceAttr: attr.name });
                      }}
                      onMouseLeave={() => {
                        if (attr.isFk) setActiveHover(null);
                      }}
                      className={`relative flex justify-between items-center group/row py-1.5 px-2 rounded-xl transition-all duration-300 border
                        ${attr.isFk || hasDeps ? "cursor-pointer hover:bg-white/[0.04]" : ""}
                        ${lineageFocused
                          ? "bg-amber-500/25 border-amber-400/70"
                          : lineageOn
                            ? "bg-amber-500/10 border-amber-400/40"
                            : hasColError
                              ? "bg-red-950/10 border-red-500/20"
                              : hasColWarning
                                ? "bg-amber-950/10 border-amber-500/20"
                                : isHighlightedPk
                                  ? "bg-purple-950/20 shadow-[0_0_15px_rgba(124,58,237,0.3)] border-purple-500/40"
                                  : isHoveredFk
                                    ? "bg-lime-950/20 border-lime-500/40 shadow-[0_0_15px_rgba(194,239,78,0.2)]"
                                    : "bg-white/[0.01] border-transparent hover:bg-white/[0.03]"
                        }`}
                      title={tip}
                    >
                      {/* per-column connection handles (drag PK → FK to create a relationship) */}
                      {!isReadOnly && (
                        <>
                          <Handle id={`c:${attr.name}:t`} type="target" position={Position.Left} isConnectableStart className="!w-2.5 !h-2.5 !rounded-full !border !border-[#4A90D9] !bg-[#0c101b] !opacity-0 group-hover/row:!opacity-100 !transition-opacity" style={{ left: -21, top: "50%" }} />
                          <Handle id={`c:${attr.name}:s`} type="source" position={Position.Right} isConnectableEnd className="!w-2.5 !h-2.5 !rounded-full !border !border-[#4A90D9] !bg-[#0c101b] !opacity-0 group-hover/row:!opacity-100 !transition-opacity" style={{ right: -21, top: "50%" }} />
                        </>
                      )}

                      <div className="flex gap-2 items-center min-w-0">
                        <FieldIcon
                          size={11}
                          className={`shrink-0 transition-colors ${hasColError ? "text-red-400" : hasColWarning ? "text-amber-400" : isHighlightedPk ? "text-purple-400" : isHoveredFk ? "text-lime-green" : attr.isPk ? "text-amber-400" : attr.isFk ? "text-sky-400" : "text-slate-500"}`}
                        />
                        <span className={`text-[11px] font-mono tracking-wide truncate transition-colors ${hasColError ? "text-red-300" : hasColWarning ? "text-amber-300" : isHighlightedPk || isHoveredFk || lineageOn ? "text-white font-bold" : "text-slate-300"}`}>{attr.name}</span>
                        {attr.comment && <Info size={9} className="text-white/25 shrink-0" />}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {attr.isPk && <span className="text-[7px] font-bold font-mono px-1 py-0.2 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 select-none">PK</span>}
                        {attr.isFk && <span className="text-[7px] font-bold font-mono px-1 py-0.2 rounded bg-sky-500/10 border border-sky-500/25 text-sky-400 select-none">FK</span>}
                        <span className={`text-[9px] font-mono lowercase transition-colors ${hasColError ? "text-red-400/80" : hasColWarning ? "text-amber-400/80" : isHighlightedPk ? "text-purple-300/80" : isHoveredFk ? "text-lime-green/80" : "text-slate-500"}`}>
                          {String(attr.type || "").length > 16 ? String(attr.type).slice(0, 15) + "…" : attr.type}
                        </span>
                      </div>
                    </div>
                  );
                })
            ) : (
              <span className="text-[10px] text-slate-500 italic py-2 text-center">No columns defined...</span>
            )}
            {detail === "keys" && keyCount === 0 && <span className="text-[10px] text-slate-500 italic py-2 text-center">No keys defined...</span>}
            {detail === "keys" && reduced && attributes.length > keyCount && (
              <span className="text-[10px] text-slate-500 py-1 text-center" title="Zoom in to see every column">
                +{attributes.length - keyCount} more column{attributes.length - keyCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {/* Table note (markdown-ish, click for sample data) */}
        {typeof (data as any).comment === "string" && (data as any).comment.trim().length > 0 && detail === "all" && (
          <div
            onClick={handleOpenSampleData}
            className="mt-3 -mx-4 -mb-4 p-3 bg-white/[0.04] dark:bg-white/[0.02] border-t border-white/[0.06] text-[10px] italic text-slate-300 dark:text-white/60 rounded-b-2xl cursor-pointer hover:bg-white/[0.06] transition-colors line-clamp-3"
            title={(data as any).comment as string}
          >
            {(data as any).comment as string}
          </div>
        )}
        </>
        )}
      </div>
    </>
  );
}

export const TableNode = memo(TableNodeImpl);
