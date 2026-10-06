"use client";

import React, { useEffect } from "react";
import type { Edge, Node } from "@xyflow/react";
import { X } from "lucide-react";
import type { ProjectMeta } from "@/lib/model/types";

/** Width of the Groups and Lineage drawers (the same as Version history's w-96), which the canvas keeps clear of. */
export const SIDE_DRAWER_WIDTH = 384;

export type DiagramSnap = { nodes?: Node[]; edges?: Edge[]; meta?: ProjectMeta };

/** What a drawer needs to read and change the diagram: one `commit` per user action = one undo step. */
export interface DiagramOps {
  nodes: Node[];
  edges: Edge[];
  meta: ProjectMeta;
  commit: (next: DiagramSnap) => void;
}

/**
 * A drawer docked on the canvas's right edge, below the top bars, like Version history and Inspect: solid, full height,
 * the canvas stays usable beside it (select tables, draw lines). Esc closes it unless `onEscape` handles the key first;
 * a field inside that uses Esc itself (cancel a rename) calls `preventDefault()` on it.
 */
export function DrawerShell({
  label,
  icon,
  title,
  subtitle,
  onClose,
  onEscape,
  toolbar,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  onClose: () => void;
  /** return true when Esc was used for something else (leaving a mode, cancelling an edit) */
  onEscape?: () => boolean;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (onEscape?.()) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onEscape]);

  return (
    <aside
      aria-label={label}
      style={{ width: SIDE_DRAWER_WIDTH }}
      className="absolute right-0 top-0 bottom-0 z-40 max-w-full flex flex-col bg-[#0b1020] border-l border-white/[0.08] shadow-[-24px_0_60px_rgba(0,0,0,0.45)] select-none animate-in slide-in-from-right duration-200"
    >
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-white/[0.05] border border-white/[0.1] text-white/80">{icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-white leading-tight">{title}</h2>
            <p className="text-[11.5px] text-white/45 truncate">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 -mr-1 shrink-0 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors"
            aria-label={`Close ${title.toLowerCase()}`}
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        {toolbar && <div className="mt-3">{toolbar}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 p-scrollbar">{children}</div>
    </aside>
  );
}

export const drawerInput =
  "w-full h-8 bg-white/[0.04] border border-white/[0.09] rounded-lg px-2.5 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#4A90D9]/60 transition-colors";
export const drawerSelect =
  "w-full h-8 bg-[#080E18] border border-white/[0.09] rounded-lg px-2 text-[12px] text-white outline-none cursor-pointer focus:border-[#4A90D9]/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
export const drawerBtn =
  "h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold border border-white/[0.1] bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const drawerBtnPrimary =
  "h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] font-semibold bg-[#2563eb] hover:bg-[#3b82f6] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const drawerIconBtn =
  "w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-md text-white/45 hover:text-white hover:bg-white/[0.08] transition-colors";
