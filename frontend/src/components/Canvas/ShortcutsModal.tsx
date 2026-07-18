"use client";

import React from "react";
import { X, Keyboard, Command } from "lucide-react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  items: ShortcutItem[];
}

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  if (!isOpen) return null;

  const categories: ShortcutCategory[] = [
    {
      title: "General Navigation",
      items: [
        { keys: ["Ctrl", "K"], description: "Search & focus table on canvas" },
        { keys: ["?"], description: "Toggle this shortcuts cheat sheet" },
        { keys: ["Esc"], description: "Close active modal, search, or sidebars" },
      ],
    },
    {
      title: "SQL & Import",
      items: [
        { keys: ["Ctrl", "S"], description: "Copy generated SQL schema to clipboard" },
        { keys: ["Ctrl", "I"], description: "Open SQL DDL workspace & Import tab" },
        { keys: ["Ctrl", "Enter"], description: "Run current query (in SQLite Sandbox)" },
      ],
    },
    {
      title: "Canvas Actions",
      items: [
        { keys: ["Ctrl", "Z"], description: "Undo last schema change" },
        { keys: ["Ctrl", "Y"], description: "Redo undone schema change" },
      ],
    },
  ];

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-[#080D1A]/95 border border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.85)] rounded-2xl overflow-hidden flex flex-col p-6 gap-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#4A90D9]/10 text-[#4A90D9]">
              <Keyboard size={16} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white tracking-wide">Keyboard Shortcuts</h3>
              <span className="text-[9.5px] text-white/35 font-mono uppercase tracking-wider">Editor Cheat Sheet</span>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content categories */}
        <div className="flex flex-col gap-5 overflow-y-auto max-h-[350px] pr-1 p-scrollbar">
          {categories.map((category, idx) => (
            <div key={idx} className="flex flex-col gap-2.5">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/35">
                {category.title}
              </h4>
              <div className="flex flex-col gap-2">
                {category.items.map((item, itemIdx) => (
                  <div 
                    key={itemIdx} 
                    className="flex justify-between items-center py-1.5 px-2.5 rounded-xl border border-white/[0.02] bg-white/[0.01]"
                  >
                    <span className="text-xs text-white/70 font-sans font-medium">
                      {item.description}
                    </span>
                    <div className="flex items-center gap-1 select-none shrink-0">
                      {item.keys.map((key, keyIdx) => (
                        <React.Fragment key={keyIdx}>
                          {keyIdx > 0 && <span className="text-[10px] text-white/20 font-mono">+</span>}
                          <kbd className="text-[10px] bg-white/[0.06] border border-white/[0.1] px-1.5 py-0.5 rounded text-white/75 font-mono font-bold shadow-inner flex items-center gap-0.5">
                            {key === "Ctrl" && <Command size={10} className="text-white/40" />}
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="text-[10px] text-white/30 font-sans text-center bg-white/[0.01] border border-white/[0.04] py-2.5 rounded-xl">
          Press <kbd className="bg-white/[0.04] border border-white/[0.06] px-1 py-0.2 rounded text-white/50">?</kbd> anywhere on the canvas to open this helper.
        </div>
      </div>
    </div>
  );
}
