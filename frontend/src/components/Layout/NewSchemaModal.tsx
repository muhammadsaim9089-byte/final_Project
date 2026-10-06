"use client";

import React, { useEffect, useState } from "react";
import { X, Pencil, LayoutGrid, FolderOpen, Users, Sparkles, ChevronDown, Database } from "lucide-react";
import { TemplateGallery, useApplyTemplate } from "@/components/Tools/TemplateGallery";
import { TEMPLATES } from "@/lib/templates";

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
  { id: "scratch", label: "Create from scratch", icon: <Pencil size={18} /> },
  { id: "templates", label: "Templates", icon: <LayoutGrid size={18} /> },
  { id: "yours", label: "Your Schemas", icon: <FolderOpen size={18} /> },
  { id: "shared", label: "Schemas shared with you", icon: <Users size={18} /> },
  { id: "ai", label: "Generate with AI", icon: <Sparkles size={18} /> },
];

export function NewSchemaModal({ isOpen, onClose, onCreateSchema }: NewSchemaModalProps) {
  const [activeOption, setActiveOption] = useState<SidebarOption>("scratch");
  const [title, setTitle] = useState("");
  const [dialect, setDialect] = useState("generic");
  const [dialectOpen, setDialectOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const applyTemplate = useApplyTemplate();

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const reset = () => {
    setTitle("");
    setDialect("generic");
    setActiveOption("scratch");
    setAiPrompt("");
  };

  const handleCreate = () => {
    const finalTitle = title.trim() || "Untitled Schema";
    onCreateSchema(finalTitle, dialect, activeOption);
    reset();
  };

  const selectedDialect = dialectOptions.find((d) => d.value === dialect) || dialectOptions[0];

  const comingSoon = (icon: React.ReactNode, heading: string, text: string) => (
    <div className="flex-1 flex flex-col items-center justify-center text-center">
      <div className="text-slate-300 dark:text-white/20 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-600 dark:text-white/70 mb-2">{heading}</h3>
      <p className="text-sm text-slate-400 dark:text-white/40 max-w-sm leading-relaxed">{text}</p>
      <p className="text-[11px] text-slate-300 dark:text-white/25 mt-4 uppercase tracking-wider font-semibold">Coming Soon</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8 select-none" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-6xl h-[82vh] max-h-[780px] min-h-[520px] flex flex-col bg-[#f8f9fb] dark:bg-[#0c101b] rounded-2xl border border-slate-200 dark:border-white/[0.1] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-200 dark:border-white/[0.08] shrink-0">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">New Schema</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/[0.06] transition-all"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar */}
          <div className="w-64 shrink-0 border-r border-slate-200 dark:border-white/[0.06] p-4 flex flex-col gap-1.5 overflow-y-auto overscroll-contain scrollbar-hide">
            {sidebarItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveOption(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all text-left ${
                  activeOption === item.id
                    ? "bg-[#1e61b3] text-white shadow-md"
                    : "text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <span className={`shrink-0 ${activeOption === item.id ? "text-white" : "text-slate-400 dark:text-white/40"}`}>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          {/* Right Content */}
          {activeOption === "templates" ? (
            // the template browser is always dark-styled, exactly like the Templates tool
            <div className="flex-1 min-w-0 min-h-0 flex flex-col p-4">
              <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border border-white/[0.08] bg-[#0a0f1c]">
                <div className="px-5 pt-4 pb-1 shrink-0 text-white">
                  <h3 className="text-base font-bold">Templates</h3>
                  <p className="text-[12px] text-white/45">{TEMPLATES.length} ready-made schemas — pick one to open it as a new diagram</p>
                </div>
                <TemplateGallery
                  allowMerge={false}
                  onUse={(t) => {
                    applyTemplate(t, "new");
                    reset();
                    onClose();
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0 min-h-0 p-8 flex flex-col overflow-y-auto overscroll-contain scrollbar-hide">
              {activeOption === "scratch" && (
                <>
                  {/* Title + Dialect Row */}
                  <div className="flex items-center gap-4 mb-6">
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Title"
                      className="flex-1 px-5 py-3.5 rounded-xl border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/30 text-base outline-none focus:border-[#1e61b3] focus:ring-2 focus:ring-[#1e61b3]/20 transition-all"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    />

                    {/* Dialect Dropdown */}
                    <div className="relative">
                      <button
                        onClick={() => setDialectOpen(!dialectOpen)}
                        className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-800 dark:text-white text-sm font-bold uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-all min-w-[170px] justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <Database size={15} className="text-slate-400 dark:text-white/40" />
                          {selectedDialect.label}
                        </span>
                        <ChevronDown size={15} className="text-slate-400" />
                      </button>

                      {dialectOpen && (
                        <div className="absolute top-full right-0 mt-1.5 w-full bg-white dark:bg-[#0c101b] border border-slate-200 dark:border-white/[0.1] rounded-xl shadow-xl py-1.5 z-50">
                          {dialectOptions.map((d) => (
                            <button
                              key={d.value}
                              onClick={() => {
                                setDialect(d.value);
                                setDialectOpen(false);
                              }}
                              className={`w-full flex items-center gap-2.5 px-5 py-2.5 text-sm font-semibold uppercase tracking-wider transition-all ${
                                dialect === d.value ? "text-[#1e61b3] bg-blue-50 dark:bg-[#1e61b3]/10" : "text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                              }`}
                            >
                              <Database size={14} className={dialect === d.value ? "text-[#1e61b3]" : "text-slate-400 dark:text-white/30"} />
                              {d.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Info Text */}
                  <p className="text-base text-slate-500 dark:text-white/45 leading-relaxed mb-8 max-w-2xl">
                    {dialect === "generic"
                      ? 'Selecting the "generic" database type will allow you to generate SQL for all the databases; but you will only have access to the generic data types.'
                      : `Creating a schema targeting ${selectedDialect.label}. You'll have access to all ${selectedDialect.label}-specific data types and syntax.`}
                  </p>

                  {/* Create Button */}
                  <button
                    onClick={handleCreate}
                    className="self-start px-8 py-3.5 bg-white dark:bg-white/[0.06] border border-slate-300 dark:border-white/[0.12] rounded-xl text-slate-800 dark:text-white text-sm font-bold uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-white/[0.1] hover:border-slate-400 dark:hover:border-white/[0.2] transition-all shadow-sm"
                  >
                    CREATE A NEW SCHEMA
                  </button>
                </>
              )}

              {activeOption === "yours" && comingSoon(<FolderOpen size={44} />, "Your Schemas", "Access your previously saved schemas and continue editing them.")}

              {activeOption === "shared" && comingSoon(<Users size={44} />, "Shared Schemas", "View schemas that have been shared with you.")}

              {activeOption === "ai" && (
                <div className="flex-1 flex flex-col">
                  <h3 className="text-lg font-semibold text-slate-700 dark:text-white/85 mb-1.5 flex items-center gap-2.5">
                    <Sparkles size={18} className="text-[#1e61b3]" />
                    Generate with AI
                  </h3>
                  <p className="text-sm text-slate-400 dark:text-white/45 mb-5">Describe your project in natural language and let AI generate a normalized database schema for you.</p>

                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. I need a library management system with books, authors, borrowers, and loan tracking..."
                    className="flex-1 min-h-[160px] px-5 py-4 rounded-xl border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/25 text-base outline-none focus:border-[#1e61b3] focus:ring-2 focus:ring-[#1e61b3]/20 transition-all resize-none mb-5"
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
                    className={`self-start px-8 py-3.5 rounded-xl text-sm font-bold uppercase tracking-widest transition-all shadow-sm ${
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
          )}
        </div>
      </div>
    </div>
  );
}
