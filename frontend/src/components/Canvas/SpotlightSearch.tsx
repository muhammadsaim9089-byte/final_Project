"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Hash, CornerDownLeft, X } from "lucide-react";
import { Node } from "@xyflow/react";

interface SpotlightSearchProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: Node[];
  onSelectNode: (nodeId: string) => void;
}

export function SpotlightSearch({ isOpen, onClose, nodes, onSelectNode }: SpotlightSearchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter nodes (only show table nodes / nodes with labels)
  const filteredNodes = nodes.filter((node) => {
    const label = (node.data?.label as string) || "";
    return label.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle global keyboard nav inside the modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredNodes.length > 0 ? (prev + 1) % filteredNodes.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredNodes.length > 0 ? (prev - 1 + filteredNodes.length) % filteredNodes.length : 0
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredNodes[selectedIndex]) {
          onSelectNode(filteredNodes[selectedIndex].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredNodes, selectedIndex, onClose, onSelectNode]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector("[data-active='true']");
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 p-4 pointer-events-auto"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-lg bg-[#080D1A]/95 border border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.85)] rounded-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Box */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] bg-white/[0.01]">
          <Search size={18} className="text-white/40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-white placeholder-white/35 text-[13px] outline-none border-0 p-0 font-sans"
            placeholder="Search tables on canvas..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <span className="text-[10px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-white/55 font-mono select-none">
            ESC
          </span>
          <button 
            onClick={onClose}
            className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results List */}
        <div 
          ref={listRef}
          className="max-h-[300px] overflow-y-auto p-2 flex flex-col gap-1 p-scrollbar"
        >
          {filteredNodes.length > 0 ? (
            filteredNodes.map((node, i) => {
              const label = (node.data?.label as string) || "Untitled Table";
              const cols = (node.data?.attributes as any[]) || [];
              const group = (node.data?.group as string) || "";
              const color = (node.data?.color as string) || "";
              const isSelected = i === selectedIndex;

              return (
                <button
                  key={node.id}
                  data-active={isSelected}
                  onClick={() => onSelectNode(node.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    isSelected
                      ? "bg-[#4A90D9]/15 border-[#4A90D9]/40 text-white shadow-[0_0_15px_rgba(74,144,217,0.15)]"
                      : "bg-transparent border-transparent text-white/70 hover:bg-white/[0.03] hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div 
                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10"
                      style={{ backgroundColor: color || "#C2EF4E" }}
                    />
                    <div className="min-w-0">
                      <span className="font-semibold text-xs font-sans tracking-wide block truncate">
                        {label}
                      </span>
                      {group && (
                        <span className="text-[9px] font-mono uppercase bg-white/[0.06] px-1.5 py-0.2 rounded text-white/45 mt-0.5 inline-block">
                          {group}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-white/40 font-mono flex items-center gap-1">
                      <Hash size={10} />
                      {cols.length} cols
                    </span>

                    {isSelected && (
                      <span className="flex items-center gap-0.5 text-[9px] text-[#4A90D9] font-mono font-bold bg-[#4A90D9]/10 px-1.5 py-0.5 rounded border border-[#4A90D9]/20">
                        focus
                        <CornerDownLeft size={8} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-8 px-4 text-center text-white/35 text-xs font-sans">
              No matching tables found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
