"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  onClose: () => void;
  width?: string;
  height?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** drawer = slides from the right instead of centred modal */
  variant?: "modal" | "drawer";
}

export function ModalShell({ title, subtitle, icon, onClose, width = "max-w-4xl", height = "h-[80vh]", children, footer, variant = "modal" }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const drawer = variant === "drawer";
  return (
    <div className={`fixed inset-0 z-[70] flex ${drawer ? "justify-end" : "items-center justify-center p-4 sm:p-6"} bg-black/60 backdrop-blur-sm`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`flex flex-col bg-[#0a0f1c] border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.8)] text-white overflow-hidden ${
          drawer ? "h-full w-full max-w-[460px] border-l rounded-l-2xl animate-in slide-in-from-right-8 duration-200" : `w-full ${width} ${height} max-h-[92vh] rounded-2xl animate-in zoom-in-95 duration-150`
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-white/[0.07] bg-[#070b15] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && <div className="p-2 rounded-xl bg-gradient-to-br from-[#4A90D9]/20 to-[#8B5CF6]/10 border border-[#4A90D9]/25 text-[#4A90D9] shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-wide truncate">{title}</h2>
              {subtitle && <p className="text-[11px] text-white/40 truncate">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-white/[0.07] bg-[#070b15] shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export const btnPrimary = "flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-[#4A90D9] to-[#2d6db5] text-white text-[12px] font-bold shadow-[0_4px_16px_rgba(74,144,217,0.25)] hover:shadow-[0_6px_20px_rgba(74,144,217,0.35)] transition-all disabled:opacity-40 disabled:cursor-not-allowed";
export const btnGhost = "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] text-[12px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
export const inputCls = "w-full bg-white/[0.04] border border-white/[0.09] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/25 outline-none focus:border-[#4A90D9]/60 transition-colors";
export const labelCls = "block text-[10px] uppercase tracking-wider font-semibold text-white/45 mb-1";

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; icon?: React.ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-white/[0.06] shrink-0 overflow-x-auto p-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap transition-all ${value === t.id ? "bg-[#4A90D9]/15 text-white border border-[#4A90D9]/30" : "text-white/50 hover:text-white hover:bg-white/[0.05] border border-transparent"}`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
