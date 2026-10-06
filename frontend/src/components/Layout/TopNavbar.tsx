"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, Download, Share2, HelpCircle,
  Database, Plus, X, Grid, FolderOpen, Check, ChevronRight, Loader2, LayoutDashboard, Files,
  FileCode, Image as ImageIcon, ChevronDown, Save, Layers, LayoutTemplate,
  History, Wrench, Plug, List, Link2, Code2, Globe, Group, GitBranch,
  FileType, Braces, Copy, BookOpen, FileSpreadsheet,
} from "lucide-react";
import { showToast } from "@/components/ui/toast";
import { useLayout } from "./LayoutContext";
import { NewSchemaModal } from "./NewSchemaModal";
import { modelToSql } from "@/lib/sql/exporter";
import { SQL_DIALECTS, SqlDialect } from "@/lib/sql/dialects";
import { IMPORT_SOURCES } from "@/lib/import/sources";
import { downloadText, safeFilename } from "@/lib/export/raster";
import { buildFragment } from "@/lib/share/codec";
import { modelToDbml } from "@/lib/dbml/serializer";
import { positionsOf } from "@/lib/model/autoLayout";
import { applyTemplate } from "@/components/Tools/applyTemplate";
import { SaveIndicator } from "./SaveIndicator";
import { AiToggle } from "./AiToggle";
import { HELP_MENU_SHORTCUTS, OPEN_SHORTCUTS_EVENT, keyLabel } from "@/components/Canvas/shortcuts";

const menuPanel = "absolute top-full left-0 bg-[#0a101f] border border-white/[0.1] rounded-b-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-2 z-[60] text-left normal-case tracking-normal max-h-[80vh] overflow-y-auto p-scrollbar";
const itemCls = "w-full flex items-center gap-2.5 px-4 py-2 text-white/85 hover:text-white hover:bg-white/[0.08] transition-colors text-[13px] font-medium";

function Item({ icon, label, hint, onClick, active }: { icon?: React.ReactNode; label: string; hint?: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`${itemCls} justify-between`}>
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      {active ? <Check size={14} className="text-[#4A90D9]" /> : hint ? <span className="text-[11px] text-white/35 font-mono">{hint}</span> : null}
    </button>
  );
}
const Divider = () => <div className="h-px bg-white/[0.07] my-1.5" />;
/** A flyout beside a row of the DesignDB menu (no overflow on the menu itself, so it isn't clipped). */
const flyout = "absolute left-full top-[-9px] ml-1 bg-[#0a101f] border border-white/[0.1] rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-2 z-[61]";

interface SavedDiagram {
  id: string;
  title: string;
  updatedAt: string;
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 24 * 7) return `${Math.round(m / (60 * 24))} d ago`;
  return new Date(iso).toLocaleDateString();
}
const Heading = ({ children }: { children: React.ReactNode }) => <div className="px-4 pt-1 pb-1 text-[10px] font-bold text-white/35 uppercase tracking-widest">{children}</div>;

export function TopNavbar() {
  const layout = useLayout();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isEditingTitleId, setIsEditingTitleId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");
  const [isNewSchemaOpen, setIsNewSchemaOpen] = useState(false);
  // DesignDB menu: which flyout is open, and what it lists (both loaded on demand)
  const [submenu, setSubmenu] = useState<"samples" | "recent" | null>(null);
  const [samples, setSamples] = useState<{ id: string; name: string; category: string }[] | null>(null);
  const [recent, setRecent] = useState<{ state: "loading" | "done" | "error"; items: SavedDiagram[] } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeMenu !== "app") setSubmenu(null);
  }, [activeMenu]);

  // Close the open menu on any press outside it — including on the canvas, its tables and groups. React Flow stops
  // mousedown from bubbling there (it starts panning / dragging), so this listens to pointerdown in the *capture*
  // phase, which runs before anything on the page can stop it. Esc closes it too.
  useEffect(() => {
    if (!activeMenu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || helpRef.current?.contains(t)) return;
      setActiveMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveMenu(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [activeMenu]);

  const api = () => layout.getCanvasApi();
  const closeMenu = () => setActiveMenu(null);
  const tool = (id: Parameters<typeof layout.openTool>[0], payload?: any) => () => {
    layout.openTool(id, payload);
    closeMenu();
  };

  // saving itself lives in the editor (useProjectSave): Ctrl+S, the save indicator and this menu item all ask it
  const handleSave = useCallback(() => layout.requestSave({ explicit: true }), [layout]);
  // Ctrl+S saves the diagram
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        layout.toggleSql();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave, layout]);

  const copyShareLink = async () => {
    const a = api();
    if (!a) return;
    try {
      const model = a.getModel();
      const frag = await buildFragment({ dbml: modelToDbml(model), layout: positionsOf(model), title: layout.projectTitle }, { compress: true, theme: "dark" });
      await navigator.clipboard.writeText(`${window.location.origin}/embed#${frag}`);
      showToast("Share link copied — anyone with it can view this diagram 🔗", "success");
    } catch {
      showToast("Could not copy the link", "error");
    }
    closeMenu();
  };

  const quickSql = (dialect: SqlDialect) => {
    const a = api();
    if (!a) return;
    downloadText(modelToSql(a.getModel(), { dialect }), safeFilename(`${layout.projectTitle || "schema"}_${dialect}`, "sql"), "application/sql");
    showToast(`Exported ${SQL_DIALECTS.find((d) => d.id === dialect)?.label} script`, "download");
    closeMenu();
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

  const menuBtn = (id: string, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setActiveMenu(activeMenu === id ? null : id)}
      className={`px-2.5 xl:px-3.5 2xl:px-4 h-full flex items-center gap-2 transition-colors hover:bg-white/10 ${activeMenu === id ? "bg-white/15 shadow-[inset_0_-2px_0_#ffffff]" : ""}`}
    >
      <span className="hidden 2xl:flex">{icon}</span>
      <span>{label}</span>
      <ChevronDown size={12} className={`opacity-70 transition-transform ${activeMenu === id ? "rotate-180" : ""}`} />
    </button>
  );

  const openSubmenu = (id: "samples" | "recent") => {
    if (submenu === id) return;
    setSubmenu(id);
    if (id === "samples" && !samples) {
      // the template catalogue is ~50 KB of DBML — only fetched when someone opens this list
      void import("@/lib/templates").then((m) => setSamples(m.TEMPLATES.map(({ id, name, category }) => ({ id, name, category }))));
    }
    if (id === "recent") {
      setRecent((r) => ({ state: "loading", items: r?.items ?? [] }));
      fetch("/api/projects")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => setRecent({ state: "done", items: (d.projects || []).map((p: SavedDiagram) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt })) }))
        .catch(() => setRecent((r) => ({ state: "error", items: r?.items ?? [] })));
    }
  };

  const openSample = async (id: string) => {
    closeMenu();
    const { TEMPLATES } = await import("@/lib/templates");
    const t = TEMPLATES.find((x) => x.id === id);
    if (t) applyTemplate(layout, t, "new");
  };

  const openSaved = async (id: string) => {
    closeMenu();
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const project = (data.projects || []).find((p: SavedDiagram) => p.id === id);
      if (!project) throw new Error("not found");
      // Canvas owns loading a project (same path as the dashboard)
      window.dispatchEvent(new CustomEvent("open-project", { detail: { project } }));
    } catch {
      showToast("Could not open that diagram", "error");
    }
  };

  return (
    // z-[55]: the top bar (and every menu it opens) sits above the page's own floating chrome — the code panel's edge tab
    // and resize handle are z-50 and used to cut through open menus — and below every dialog (z-60 and up)
    <div className="w-full z-[55] flex flex-col select-none shrink-0">
      {/* ─── ROW 1: Primary Navbar ─── */}
      <header className="h-[54px] bg-gradient-to-b from-[#2a70c8] to-[#1d5fb1] border-b border-black/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_4px_18px_rgba(0,0,0,0.35)] flex items-center justify-between px-4 2xl:px-5 text-white">
        <div className="flex items-center gap-3 2xl:gap-5 h-full" ref={menuRef}>
          {/* DesignDB menu — the logo opens everything about the diagram as a file: dashboard, new, samples, saved, save, history */}
          <div className="relative h-full flex items-center pr-3 2xl:pr-4 mr-1 border-r border-white/20">
            <button
              onClick={() => setActiveMenu(activeMenu === "app" ? null : "app")}
              aria-haspopup="menu"
              aria-expanded={activeMenu === "app"}
              title="DesignDB menu — new, open, save"
              className={`flex items-center gap-3 h-10 pl-1 pr-2 rounded-lg font-bold tracking-wide text-[18px] transition-colors hover:bg-white/10 ${activeMenu === "app" ? "bg-white/15" : ""}`}
            >
              <span className="w-8 h-8 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center shadow-inner">
                <Database size={17} className="text-white" />
              </span>
              <span>DesignDB</span>
              <ChevronDown size={14} className={`opacity-70 transition-transform ${activeMenu === "app" ? "rotate-180" : ""}`} />
            </button>
            {activeMenu === "app" && (
              <div role="menu" className="absolute top-full left-0 w-64 bg-[#0a101f] border border-white/[0.1] rounded-b-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-2 z-[60] text-left normal-case tracking-normal font-normal text-[13px]">
                <div onMouseEnter={() => setSubmenu(null)}>
                  <Item icon={<LayoutDashboard size={15} />} label="Dashboard" onClick={() => { closeMenu(); layout.openDashboard("all"); }} />
                  <Divider />
                  <Item icon={<Plus size={15} />} label="New diagram" onClick={() => { setIsNewSchemaOpen(true); closeMenu(); }} />
                </div>

                <div className="relative" onMouseEnter={() => openSubmenu("samples")}>
                  <button onClick={() => openSubmenu("samples")} aria-haspopup="menu" aria-expanded={submenu === "samples"} className={`${itemCls} justify-between ${submenu === "samples" ? "bg-white/[0.08] text-white" : ""}`}>
                    <span className="flex items-center gap-2.5">
                      <LayoutTemplate size={15} />
                      <span>New sample diagram</span>
                    </span>
                    <ChevronRight size={14} className="text-white/45" />
                  </button>
                  {submenu === "samples" && (
                    <div role="menu" className={`${flyout} w-80`}>
                      <div className="px-4 pt-1 pb-1 text-[10px] font-bold text-white/35 uppercase tracking-widest">Sample diagrams</div>
                      <div className="max-h-[60vh] overflow-y-auto p-scrollbar">
                        {!samples ? (
                          <div className="px-4 py-2 flex items-center gap-2 text-white/45"><Loader2 size={13} className="animate-spin" />Loading…</div>
                        ) : (
                          samples.map((t) => (
                            <button key={t.id} onClick={() => void openSample(t.id)} className={`${itemCls} justify-between`} title={`Open “${t.name}” in a new tab`}>
                              <span className="truncate">{t.name}</span>
                              <span className="text-[11px] text-white/35 shrink-0">{t.category}</span>
                            </button>
                          ))
                        )}
                      </div>
                      <Divider />
                      <Item icon={<LayoutTemplate size={15} />} label="Browse all templates…" onClick={tool("templates")} />
                    </div>
                  )}
                </div>

                <div onMouseEnter={() => setSubmenu(null)}>
                  <Divider />
                </div>

                <div className="relative" onMouseEnter={() => openSubmenu("recent")}>
                  <button onClick={() => openSubmenu("recent")} aria-haspopup="menu" aria-expanded={submenu === "recent"} className={`${itemCls} justify-between ${submenu === "recent" ? "bg-white/[0.08] text-white" : ""}`}>
                    <span className="flex items-center gap-2.5">
                      <Files size={15} />
                      <span>My diagrams</span>
                    </span>
                    <ChevronRight size={14} className="text-white/45" />
                  </button>
                  {submenu === "recent" && (
                    <div role="menu" className={`${flyout} w-80`}>
                      <div className="px-4 pt-1 pb-1 text-[10px] font-bold text-white/35 uppercase tracking-widest">Recently saved</div>
                      {recent?.state === "loading" && !recent.items.length ? (
                        <div className="px-4 py-2 flex items-center gap-2 text-white/45"><Loader2 size={13} className="animate-spin" />Loading…</div>
                      ) : recent?.state === "error" && !recent.items.length ? (
                        <div className="px-4 py-2 text-white/45">Couldn’t load your diagrams.</div>
                      ) : !recent?.items.length ? (
                        <div className="px-4 py-2 text-white/45 leading-relaxed">No saved diagrams yet — Save diagram (Ctrl+S) keeps one here.</div>
                      ) : (
                        recent.items.slice(0, 8).map((p) => (
                          <button key={p.id} onClick={() => void openSaved(p.id)} className={`${itemCls} justify-between`}>
                            <span className="truncate">{p.title || "Untitled"}</span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] text-white/35">{ago(p.updatedAt)}</span>
                              {p.id === layout.currentProjectId && <Check size={14} className="text-[#4A90D9]" />}
                            </span>
                          </button>
                        ))
                      )}
                      <Divider />
                      <Item icon={<FolderOpen size={15} />} label="All diagrams…" onClick={() => { closeMenu(); layout.openDashboard("all"); }} />
                    </div>
                  )}
                </div>

                <div onMouseEnter={() => setSubmenu(null)}>
                  <Item icon={<Save size={15} />} label="Save diagram" hint="Ctrl+S" onClick={() => { void handleSave(); closeMenu(); }} />
                  <Item icon={<History size={15} />} label="Version history…" onClick={tool("versions")} />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center h-full text-[13px] font-semibold uppercase tracking-wider relative">

            {/* AI — the assistant's on/off switch, first in the menu row (where View was). There is no View or Tools
                menu: auto arrange, fit view and relationship style are in the bottom toolbar; templates, version
                history, enums, groups, lineage, diagram views and grid in the second row; show relationships and colours
                in the side drawer's Inspect tab (nothing selected); reverse engineering and database conversion under
                Import. */}
            <div className="relative h-full flex items-center">
              <AiToggle
                on={layout.aiOpen}
                onToggle={() => {
                  setActiveMenu(null);
                  layout.toggleAi();
                }}
              />
            </div>

            {/* IMPORT */}
            <div className="relative h-full flex items-center">
              {menuBtn("import", <Upload size={15} className="opacity-90" />, "Import")}
              {activeMenu === "import" && (
                <div className={`${menuPanel} w-72`}>
                  <Item icon={<FileCode size={15} className="text-emerald-300" />} label="Auto-detect…" hint="paste anything" onClick={tool("import", { source: "auto" })} />
                  <Divider />
                  <Heading>Databases (SQL)</Heading>
                  {IMPORT_SOURCES.filter((x) => x.group === "database").map((x) => (
                    <Item key={x.id} icon={<Database size={15} className="text-[#4A90D9]" />} label={`Import from ${x.label}`} onClick={tool("import", { source: x.id })} />
                  ))}
                  <Divider />
                  <Heading>Schema files</Heading>
                  {IMPORT_SOURCES.filter((x) => x.group === "file").map((x) => (
                    <Item key={x.id} icon={<Code2 size={15} className="text-violet-300" />} label={`Import from ${x.label}`} onClick={tool("import", { source: x.id })} />
                  ))}
                  <Divider />
                  <Heading>Data files</Heading>
                  {IMPORT_SOURCES.filter((x) => x.group === "data").map((x) => (
                    <Item key={x.id} icon={<FileSpreadsheet size={15} className="text-emerald-300" />} label={`Import from ${x.label}`} hint=".csv · .tsv" onClick={tool("import", { source: x.id })} />
                  ))}
                  <Divider />
                  <Item icon={<Plug size={15} className="text-emerald-400" />} label="Reverse engineer a database…" onClick={tool("reverse")} />
                  <Item icon={<Wrench size={15} className="text-amber-300" />} label="Convert between databases…" onClick={tool("convert")} />
                </div>
              )}
            </div>

            {/* EXPORT */}
            <div className="relative h-full flex items-center">
              {menuBtn("export", <Download size={15} className="opacity-90" />, "Export")}
              {activeMenu === "export" && (
                <div className={`${menuPanel} w-[22rem]`}>
                  <Heading>SQL scripts</Heading>
                  {SQL_DIALECTS.map((d) => (
                    <Item key={d.id} icon={<Database size={15} className="text-[#4A90D9]" />} label={d.label} hint=".sql" onClick={() => quickSql(d.id)} />
                  ))}
                  <Divider />
                  <Heading>Diagram</Heading>
                  <Item icon={<ImageIcon size={15} className="text-rose-400" />} label="PNG · SVG · PDF…" onClick={tool("export", { tab: "image" })} />
                  <Item icon={<Braces size={15} className="text-purple-400" />} label="DBML · JSON · MongoDB · Mermaid…" onClick={tool("export", { tab: "code" })} />
                  <Item icon={<BookOpen size={15} className="text-emerald-400" />} label="Documentation (HTML · MD · PDF)…" onClick={tool("docs")} />
                  <Item icon={<FileType size={15} className="text-amber-300" />} label="Sample data (CSV)…" onClick={tool("export", { tab: "data" })} />
                </div>
              )}
            </div>

            {/* SHARE */}
            <div className="relative h-full flex items-center">
              {menuBtn("share", <Share2 size={15} className="opacity-90" />, "Share")}
              {activeMenu === "share" && (
                <div className={`${menuPanel} w-64`}>
                  <Item icon={<Copy size={15} />} label="Copy share link" onClick={copyShareLink} />
                  <Item icon={<Link2 size={15} />} label="Link options · password…" onClick={tool("share", { tab: "link" })} />
                  <Item icon={<Code2 size={15} />} label="Embed in a website…" onClick={tool("share", { tab: "embed" })} />
                  <Item icon={<Globe size={15} />} label="Publish (public / private)…" onClick={tool("share", { tab: "publish" })} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 xl:gap-4">
          <SaveIndicator />
          {/* (no settings gear: it opened the same drawer as "Diagram views" in the tab row, whose Inspect tab holds the
              workspace settings when nothing is selected) */}
          <div className="relative" ref={helpRef}>
            <button
              onClick={() => setActiveMenu(activeMenu === "help" ? null : "help")}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-white/90 hover:text-white hover:bg-white/15 transition-colors uppercase"
            >
              <HelpCircle size={16} />
              <span className="hidden 2xl:inline">Help</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>
            {activeMenu === "help" && (
              <div className="absolute top-full right-0 w-72 bg-[#0a101f] border border-white/[0.1] rounded-b-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] py-2 z-[60] text-left normal-case tracking-normal">
                <div className="px-4 py-1.5 text-[11px] text-white/45 font-bold uppercase tracking-widest border-b border-white/[0.06] mb-1">Keyboard shortcuts</div>
                {HELP_MENU_SHORTCUTS.map((s) => (
                  <div key={s.label} className="px-4 py-1 text-[12px] text-white/75 flex justify-between items-center gap-3">
                    <span>{s.label}</span>
                    <kbd className="bg-white/10 border border-white/10 px-1.5 py-0.5 rounded-md text-[10px] font-mono whitespace-nowrap">{s.keys.map(keyLabel).join(" + ")}</kbd>
                  </div>
                ))}
                <button
                  onClick={() => {
                    closeMenu();
                    window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
                  }}
                  className="mt-1 mx-2 w-[calc(100%-1rem)] px-2 py-1.5 rounded-lg text-[12px] font-semibold text-[#7ec8ff] hover:bg-white/[0.06] flex justify-between items-center gap-3 border-t border-white/[0.06]"
                >
                  <span>All keyboard shortcuts…</span>
                  <kbd className="bg-white/10 border border-white/10 px-1.5 py-0.5 rounded-md text-[10px] font-mono text-white/75">?</kbd>
                </button>
              </div>
            )}
          </div>

          <div className="w-8 h-8 rounded-full border border-white/30 flex items-center justify-center font-bold text-[14px] text-white shadow-md bg-[#5cb338]" title="Your local workspace — no account needed">
            M
          </div>
        </div>
      </header>

      {/* ─── ROW 2: Sub-Navbar (Tabs & Utility Controls) ─── */}
      <div className="min-h-[3rem] select-none whitespace-nowrap bg-[#0c111d] border-b border-white/[0.08] shadow-[0_2px_10px_rgba(0,0,0,0.25)] flex items-center justify-between px-4 text-white text-sm">
        {/* Project Tabs list */}
        <div className="flex items-center gap-2 h-full overflow-x-auto scrollbar-hide pr-4">
          {layout.tabs.map((tab) => {
            const isActive = tab.id === layout.activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => layout.setActiveTabId(tab.id)}
                className={`group shrink-0 flex items-center gap-2.5 px-4 h-9 rounded-lg border transition-all cursor-pointer ${
                  isActive ? "bg-[#1a2540] border-white/[0.1] text-white font-semibold shadow-[inset_0_-2px_0_#4A90D9]" : "bg-white/[0.03] border-transparent text-white/55 hover:text-white/90 hover:bg-white/[0.07]"
                }`}
              >
                <Database size={16} className={isActive ? "text-[#4A90D9]" : "text-white/30"} />
                {isEditingTitleId === tab.id ? (
                  <input
                    type="text"
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={() => submitRenameTab(tab.id)}
                    onKeyDown={(e) => e.key === "Enter" && submitRenameTab(tab.id)}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent text-white border-b-2 border-[#4A90D9] outline-none text-[14px] w-36 h-6 px-1"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRenameTab(tab.id, tab.title);
                    }}
                    className="overflow-hidden text-clip whitespace-nowrap max-w-[200px] text-[14px]"
                    title="Double-click to rename"
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
                    className={`p-1 rounded-full hover:bg-white/15 text-white/50 hover:text-white transition-all ml-1 ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    title="Close tab"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}

          <button onClick={() => setIsNewSchemaOpen(true)} className="ml-1 w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all border border-transparent hover:border-white/[0.1]" title="Create new workspace tab">
            <Plus size={18} />
          </button>
        </div>

        {/* Right side utility icons */}
        <div className="flex items-center gap-2">
          {[
            { title: "Add table", icon: <Plus size={18} />, onClick: () => layout.triggerToggleUnifiedSidebar("add") },
            { title: "Templates", icon: <LayoutTemplate size={18} />, onClick: () => layout.openTool("templates") },
            { title: "Version history", icon: <History size={18} />, onClick: () => layout.openTool("versions") },
            { title: "Enums", icon: <List size={18} />, onClick: () => layout.openTool("enums") },
            // the two drawers toggle: a second click closes them
            { title: "Table groups", icon: <Group size={18} />, onClick: () => (layout.activeTool?.id === "groups" ? layout.closeTool() : layout.openTool("groups")), active: layout.activeTool?.id === "groups" },
            { title: "Data lineage", icon: <GitBranch size={18} />, onClick: () => (layout.activeTool?.id === "lineage" ? layout.closeTool() : layout.openTool("lineage")), active: layout.activeTool?.id === "lineage" },
            { title: "Diagram views", icon: <Layers size={18} />, onClick: () => layout.triggerToggleUnifiedSidebar("views") },
          ].map((b: { title: string; icon: React.ReactNode; onClick: () => void; active?: boolean }) => (
            <button
              key={b.title}
              onClick={b.onClick}
              aria-pressed={b.active === undefined ? undefined : b.active}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all border ${b.active ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-[#5aa0ea]" : "hover:bg-white/10 text-white/65 hover:text-white border-transparent hover:border-white/[0.1]"}`}
              title={b.title}
            >
              {b.icon}
            </button>
          ))}

          {/* the code panel opens from its edge tab or Ctrl+\; auto arrange is in the bottom toolbar */}
          <button
            onClick={() => layout.setShowGrid(!layout.showGrid)}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all border ${
              layout.showGrid ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-[#5aa0ea]" : "hover:bg-white/10 border-transparent text-white/65 hover:text-white"
            }`}
            title="Toggle grid background"
          >
            <Grid size={18} />
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
          const d = SQL_DIALECTS.find((x) => x.id === (dialect as string)?.toLowerCase())?.id;
          if (d) setTimeout(() => layout.getCanvasApi()?.setSqlDialect(d), 200);
          if (mode === "ai") {
            showToast("AI schema generation initiated ✨", "success");
            setTimeout(() => layout.openTool("ai"), 300);
          } else {
            showToast(`New schema "${title}" created`, "success");
          }
        }}
      />
    </div>
  );
}
