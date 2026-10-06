"use client";

import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Database, Sparkles, Undo2, Redo2, Eye, KeyRound,
  PanelTopClose, ZoomIn, ZoomOut, ChevronUp, Check, Maximize2, Waypoints, Network, Orbit, StickyNote
} from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { DetailsLevel } from "./CanvasToolbar";
import { ReactFlowInstance } from "@xyflow/react";
import { AutoArrange, type ArrangeStage } from "./AutoArrange";

/** Width of the "Detail level" menu (Tailwind w-40). */
const DETAIL_MENU_W = 160;

interface CanvasBottomBarProps {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  rfInstance: ReactFlowInstance | null;
  detailsLevel: DetailsLevel;
  setDetailsLevel: (level: DetailsLevel) => void;
  /** Narrow canvas (e.g. AI panel + code panel open): drop the text label so the bar still fits. */
  compact?: boolean;
  /** The SQL playground: open, hidden while a side panel it folded away is back out, or closed. */
  sqlPlayground?: "closed" | "open" | "hidden";
  /** the AI Architecture Audit drawer is open */
  auditOpen?: boolean;
  /** width of a drawer docked on the canvas's right edge (Inspect, audit, version history): the bar centres itself in
   *  the part of the canvas left of it */
  rightInset?: number;
  /**
   * Lines to hub tables (tenants, users …): present only when the diagram has hubs. `hidden` is how many lines the
   * canvas is not drawing right now.
   */
  hubConnections?: { shown: boolean; hidden: number; total: number; names: string[] };
  /** Drops a sticky note in the middle of the visible canvas, ready to type into. */
  onAddNote?: () => void;
}

export function CanvasBottomBar({
  undo,
  redo,
  canUndo,
  canRedo,
  rfInstance,
  detailsLevel,
  setDetailsLevel,
  compact = false,
  sqlPlayground = "closed",
  auditOpen = false,
  rightInset = 0,
  hubConnections,
  onAddNote,
}: CanvasBottomBarProps) {
  const layout = useLayout();
  const [zoomLevel, setZoomLevel] = useState(100);

  // Sync zoom level
  useEffect(() => {
    if (!rfInstance) return;
    const updateZoom = () => {
      try {
        const vp = rfInstance.getViewport();
        setZoomLevel(Math.round(vp.zoom * 100));
      } catch (_e) {
        // ignore
      }
    };
    const interval = setInterval(updateZoom, 300);
    return () => clearInterval(interval);
  }, [rfInstance]);

  const handleZoomIn = () => rfInstance?.zoomIn({ duration: 250 });
  const handleZoomOut = () => rfInstance?.zoomOut({ duration: 250 });
  const handleFitView = () => rfInstance?.fitView({ duration: 450, padding: 0.15 });

  const [detailDropdownOpen, setDetailDropdownOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);

  // The "Detail level" menu is portaled to <body>: inside the canvas it was clipped at the canvas edge (the trigger sits
  // at the far right of the bar) and drawn *under* the minimap. It opens straight above its
  // trigger, centred on it — the "Detail level: 👁" button, or just the eye when the bar is compact — kept inside the window.
  useLayoutEffect(() => {
    if (!detailDropdownOpen) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const r = detailRef.current?.getBoundingClientRect();
      if (!r) return;
      const centre = r.left + r.width / 2;
      const left = Math.min(Math.max(4, centre - DETAIL_MENU_W / 2), window.innerWidth - DETAIL_MENU_W - 4);
      setMenuPos({ left, bottom: window.innerHeight - r.top + 8 });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [detailDropdownOpen]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!detailDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (detailRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setDetailDropdownOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailDropdownOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside, true); // capture: the canvas stops mousedown from bubbling
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [detailDropdownOpen]);

  // Auto arrange: chooser → confirmation, both pointing at this button (showing / hiding relationship lines lives in
  // the side drawer's Inspect tab with nothing selected → Show relationships)
  const arrangeRef = useRef<HTMLDivElement>(null);
  const [arrangeStage, setArrangeStage] = useState<ArrangeStage>(null);

  const navItems = [
    {
      id: 'arrange',
      label: 'Auto arrange',
      icon: <Network size={16} />,
      isActive: arrangeStage !== null,
      onClick: () => setArrangeStage((s) => (s ? null : "choose"))
    },
    {
      id: 'relations',
      label: "Line style: crow's foot / pulse",
      icon: <Waypoints size={16} />,
      onClick: () => layout.triggerToggleRelations()
    },
    ...(hubConnections
      ? [
          {
            id: 'hubs',
            label: hubConnections.shown
              ? `Hide the lines to ${hubConnections.names.join(', ')} (badges instead)`
              : `Show the ${hubConnections.hidden} lines to ${hubConnections.names.join(', ')} — hidden, each table shows a badge instead`,
            icon: <Orbit size={16} />,
            isActive: hubConnections.shown,
            onClick: () => layout.setMeta((m) => ({ ...m, showHubEdges: !m.showHubEdges })),
          },
        ]
      : []),
    ...(onAddNote
      ? [
          {
            id: 'note',
            label: 'Add a sticky note',
            icon: <StickyNote size={16} />,
            onClick: onAddNote,
          },
        ]
      : []),
    {
      id: 'sql',
      label: sqlPlayground === "hidden" ? "SQL playground — hidden while a side panel is open (click to show it)" : sqlPlayground === "open" ? "Close the SQL playground" : "SQL playground",
      icon: <Database size={16} />,
      isActive: sqlPlayground !== "closed",
      onClick: () => layout.triggerToggleSqlSandbox()
    },
    { 
      id: 'ai', 
      label: auditOpen ? 'Close the AI Architecture Audit' : 'AI Architecture Audit',
      icon: <Sparkles size={16} className="text-[#4A90D9]" />,
      isActive: auditOpen,
      onClick: () => layout.triggerToggleAiInsights()
    },
  ];

  const detailsOptions: { level: DetailsLevel; icon: React.ReactNode; label: string }[] = [
    { level: "headers", icon: <PanelTopClose size={14} />, label: "Table names" },
    { level: "keys", icon: <KeyRound size={14} />, label: "Keys only" },
    { level: "all", icon: <Eye size={14} />, label: "All fields" },
  ];

  const activeDetail = detailsOptions.find(o => o.level === detailsLevel) || detailsOptions[2];

  return (
    // A click-through strip across the visible canvas (left of any right-hand drawer) that centres the bar; "safe center"
    // pins it to the left edge instead of letting it overflow both ways when the strip is narrower than the bar.
    // w-max: the bar never wraps its "Detail level:" label onto a second line.
    <div
      className="absolute bottom-5 left-4 z-40 flex [justify-content:safe_center] pointer-events-none select-none"
      style={{ right: 16 + rightInset }}
    >
      <div className="w-max shrink-0 pointer-events-auto bg-[#090d16]/92 backdrop-blur-2xl border border-white/[0.1] rounded-2xl shadow-[0_16px_56px_rgba(0,0,0,0.75)] px-3 py-1.5 flex items-center gap-2">
        {/* ── Section 1: Navigation Tools ── */}
        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <div key={item.id} ref={item.id === 'arrange' ? arrangeRef : undefined} className="relative group">
              <button
                onClick={() => {
                  item.onClick();
                }}
                aria-label={item.label}
                aria-pressed={!!(item as any).isActive}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  (item as any).isActive
                    ? 'bg-[#4A90D9]/25 text-[#4A90D9] ring-1 ring-[#4A90D9]/40 scale-105 shadow-[0_0_12px_rgba(74,144,217,0.25)]'
                    : 'text-white/70 hover:text-white hover:bg-white/[0.08] active:scale-95'
                }`}
              >
                {item.icon}
              </button>

              {/* Tooltip (not while its own popover is open above the button) */}
              <div className={`${(item as any).isActive && item.id === 'arrange' ? 'hidden ' : ''}absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-md bg-[#0C1222] border border-white/10 text-[10px] font-semibold text-white whitespace-nowrap shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150`}>
                {item.label}
              </div>
            </div>
          ))}
          <AutoArrange anchorRef={arrangeRef} stage={arrangeStage} onStageChange={setArrangeStage} />
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.1] mx-1" />

        {/* ── Section 2: Undo / Redo ── */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              canUndo ? 'text-white/70 hover:text-white hover:bg-white/[0.08]' : 'text-white/15 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              canRedo ? 'text-white/70 hover:text-white hover:bg-white/[0.08]' : 'text-white/15 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 size={14} />
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.1] mx-1" />

        {/* ── Section 3: Canvas Controls (Zoom) ── */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={handleZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
            title="Zoom out (-)"
          >
            <ZoomOut size={14} />
          </button>

          <span className="text-[11px] font-mono font-bold text-white/80 min-w-[38px] text-center">
            {zoomLevel}%
          </span>

          <button
            onClick={handleZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
            title="Zoom in (+)"
          >
            <ZoomIn size={14} />
          </button>

          <button
            onClick={handleFitView}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
            title="Fit diagram to screen"
          >
            <Maximize2 size={13} />
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.1] mx-1" />

        {/* ── Section 4: Detail Level Dropdown ── */}
        <div className="relative" ref={detailRef}>
          <button
            onClick={() => setDetailDropdownOpen(!detailDropdownOpen)}
            aria-haspopup="menu"
            aria-expanded={detailDropdownOpen}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all text-white/80 hover:text-white"
            title="Detail level"
          >
            {!compact && <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider whitespace-nowrap">Detail level:</span>}
            {activeDetail.icon}
            <ChevronUp size={11} className={`text-white/40 transition-transform duration-200 ${detailDropdownOpen ? '' : 'rotate-180'}`} />
          </button>

          {/* Menu — the original list, but solid and drawn above everything, centred on its trigger (see menuPos) */}
          {detailDropdownOpen &&
            menuPos &&
            createPortal(
              <div
                ref={menuRef}
                style={{ left: menuPos.left, bottom: menuPos.bottom, width: DETAIL_MENU_W }}
                className="fixed z-[90] bg-[#0c101b] border border-white/[0.1] rounded-xl shadow-[0_-8px_40px_rgba(0,0,0,0.7)] py-1.5 select-none"
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-white/40 uppercase tracking-widest border-b border-white/[0.06] mb-1">Detail level</div>
                {detailsOptions.map((opt) => (
                  <button
                    key={opt.level}
                    onClick={() => { setDetailsLevel(opt.level); setDetailDropdownOpen(false); }}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-all ${
                      detailsLevel === opt.level
                        ? 'text-white bg-white/[0.05]'
                        : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={detailsLevel === opt.level ? 'text-[#4A90D9]' : 'text-white/40'}>{opt.icon}</span>
                      <span className="font-medium">{opt.label}</span>
                    </span>
                    {detailsLevel === opt.level && <Check size={13} className="text-[#4A90D9]" />}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </div>
      </div>
    </div>
  );
}
