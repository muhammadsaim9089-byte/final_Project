"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { 
  FileText, Eye, Upload, Download, Share2, Settings, HelpCircle, 
  Database, Plus, X, Maximize2, Grid, FolderOpen, Play, Check, Loader2,
  FileCode, Image as ImageIcon, ChevronDown, Sparkles, Save, Layers, LayoutTemplate
} from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useLayout } from "./LayoutContext";
import { NewSchemaModal } from "./NewSchemaModal";

export function TopNavbar() {
  const layout = useLayout();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [isEditingTitleId, setIsEditingTitleId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const [isNewSchemaOpen, setIsNewSchemaOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const downloadFile = useCallback(async (content: string, filename: string, mimeType: string) => {
    if (!content) return;
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, filename, mimeType }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }, []);

  const handleSave = async () => {
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      const nodes = layout.rfInstance?.getNodes() || [];
      const edges = layout.rfInstance?.getEdges() || [];
      const title = layout.projectTitle || "Untitled Diagram";
      const rawPrompt = typeof window !== "undefined" ? sessionStorage.getItem("designdb_prompt") || "" : "";

      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: layout.currentProjectId || undefined,
          title,
          rawPrompt,
          nodes,
          edges,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        layout.setCurrentProjectId(data.project.id);
        layout.setProjectTitle(data.project.title);
        // Sync save inside the tab
        layout.updateActiveTab({
          id: data.project.id,
          title: data.project.title,
          nodes,
          edges,
        });
        setSaveState("success");
        showToast("Diagram saved successfully! ✨", "cloud");
        setTimeout(() => setSaveState("idle"), 2500);
      } else {
        const err = await res.json();
        showToast(`Save failed: ${err.error}`, "error");
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2500);
      }
    } catch (e: any) {
      showToast(`Save error: ${e.message}`, "error");
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2500);
    }
  };

  const handleShare = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      showToast("Link copied to clipboard! 🔗", "success");
    }
  };

  const handleExportSql = (dialect: string = "postgres") => {
    const filename = `schema_${dialect}.sql`;
    downloadFile(layout.generatedSql || "-- Empty Schema", filename, "application/sql");
    showToast(`Exported ${dialect.toUpperCase()} SQL script`, "download");
    setActiveMenu(null);
  };

  const handleExportMermaid = () => {
    downloadFile(layout.generatedMermaid || "", "diagram.mmd", "text/plain");
    showToast("Exported Mermaid file", "download");
    setActiveMenu(null);
  };

  const handleExportPng = () => {
    const flowWrapper = document.querySelector(".react-flow") as HTMLElement | null;
    if (!flowWrapper) return;
    const { width, height } = flowWrapper.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const clone = flowWrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".react-flow__controls, .react-flow__panel, .react-flow__minimap").forEach(el => el.remove());

    let cssStyles = "";
    try {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        if (!sheet.href || sheet.href.startsWith(window.location.origin)) {
          const rules = Array.from(sheet.cssRules);
          for (const rule of rules) cssStyles += rule.cssText;
        }
      }
    } catch (e) {
      // ignore
    }

    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <style>${cssStyles}</style>
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#090d16;position:relative;">
            ${clone.outerHTML}
          </div>
        </foreignObject>
      </svg>`;

    const img = new window.Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "diagram.png";
      a.click();
      showToast("PNG image downloaded", "download");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
    setActiveMenu(null);
  };

  const startRenameTab = (tabId: string, currentTitle: string) => {
    setIsEditingTitleId(tabId);
    setTempTitle(currentTitle);
  };

  const submitRenameTab = (tabId: string) => {
    if (tempTitle.trim()) {
      layout.updateTabTitle(tabId, tempTitle.trim());
      if (tabId === layout.activeTabId) {
        layout.setProjectTitle(tempTitle.trim());
      }
    }
    setIsEditingTitleId(null);
  };

  return (
    <div className="w-full z-50 flex flex-col select-none shrink-0">
      {/* ─── ROW 1: Primary Navbar (Blue Header) ─── */}
      <header className="h-11 bg-[#1e61b3] border-b border-blue-700/30 flex items-center justify-between px-3 text-white">
        <div className="flex items-center gap-4 h-full" ref={menuRef}>
          {/* Logo */}
          <div className="flex items-center gap-1.5 font-bold tracking-wider text-xs">
            <Database size={13} className="text-white animate-pulse" />
            <span>DesignDB</span>
          </div>

          {/* Menu Options */}
          <div className="flex items-center h-full text-[11px] font-semibold uppercase tracking-wider relative">
            
            {/* FILE */}
            <div className="relative h-full flex items-center">
              <button 
                onClick={() => setActiveMenu(activeMenu === "file" ? null : "file")}
                className="px-3 h-full hover:bg-white/10 flex items-center gap-1 transition-colors"
              >
                <FileText size={12} className="opacity-80" />
                <span>File</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {activeMenu === "file" && (
                <div className="absolute top-full left-0 w-44 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                  <button 
                    onClick={() => { setIsNewSchemaOpen(true); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Plus size={13} />
                    <span>New Schema</span>
                  </button>
                  <button 
                    onClick={() => { handleSave(); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Save size={13} />
                    <span>Save Diagram</span>
                  </button>
                  <button 
                    onClick={() => { layout.triggerToggleDashboard(); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <FolderOpen size={13} />
                    <span>Open Dashboard</span>
                  </button>
                </div>
              )}
            </div>

            {/* VIEW */}
            <div className="relative h-full flex items-center">
              <button 
                onClick={() => setActiveMenu(activeMenu === "view" ? null : "view")}
                className="px-3 h-full hover:bg-white/10 flex items-center gap-1 transition-colors"
              >
                <Eye size={12} className="opacity-80" />
                <span>View</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {activeMenu === "view" && (
                <div className="absolute top-full left-0 w-48 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                  <button 
                    onClick={() => { layout.triggerToggleLayout(); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Maximize2 size={13} />
                    <span>Auto Layout (LR/TB)</span>
                  </button>
                  <button 
                    onClick={() => { layout.setShowGrid(!layout.showGrid); setActiveMenu(null); }}
                    className="w-full flex items-center justify-between px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <span className="flex items-center gap-2"><Grid size={13} /> Grid Background</span>
                    {layout.showGrid && <Check size={12} className="text-[#4A90D9]" />}
                  </button>
                  <button 
                    onClick={() => { layout.rfInstance?.fitView({ duration: 400 }); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Maximize2 size={13} />
                    <span>Fit View</span>
                  </button>
                </div>
              )}
            </div>

            {/* IMPORT */}
            <div className="relative h-full flex items-center">
              <button 
                onClick={() => setActiveMenu(activeMenu === "import" ? null : "import")}
                className="px-3 h-full hover:bg-white/10 flex items-center gap-1 transition-colors"
              >
                <Upload size={12} className="opacity-80" />
                <span>Import</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {activeMenu === "import" && (
                <div className="absolute top-full left-0 w-52 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                  <button 
                    onClick={() => { layout.setSqlActiveTab("import"); layout.setCodeWindowMode("split"); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <FileCode size={13} className="text-[#4A90D9]" />
                    <span>SQL DDL Schema</span>
                  </button>
                  <button 
                    onClick={() => { layout.setSqlActiveTab("import"); layout.setCodeWindowMode("split"); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Database size={13} className="text-indigo-400" />
                    <span>Prisma Schema</span>
                  </button>
                  <button 
                    onClick={() => { layout.setSqlActiveTab("import"); layout.setCodeWindowMode("split"); setActiveMenu(null); }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <FileText size={13} className="text-emerald-400" />
                    <span>Django / Rails models</span>
                  </button>
                </div>
              )}
            </div>

            {/* EXPORT */}
            <div className="relative h-full flex items-center">
              <button 
                onClick={() => setActiveMenu(activeMenu === "export" ? null : "export")}
                className="px-3 h-full hover:bg-white/10 flex items-center gap-1 transition-colors"
              >
                <Download size={12} className="opacity-80" />
                <span>Export</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {activeMenu === "export" && (
                <div className="absolute top-full left-0 w-52 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                  <div className="px-3.5 py-1 text-[9px] font-bold text-white/30 uppercase tracking-widest">SQL scripts</div>
                  <button onClick={() => handleExportSql("postgres")} className="w-full flex items-center justify-between px-3.5 py-1.5 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors">
                    <span className="flex items-center gap-2"><Database size={12} className="text-blue-400" /> PostgreSQL</span>
                    <span className="text-[10px] text-white/30 font-mono">.sql</span>
                  </button>
                  <button onClick={() => handleExportSql("mysql")} className="w-full flex items-center justify-between px-3.5 py-1.5 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors">
                    <span className="flex items-center gap-2"><Database size={12} className="text-amber-400" /> MySQL</span>
                    <span className="text-[10px] text-white/30 font-mono">.sql</span>
                  </button>
                  <button onClick={() => handleExportSql("sqlite")} className="w-full flex items-center justify-between px-3.5 py-1.5 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors">
                    <span className="flex items-center gap-2"><Database size={12} className="text-cyan-400" /> SQLite</span>
                    <span className="text-[10px] text-white/30 font-mono">.sql</span>
                  </button>
                  <div className="h-px bg-white/[0.06] my-1.5" />
                  <div className="px-3.5 py-1 text-[9px] font-bold text-white/30 uppercase tracking-widest">Visuals</div>
                  <button onClick={handleExportMermaid} className="w-full flex items-center justify-between px-3.5 py-1.5 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors">
                    <span className="flex items-center gap-2"><FileCode size={12} className="text-purple-400" /> Mermaid Syntax</span>
                    <span className="text-[10px] text-white/30 font-mono">.mmd</span>
                  </button>
                  <button onClick={handleExportPng} className="w-full flex items-center justify-between px-3.5 py-1.5 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors">
                    <span className="flex items-center gap-2"><ImageIcon size={12} className="text-rose-400" /> PNG Image</span>
                    <span className="text-[10px] text-white/30 font-mono">.png</span>
                  </button>
                </div>
              )}
            </div>

            {/* SHARE */}
            <div className="relative h-full flex items-center">
              <button 
                onClick={() => setActiveMenu(activeMenu === "share" ? null : "share")}
                className="px-3 h-full hover:bg-white/10 flex items-center gap-1 transition-colors"
              >
                <Share2 size={12} className="opacity-80" />
                <span>Share</span>
                <ChevronDown size={10} className="opacity-60" />
              </button>
              {activeMenu === "share" && (
                <div className="absolute top-full left-0 w-44 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                  <button 
                    onClick={handleShare}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Share2 size={12} />
                    <span>Copy Project Link</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-3">
          <button 
            onClick={() => layout.triggerToggleUnifiedSidebar("views")}
            className="p-1 hover:bg-white/10 rounded-md text-white/80 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings size={14} />
          </button>

          <div className="relative">
            <button 
              onClick={() => setActiveMenu(activeMenu === "help" ? null : "help")}
              className="flex items-center gap-1 text-[11px] font-medium text-white/80 hover:text-white transition-colors uppercase"
            >
              <HelpCircle size={13} />
              <span>Help</span>
              <ChevronDown size={10} className="opacity-50" />
            </button>
            {activeMenu === "help" && (
              <div className="absolute top-full right-0 w-48 bg-[#0a101f] border border-white/[0.08] rounded-b-xl shadow-2xl py-1.5 z-[60] text-left normal-case tracking-normal">
                <div className="px-3.5 py-1.5 text-[10px] text-white/40 font-semibold border-b border-white/[0.05] mb-1">Keyboard Shortcuts</div>
                <div className="px-3.5 py-1 text-[11px] text-white/70 flex justify-between"><span>Search Graph</span><kbd className="bg-white/10 px-1 rounded text-[9px]">Ctrl+K</kbd></div>
                <div className="px-3.5 py-1 text-[11px] text-white/70 flex justify-between"><span>Format SQL</span><kbd className="bg-white/10 px-1 rounded text-[9px]">Ctrl+F</kbd></div>
                <div className="px-3.5 py-1 text-[11px] text-white/70 flex justify-between"><span>Save Project</span><kbd className="bg-white/10 px-1 rounded text-[9px]">Ctrl+S</kbd></div>
              </div>
            )}
          </div>

          {/* User Initial Avatar */}
          <div className="w-6 h-6 rounded-full bg-[#5cb338] border border-white/20 flex items-center justify-center font-bold text-[11px] text-white shadow-sm" title="Logged in as User">
            M
          </div>
        </div>
      </header>

      {/* ─── ROW 2: Sub-Navbar (Tabs & Utility Controls) ─── */}
      <div className="h-9 bg-[#0b0f19] border-b border-white/[0.06] flex items-center justify-between px-3 text-white text-xs">
        {/* Project Tabs list */}
        <div className="flex items-center gap-1 h-full overflow-x-auto scrollbar-none pr-4">
          {layout.tabs.map((tab) => {
            const isActive = tab.id === layout.activeTabId;
            return (
              <div 
                key={tab.id}
                onClick={() => layout.setActiveTabId(tab.id)}
                className={`group flex items-center gap-1.5 px-3.5 h-full border-r border-white/[0.04] transition-all cursor-pointer ${
                  isActive 
                    ? "bg-[#151c2d] text-white font-semibold shadow-inner" 
                    : "text-white/40 hover:text-white/75 hover:bg-[#121926]/40"
                }`}
              >
                <Database size={11} className={isActive ? "text-[#4A90D9]" : "text-white/20"} />
                {isEditingTitleId === tab.id ? (
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={() => submitRenameTab(tab.id)}
                    onKeyDown={(e) => e.key === "Enter" && submitRenameTab(tab.id)}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent text-white border-b border-[#4A90D9] outline-none text-xs w-24 h-5 px-0.5"
                  />
                ) : (
                  <span 
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRenameTab(tab.id, tab.title);
                    }}
                    className="truncate max-w-[100px] text-[11px]"
                  >
                    {tab.title}
                  </span>
                )}
                
                {layout.tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      layout.closeTab(tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-all ml-1"
                    title="Close tab"
                  >
                    <X size={9} />
                  </button>
                )}
              </div>
            );
          })}

          {/* Plus button to add tabs */}
          <button 
            onClick={() => setIsNewSchemaOpen(true)}
            className="w-6 h-6 rounded-md hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all border border-transparent hover:border-white/[0.08]"
            title="Create new workspace tab"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Right side utility icons */}
        <div className="flex items-center gap-1.5">
          {/* Add Table */}
          <button 
            onClick={() => layout.triggerToggleUnifiedSidebar("add")}
            className="w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all border border-transparent hover:border-white/[0.06]"
            title="Add Table"
          >
            <Plus size={14} />
          </button>

          {/* Toggle SQL panel */}
          <button 
            onClick={() => layout.toggleSql()}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border ${
              layout.codeWindowMode !== "collapsed"
                ? "bg-[#4A90D9]/15 border-[#4A90D9]/30 text-[#4A90D9]"
                : "hover:bg-white/10 border-transparent text-white/60 hover:text-white"
            }`}
            title="Toggle SQL Editor"
          >
            <FileCode size={14} />
          </button>

          {/* Auto Layout */}
          <button 
            onClick={() => layout.triggerToggleLayout()}
            className="w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all border border-transparent hover:border-white/[0.06]"
            title="Auto Layout Diagram"
          >
            <LayoutTemplate size={14} />
          </button>

          {/* Diagram Views */}
          <button 
            onClick={() => layout.triggerToggleUnifiedSidebar('views')}
            className="w-7 h-7 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all border border-transparent hover:border-white/[0.06]"
            title="Diagram Views"
          >
            <Layers size={14} />
          </button>

          {/* Toggle Grid */}
          <button 
            onClick={() => layout.setShowGrid(!layout.showGrid)}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border ${
              layout.showGrid
                ? "bg-[#4A90D9]/15 border-[#4A90D9]/30 text-[#4A90D9]"
                : "hover:bg-white/10 border-transparent text-white/60 hover:text-white"
            }`}
            title="Toggle Grid Background"
          >
            <Grid size={14} />
          </button>
        </div>
      </div>
      {/* New Schema Modal */}
      <NewSchemaModal
        isOpen={isNewSchemaOpen}
        onClose={() => setIsNewSchemaOpen(false)}
        onCreateSchema={(title, dialect, mode) => {
          layout.addTab(title);
          setIsNewSchemaOpen(false);
          if (mode === "ai") {
            showToast("AI schema generation initiated ✨", "success");
          } else {
            showToast(`New schema "${title}" created`, "success");
          }
        }}
      />
    </div>
  );
}
