"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Database, Sparkles, Cable, Undo2, Redo2, Eye, KeyRound, 
  PanelTopClose, ZoomIn, ZoomOut, ChevronUp, Check
} from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { DetailsLevel } from "./CanvasToolbar";
import { ReactFlowInstance } from "@xyflow/react";

interface CanvasBottomBarProps {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  rfInstance: ReactFlowInstance | null;
  detailsLevel: DetailsLevel;
  setDetailsLevel: (level: DetailsLevel) => void;
}

export function CanvasBottomBar({
  undo,
  redo,
  canUndo,
  canRedo,
  rfInstance,
  detailsLevel,
  setDetailsLevel,
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

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) {
        setDetailDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const navItems = [
    { 
      id: 'relations', 
      label: 'Relations', 
      icon: <Cable size={16} />, 
      onClick: () => layout.triggerToggleRelations() 
    },
    { 
      id: 'sql', 
      label: 'SQL Sandbox', 
      icon: <Database size={16} />, 
      onClick: () => layout.triggerToggleSqlSandbox() 
    },
    { 
      id: 'ai', 
      label: 'AI Audit', 
      icon: <Sparkles size={16} className="text-[#4A90D9]" />, 
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
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 pointer-events-auto select-none">
      <div className="bg-[#090d16]/92 backdrop-blur-2xl border border-white/[0.1] rounded-2xl shadow-[0_16px_56px_rgba(0,0,0,0.75)] px-3 py-1.5 flex items-center gap-2">
        {/* ── Section 1: Navigation Tools ── */}
        <div className="flex items-center gap-1">
          {navItems.map((item) => (
            <div key={item.id} className="relative group">
              <button
                onClick={() => {
                  item.onClick();
                }}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                  (item as any).isActive
                    ? 'bg-[#4A90D9]/25 text-[#4A90D9] ring-1 ring-[#4A90D9]/40 scale-105 shadow-[0_0_12px_rgba(74,144,217,0.25)]'
                    : 'text-white/70 hover:text-white hover:bg-white/[0.08] active:scale-95'
                }`}
              >
                {item.icon}
              </button>

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-md bg-[#0C1222]/95 border border-white/10 text-[10px] font-semibold text-white whitespace-nowrap shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {item.label}
              </div>
            </div>
          ))}
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
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-white/[0.1] mx-1" />

        {/* ── Section 4: Detail Level Dropdown ── */}
        <div className="relative" ref={detailRef}>
          <button
            onClick={() => setDetailDropdownOpen(!detailDropdownOpen)}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all text-white/80 hover:text-white"
            title="Detail level"
          >
            <span className="text-[10px] font-semibold text-white/50 uppercase tracking-wider">Detail level:</span>
            {activeDetail.icon}
            <ChevronUp size={11} className={`text-white/40 transition-transform duration-200 ${detailDropdownOpen ? '' : 'rotate-180'}`} />
          </button>

          {/* Dropdown */}
          {detailDropdownOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-44 bg-[#0c101b]/98 backdrop-blur-xl border border-white/[0.1] rounded-xl shadow-[0_-8px_40px_rgba(0,0,0,0.7)] py-1.5 z-50">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
