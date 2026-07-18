"use client";

import { useState, useRef, useEffect } from "react";
import { Undo2, Redo2, Eye, KeyRound, PanelTopClose } from "lucide-react";
import { ReactFlowInstance } from "@xyflow/react";

export type DetailsLevel = "all" | "keys" | "headers";

interface CanvasToolbarProps {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  rfInstance: ReactFlowInstance | null;
  detailsLevel: DetailsLevel;
  setDetailsLevel: (level: DetailsLevel) => void;
}

export function CanvasToolbar({ undo, redo, canUndo, canRedo, rfInstance, detailsLevel, setDetailsLevel }: CanvasToolbarProps) {
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Sync zoom level from viewport
  useEffect(() => {
    if (!rfInstance) return;
    const viewport = rfInstance.getViewport();
    setZoomLevel(Math.round(viewport.zoom * 100));

    // Listen for viewport changes
    const onMove = () => {
      const vp = rfInstance.getViewport();
      setZoomLevel(Math.round(vp.zoom * 100));
    };

    // Poll viewport changes (React Flow doesn't expose a stable onViewportChange in all versions)
    const interval = setInterval(onMove, 300);
    return () => clearInterval(interval);
  }, [rfInstance]);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as HTMLElement) &&
        buttonRef.current && !buttonRef.current.contains(e.target as HTMLElement)
      ) {
        setShowZoomMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleZoomIn = () => {
    rfInstance?.zoomIn({ duration: 300 });
    setShowZoomMenu(false);
  };

  const handleZoomOut = () => {
    rfInstance?.zoomOut({ duration: 300 });
    setShowZoomMenu(false);
  };

  const handleZoomTo100 = () => {
    rfInstance?.zoomTo(1, { duration: 300 });
    setShowZoomMenu(false);
  };

  const handleZoomToFit = () => {
    rfInstance?.fitView({ duration: 500, padding: 0.15 });
    setShowZoomMenu(false);
  };

  const handleZoomToSelection = () => {
    // Zoom to fit is the best fallback since xyflow doesn't have native "zoom to selection"
    rfInstance?.fitView({ duration: 500, padding: 0.15 });
    setShowZoomMenu(false);
  };

  const zoomMenuItems = [
    { label: "Zoom in", shortcut: "Ctrl +", action: handleZoomIn },
    { label: "Zoom out", shortcut: "Ctrl −", action: handleZoomOut },
    { divider: true },
    { label: "Zoom to 100%", shortcut: "⇧ 0", action: handleZoomTo100 },
    { label: "Zoom to Fit", shortcut: "⇧ 1", action: handleZoomToFit },
    { label: "Zoom to Selection", shortcut: "⇧ 2", action: handleZoomToSelection },
  ];

  const detailsOptions: { level: DetailsLevel; icon: React.ReactNode; label: string; title: string }[] = [
    { level: "all", icon: <Eye size={13} />, label: "All", title: "Show all columns" },
    { level: "keys", icon: <KeyRound size={13} />, label: "Keys", title: "Show only PK/FK columns" },
    { level: "headers", icon: <PanelTopClose size={13} />, label: "Headers", title: "Show table headers only" },
  ];

  return (
    <div className="flex items-center gap-1 relative">
      {/* Undo */}
      <button
        onClick={undo}
        disabled={!canUndo}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150 ${
          canUndo
            ? "text-white/60 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.15]"
            : "text-white/15 cursor-not-allowed"
        }`}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={15} strokeWidth={2} />
      </button>

      {/* Redo */}
      <button
        onClick={redo}
        disabled={!canRedo}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150 ${
          canRedo
            ? "text-white/60 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.15]"
            : "text-white/15 cursor-not-allowed"
        }`}
        title="Redo (Ctrl+Y)"
      >
        <Redo2 size={15} strokeWidth={2} />
      </button>

      {/* Divider */}
      <div className="w-px h-4 bg-white/[0.08] mx-0.5" />

      {/* Zoom Percentage Button */}
      <button
        ref={buttonRef}
        onClick={() => setShowZoomMenu(p => !p)}
        className={`h-8 px-2.5 flex items-center justify-center rounded-lg text-[11px] font-mono font-bold transition-all duration-150 ${
          showZoomMenu
            ? "text-white bg-white/[0.1] border border-white/[0.12]"
            : "text-white/50 hover:text-white hover:bg-white/[0.08] border border-transparent"
        }`}
        title="Zoom options"
      >
        {zoomLevel}%
      </button>

      {/* Divider */}
      <div className="w-px h-4 bg-white/[0.08] mx-0.5" />

      {/* Details Level Segmented Control */}
      <div className="flex items-center rounded-lg bg-white/[0.03] border border-white/[0.06] p-0.5">
        {detailsOptions.map((opt) => (
          <button
            key={opt.level}
            onClick={() => setDetailsLevel(opt.level)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all duration-150 ${
              detailsLevel === opt.level
                ? "bg-[#4A90D9]/20 text-[#4A90D9] border border-[#4A90D9]/30 shadow-inner"
                : "text-white/40 hover:text-white/70 hover:bg-white/[0.04] border border-transparent"
            }`}
            title={opt.title}
          >
            {opt.icon}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Zoom Menu Popup */}
      {showZoomMenu && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-0 mb-2 w-[220px] bg-[#0C1222]/95 backdrop-blur-xl border border-white/[0.1] rounded-xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] overflow-hidden z-50"
        >
          <div className="py-1.5">
            {zoomMenuItems.map((item, i) => {
              if ('divider' in item) {
                return <div key={i} className="h-px bg-white/[0.06] my-1" />;
              }
              return (
                <button
                  key={i}
                  onClick={item.action}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="text-[10px] text-white/30 font-mono">{item.shortcut}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

