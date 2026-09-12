"use client";

import React, { useState } from "react";
import { X, Pencil, LayoutGrid, FolderOpen, Users, Sparkles, ChevronDown, Database } from "lucide-react";

type SidebarOption = "scratch" | "templates" | "yours" | "shared" | "ai";

interface NewSchemaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateSchema: (title: string, dialect: string, mode: SidebarOption) => void;
}

const dialectOptions = [
  { value: "generic", label: "GENERIC" },
  { value: "postgres", label: "POSTGRESQL" },
  { value: "mysql", label: "MYSQL" },
  { value: "sqlite", label: "SQLITE" },
  { value: "mssql", label: "SQL SERVER" },
];

const sidebarItems: { id: SidebarOption; label: string; icon: React.ReactNode }[] = [
  { id: "scratch", label: "Create from scratch", icon: <Pencil size={14} /> },
  { id: "templates", label: "Templates", icon: <LayoutGrid size={14} /> },
  { id: "yours", label: "Your Schemas", icon: <FolderOpen size={14} /> },
  { id: "shared", label: "Schemas shared with you", icon: <Users size={14} /> },
  { id: "ai", label: "Generate with AI", icon: <Sparkles size={14} /> },
];

export function NewSchemaModal({ isOpen, onClose, onCreateSchema }: NewSchemaModalProps) {
  const [activeOption, setActiveOption] = useState<SidebarOption>("scratch");
  const [title, setTitle] = useState("");
  const [dialect, setDialect] = useState("generic");
  const [dialectOpen, setDialectOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");

  if (!isOpen) return null;

  const handleCreate = () => {
    const finalTitle = title.trim() || "Untitled Schema";
    onCreateSchema(finalTitle, dialect, activeOption);
    // Reset state
    setTitle("");
    setDialect("generic");
    setActiveOption("scratch");
    setAiPrompt("");
  };

  const selectedDialect = dialectOptions.find((d) => d.value === dialect) || dialectOptions[0];

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-[680px] bg-[#f8f9fb] dark:bg-[#0c101b] rounded-2xl border border-slate-200 dark:border-white/[0.1] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.08]">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">New Schema</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/[0.06] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex min-h-[320px]">
          {/* Left Sidebar */}
          <div className="w-52 border-r border-slate-200 dark:border-white/[0.06] p-3 flex flex-col gap-1">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveOption(item.id)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all text-left ${
                  activeOption === item.id
                    ? "bg-[#1e61b3] text-white shadow-md"
                    : "text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <span className={activeOption === item.id ? "text-white" : "text-slate-400 dark:text-white/40"}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Right Content */}
          <div className="flex-1 p-6 flex flex-col">
            {activeOption === "scratch" && (
              <>
                {/* Title + Dialect Row */}
                <div className="flex items-center gap-3 mb-5">
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/30 text-sm outline-none focus:border-[#1e61b3] focus:ring-2 focus:ring-[#1e61b3]/20 transition-all"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  />

                  {/* Dialect Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setDialectOpen(!dialectOpen)}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-800 dark:text-white text-xs font-bold uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-all min-w-[130px] justify-between"
                    >
                      <span className="flex items-center gap-1.5">
                        <Database size={12} className="text-slate-400 dark:text-white/40" />
                        {selectedDialect.label}
                      </span>
                      <ChevronDown size={12} className="text-slate-400" />
                    </button>

                    {dialectOpen && (
                      <div className="absolute top-full right-0 mt-1 w-full bg-white dark:bg-[#0c101b] border border-slate-200 dark:border-white/[0.1] rounded-xl shadow-xl py-1 z-50">
                        {dialectOptions.map((d) => (
                          <button
                            key={d.value}
                            onClick={() => { setDialect(d.value); setDialectOpen(false); }}
                            className={`w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wider transition-all ${
                              dialect === d.value
                                ? "text-[#1e61b3] bg-blue-50 dark:bg-[#1e61b3]/10"
                                : "text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                            }`}
                          >
                            <Database size={11} className={dialect === d.value ? "text-[#1e61b3]" : "text-slate-400 dark:text-white/30"} />
                            {d.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Info Text */}
                <p className="text-sm text-slate-500 dark:text-white/40 leading-relaxed mb-6">
                  {dialect === "generic"
                    ? 'Selecting the "generic" database type will allow you to generate SQL for all the databases; but you will only have access to the generic data types.'
                    : `Creating a schema targeting ${selectedDialect.label}. You'll have access to all ${selectedDialect.label}-specific data types and syntax.`}
                </p>

                {/* Create Button */}
                <button
                  onClick={handleCreate}
                  className="self-start px-6 py-2.5 bg-white dark:bg-white/[0.06] border border-slate-300 dark:border-white/[0.12] rounded-lg text-slate-800 dark:text-white text-xs font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/[0.1] hover:border-slate-400 dark:hover:border-white/[0.2] transition-all shadow-sm"
                >
                  CREATE A NEW SCHEMA
                </button>
              </>
            )}

            {activeOption === "templates" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <LayoutGrid size={32} className="text-slate-300 dark:text-white/20 mb-3" />
                <h3 className="text-sm font-semibold text-slate-600 dark:text-white/60 mb-1">Schema Templates</h3>
                <p className="text-xs text-slate-400 dark:text-white/30 max-w-[260px]">
                  Start from pre-built templates like E-Commerce, Blog, SaaS, or Social Network schemas.
                </p>
                <p className="text-[10px] text-slate-300 dark:text-white/20 mt-3 uppercase tracking-wider font-semibold">Coming Soon</p>
              </div>
            )}

            {activeOption === "yours" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <FolderOpen size={32} className="text-slate-300 dark:text-white/20 mb-3" />
                <h3 className="text-sm font-semibold text-slate-600 dark:text-white/60 mb-1">Your Schemas</h3>
                <p className="text-xs text-slate-400 dark:text-white/30 max-w-[260px]">
                  Access your previously saved schemas and continue editing them.
                </p>
                <p className="text-[10px] text-slate-300 dark:text-white/20 mt-3 uppercase tracking-wider font-semibold">Coming Soon</p>
              </div>
            )}

            {activeOption === "shared" && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Users size={32} className="text-slate-300 dark:text-white/20 mb-3" />
                <h3 className="text-sm font-semibold text-slate-600 dark:text-white/60 mb-1">Shared Schemas</h3>
                <p className="text-xs text-slate-400 dark:text-white/30 max-w-[260px]">
                  View schemas that have been shared with you by other team members.
                </p>
                <p className="text-[10px] text-slate-300 dark:text-white/20 mt-3 uppercase tracking-wider font-semibold">Coming Soon</p>
              </div>
            )}

            {activeOption === "ai" && (
              <div className="flex-1 flex flex-col">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-white/80 mb-1 flex items-center gap-2">
                  <Sparkles size={14} className="text-[#1e61b3]" />
                  Generate with AI
                </h3>
                <p className="text-xs text-slate-400 dark:text-white/40 mb-4">
                  Describe your project in natural language and let AI generate a normalized database schema for you.
                </p>

                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. I need a library management system with books, authors, borrowers, and loan tracking..."
                  className="flex-1 min-h-[120px] px-4 py-3 rounded-xl border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/25 text-sm outline-none focus:border-[#1e61b3] focus:ring-2 focus:ring-[#1e61b3]/20 transition-all resize-none mb-4"
                />

                <button
                  onClick={() => {
                    if (aiPrompt.trim()) {
                      // Store AI prompt for the canvas to pick up
                      if (typeof window !== "undefined") {
                        sessionStorage.setItem("designdb_ai_prompt", aiPrompt.trim());
                      }
                      handleCreate();
                    }
                  }}
                  disabled={!aiPrompt.trim()}
                  className={`self-start px-6 py-2.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all shadow-sm ${
                    aiPrompt.trim()
                      ? "bg-[#1e61b3] text-white hover:bg-[#1a549e] border border-[#1e61b3]"
                      : "bg-slate-100 dark:bg-white/[0.04] text-slate-300 dark:text-white/20 border border-slate-200 dark:border-white/[0.06] cursor-not-allowed"
                  }`}
                >
                  Generate Schema
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
