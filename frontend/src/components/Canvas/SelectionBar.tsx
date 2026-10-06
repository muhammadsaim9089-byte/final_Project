"use client";

import React, { useEffect, useRef, useState } from "react";
import { GitBranch, Group, X } from "lucide-react";

interface SelectionBarProps {
  /** names of the selected tables */
  labels: string[];
  /** existing groups, offered as "or add to …" */
  groups: { name: string; color: string }[];
  /** the naming field is open (the Group button, or Ctrl+G) */
  grouping: boolean;
  setGrouping: (on: boolean) => void;
  /** creates the group; returns why it couldn't, or null */
  onCreateGroup: (name: string) => string | null;
  onAddToGroup: (name: string) => void;
  /** exactly two tables: open the Lineage drawer's form with them */
  onLinkDependency?: () => void;
  onClear: () => void;
  /** horizontal centre and max width of the visible canvas (left of a docked drawer) */
  left: number | string;
  maxWidth?: number;
  /** distance from the top of the canvas (lower when the Draw dependency banner is showing) */
  top?: number;
}

/**
 * Floats over the top of the canvas while several tables are selected: group them (Ctrl+G), add them to an existing
 * group, or link two of them as a data dependency — the canvas-side shortcuts to the Groups and Lineage drawers.
 */
export function SelectionBar({ labels, groups, grouping, setGrouping, onCreateGroup, onAddToGroup, onLinkDependency, onClear, left, maxWidth, top = 16 }: SelectionBarProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!grouping) {
      setName("");
      setError(null);
      return;
    }
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [grouping]);

  const create = () => {
    const problem = onCreateGroup(name);
    if (problem) setError(problem);
  };

  const count = labels.length;
  // a narrow canvas (a drawer open beside the code panel): shorter labels, no shortcut hint, so it stays on one line
  const compact = maxWidth !== undefined && maxWidth < 560;
  // very narrow: the count moves onto the Group button
  const tiny = maxWidth !== undefined && maxWidth < 330;
  const what = count === 1 ? labels[0] : compact ? `${count} selected` : `${count} tables selected`;

  return (
    <div role="toolbar" aria-label="Selected tables" className="absolute z-30 -translate-x-1/2 w-max pointer-events-auto" style={{ left, maxWidth, top }}>
      <div className={`flex items-center gap-1 ${tiny ? "pl-1" : "pl-3"} pr-1 py-1 rounded-xl bg-[#0d1322] border border-white/[0.12] shadow-[0_12px_36px_rgba(0,0,0,0.55)] text-white`} title={tiny ? labels.join(", ") : undefined}>
        {!tiny && (
          <span className="min-w-0 text-[12px] font-semibold text-white/80 whitespace-nowrap mr-1 max-w-[220px] truncate" title={labels.join(", ")}>
            {what}
          </span>
        )}
        <button
          onClick={() => setGrouping(!grouping)}
          aria-expanded={grouping}
          className={`shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors ${grouping ? "bg-[#2563eb] text-white" : "text-white/85 hover:bg-white/[0.08]"}`}
          title="Put the selected tables in a group (Ctrl+G)"
        >
          <Group size={14} /> Group{tiny ? ` ${count}` : ""}
          {!compact && <kbd className={`ml-0.5 text-[10px] font-mono px-1 rounded whitespace-nowrap ${grouping ? "bg-white/20" : "bg-white/[0.08] text-white/50"}`}>Ctrl G</kbd>}
        </button>
        {onLinkDependency && (
          <button onClick={onLinkDependency} className="shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap text-amber-200/90 hover:bg-amber-500/10 transition-colors" title="Add a data dependency between these two tables">
            <GitBranch size={14} /> {compact ? "Link" : "Link as dependency"}
          </button>
        )}
        <button onClick={onClear} className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-lg text-white/45 hover:text-white hover:bg-white/[0.08] transition-colors" title="Clear the selection" aria-label="Clear the selection">
          <X size={14} />
        </button>
      </div>

      {grouping && (
        <div className="mt-2 w-[320px] max-w-full mx-auto p-3 rounded-xl bg-[#0d1322] border border-white/[0.12] shadow-[0_16px_44px_rgba(0,0,0,0.6)] space-y-2.5" onKeyDown={(e) => e.stopPropagation()}>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setGrouping(false);
                }
              }}
              placeholder="New group name"
              aria-label="New group name"
              className="flex-1 min-w-0 h-8 bg-white/[0.05] border border-white/[0.1] rounded-lg px-2.5 text-[12px] text-white placeholder:text-white/30 outline-none focus:border-[#4A90D9]/60"
            />
            <button onClick={create} className="h-8 px-3 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[12px] font-semibold transition-colors">
              Create
            </button>
          </div>
          {error && <p className="text-[11.5px] text-red-300">{error}</p>}
          {groups.length > 0 && (
            <div>
              <span className="block mb-1.5 text-[10.5px] uppercase tracking-wider text-white/35">or add to</span>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => (
                  <button key={g.name} onClick={() => onAddToGroup(g.name)} className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-white/[0.1] bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.07] transition-colors">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: g.color }} />
                    <span className="text-[11.5px] text-white/80">{g.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
