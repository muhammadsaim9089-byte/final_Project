"use client";

import React, { useEffect } from "react";
import { X, Keyboard } from "lucide-react";
import { SHORTCUT_CATEGORIES, keyLabel } from "./shortcuts";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// the shortcuts themselves live in ./shortcuts (shared with the Help menu)

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  // Esc closes it, as the sheet itself promises — and only it (capture, stopped): not a drawer or panel behind it
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-lg bg-[#080D1A] border border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.85)] rounded-2xl overflow-hidden flex flex-col p-6 gap-5 animate-in zoom-in-95 duration-150"
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
          <button onClick={onClose} className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors" aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {/* Content categories */}
        <div className="flex flex-col gap-5 overflow-y-auto max-h-[min(60vh,520px)] pr-1 p-scrollbar">
          {SHORTCUT_CATEGORIES.map((category) => (
            <div key={category.title} className="flex flex-col gap-2.5">
              <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-white/35">{category.title}</h4>
              <div className="flex flex-col gap-2">
                {category.items.map((item) => (
                  <div key={item.description} className="flex justify-between items-center gap-3 py-1.5 px-2.5 rounded-xl border border-white/[0.02] bg-white/[0.01]">
                    <span className="text-xs text-white/70 font-sans font-medium">{item.description}</span>
                    <div className="flex items-center gap-1 select-none shrink-0">
                      {item.keys.map((key, keyIdx) => (
                        <React.Fragment key={keyIdx}>
                          {keyIdx > 0 && <span className="text-[10px] text-white/20 font-mono">+</span>}
                          <kbd className="text-[10px] bg-white/[0.06] border border-white/[0.1] px-1.5 py-0.5 rounded text-white/75 font-mono font-bold shadow-inner whitespace-nowrap">{keyLabel(key)}</kbd>
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
