"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { FolderOpen, PlusSquare, Component, LayoutTemplate, Database, Sparkles } from "lucide-react";
import { useLayout } from "./LayoutContext";

export function NavigationSidebar() {
  const layout = useLayout();

  const router = useRouter();
  const pathname = usePathname();

  // hide sidebar on the root (main) page
  if (pathname === "/") return null;

  const items = [
    { id: 'projects', label: 'Projects', icon: <FolderOpen size={18} />, onClick: () => layout.triggerToggleDashboard() },
    { id: 'add', label: 'Add Element', icon: <PlusSquare size={18} />, onClick: () => layout.triggerToggleUnifiedSidebar('add') },
    { id: 'inspector', label: 'Inspector', icon: <Component size={18} />, onClick: () => layout.triggerToggleUnifiedSidebar('inspector') },
    { id: 'layout', label: 'Layout', icon: <LayoutTemplate size={18} />, onClick: () => layout.triggerToggleLayout() },
    { id: 'sql', label: 'SQL Sandbox', icon: <Database size={18} />, onClick: () => layout.triggerToggleSqlSandbox() },
    { id: 'ai', label: 'AI Insights', icon: <Sparkles size={18} />, onClick: () => layout.triggerToggleAiInsights() },
  ];

  // Small animated icon with tooltip (re-uses floating-dock behavior)
  function IconButton({ id, label, icon, onClick, isActive }: { id: string; label: string; icon: React.ReactNode; onClick?: () => void; isActive?: boolean }) {
    const [hovered, setHovered] = useState(false);
    return (
      <div className="relative group">
        <button
          onClick={() => onClick?.()}
          title={label}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={`w-11 h-11 rounded-lg flex items-center justify-center transition-all duration-200 ${
            isActive ? 'bg-[#4A90D9]/20 text-[#4A90D9] ring-1 ring-[#4A90D9]/20 scale-105' : 'text-white/70 hover:text-white hover:bg-white/[0.03]'
          }`}
        >
          {icon}
        </button>

        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, x: 0 }}
              animate={{ opacity: 1, x: 10 }}
              exit={{ opacity: 0, x: 0 }}
              className="absolute left-full top-1/2 -translate-y-1/2 w-fit rounded-md border border-white/10 bg-[#0C1520]/95 px-3 py-1.5 text-[11px] font-medium tracking-wide whitespace-pre text-white shadow-ambient pointer-events-none z-50 ml-2"
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <nav className="fixed left-0 top-0 h-screen w-16 z-50 flex flex-col items-center gap-4 bg-[#050712]/80 border-r border-white/[0.04] shadow-[0_6px_30px_rgba(0,0,0,0.6)] px-2 py-4">
      {/* Logo Button (top) */}
      <div className="w-full flex items-center justify-center">
        <button
          onClick={() => router.push('/')}
          className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#d8b9ff] to-[#1a0f2e] shadow-[0_0_16px_rgba(216,185,255,0.25),0_8px_24px_rgba(0,0,0,0.4)] flex items-center justify-center border border-[#d8b9ff]/20 hover:scale-110 hover:shadow-[0_0_24px_rgba(216,185,255,0.4)] transition-all duration-300 cursor-pointer"
          title="DesignDB"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 12h16M12 4v16" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          </svg>
        </button>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center gap-3">
        {items.map(it => (
          <IconButton key={it.id} id={it.id} label={it.label} icon={it.icon} onClick={it.onClick} isActive={false} />
        ))}
      </div>

      <div className="w-full flex items-center justify-center pb-4">
        <IconButton id="sql-toggle" label="Toggle SQL Code Workspace" icon={(
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6h16M4 12h10M4 18h16" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          </svg>
          )} onClick={() => layout.toggleSql()} />
      </div>
    </nav>
  );
}
