"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronDown, Clock, Database, FolderOpen, LayoutGrid, LayoutTemplate, List, PanelsTopLeft, Plus, Search, Sparkles, Upload, X,
} from "lucide-react";
import type { ProjectTab } from "@/components/Layout/LayoutContext";
import type { NewDiagramKind } from "@/components/Canvas/editorIntent";
import { IntentLink } from "./IntentLink";

export type Section = "all" | "recent" | "templates";

/** The three ways to start — the split button's menu and the empty state's tiles. */
export const NEW_ACTIONS: { id: NewDiagramKind; label: string; hint: string; icon: typeof Plus }[] = [
  { id: "blank", label: "Blank canvas", hint: "An empty diagram — add tables or type DBML", icon: Plus },
  { id: "import", label: "Import SQL or DBML", hint: "PostgreSQL, MySQL, SQLite, SQL Server, DBML, Prisma, CSV…", icon: Upload },
  { id: "ai", label: "Generate with AI", hint: "Describe the app — review the schema before it's applied", icon: Sparkles },
];

// ───────────────────────── small building blocks ─────────────────────────

/** Closes on a press anywhere else (capture: nothing on the page can stop it) or Esc. */
function useDismiss(open: boolean, close: () => void, ...refs: React.RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // Esc closes this menu, not the dashboard
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close]);
}

export function Dropdown<T extends string>({ label, value, options, onChange, icon }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-10 flex items-center gap-2 px-3 rounded-xl bg-[#0e1524] border border-white/[0.08] hover:border-white/[0.16] text-[13px] text-white/80 hover:text-white transition-colors whitespace-nowrap"
      >
        {icon}
        <span className="text-white/45">{label}</span>
        <span className="font-semibold">{current}</span>
        <ChevronDown size={14} className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[200px] p-1.5 rounded-xl bg-[#0c1322] border border-white/[0.1] shadow-[0_18px_50px_rgba(0,0,0,0.6)]">
          {options.map((o) => (
            <button
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-[13px] text-white/80 hover:text-white hover:bg-white/[0.07] text-left"
            >
              {o.label}
              {o.value === value && <Check size={14} className="text-[#4A90D9]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ViewToggle({ view, onChange }: { view: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  const btn = (v: "grid" | "list", icon: React.ReactNode, label: string) => (
    <button onClick={() => onChange(v)} aria-pressed={view === v} title={label} aria-label={label} className={`w-9 h-8 rounded-lg flex items-center justify-center transition-colors ${view === v ? "bg-[#1f2b45] text-white shadow-inner" : "text-white/50 hover:text-white"}`}>
      {icon}
    </button>
  );
  return (
    <div className="h-10 flex items-center gap-0.5 p-1 rounded-xl bg-[#0e1524] border border-white/[0.08]">
      {btn("grid", <LayoutGrid size={15} />, "Grid view")}
      {btn("list", <List size={16} />, "List view")}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  // "/" jumps to the search box from anywhere on the page
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <label className="relative flex-1 min-w-[220px] h-10 flex items-center rounded-xl bg-[#0e1524] border border-white/[0.08] focus-within:border-[#4A90D9]/60 focus-within:ring-2 focus-within:ring-[#4A90D9]/20 transition-colors">
      <Search size={16} className="absolute left-3 text-white/35 pointer-events-none" />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault(); // clears the search; a second Esc closes the dashboard
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label="Search diagrams"
        className="w-full h-full bg-transparent pl-9 pr-16 text-[13.5px] text-white placeholder:text-white/35 outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button onClick={() => onChange("")} aria-label="Clear search" className="absolute right-2 w-6 h-6 rounded-md flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.08]">
          <X size={14} />
        </button>
      ) : (
        <kbd className="absolute right-2.5 h-5 px-1.5 rounded border border-white/[0.12] bg-white/[0.04] text-[10.5px] font-mono text-white/40 flex items-center pointer-events-none">/</kbd>
      )}
    </label>
  );
}

/** The primary action: "New schema" starts a blank canvas; the arrow offers the other ways to start. */
export function NewSchemaButton({ onTemplates }: { onTemplates: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  return (
    <div ref={ref} className="relative flex shrink-0">
      <IntentLink intent={{ new: "blank" }} className="h-10 flex items-center gap-2 pl-3.5 pr-3 rounded-l-xl bg-gradient-to-b from-[#3a82dc] to-[#1d5fb1] hover:from-[#4a8fe6] hover:to-[#2468bd] text-white text-[13.5px] font-semibold shadow-[0_6px_18px_rgba(29,95,177,0.35)] border border-[#5b9be6]/40 transition-colors">
        <Plus size={16} /> <span className="hidden sm:inline">New schema</span>
        <span className="sm:hidden">New</span>
      </IntentLink>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="More ways to start a schema"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-10 w-9 flex items-center justify-center rounded-r-xl bg-gradient-to-b from-[#3a82dc] to-[#1d5fb1] hover:from-[#4a8fe6] hover:to-[#2468bd] text-white border border-l-0 border-[#5b9be6]/40 shadow-[0_6px_18px_rgba(29,95,177,0.35)] relative before:absolute before:left-0 before:top-2 before:bottom-2 before:w-px before:bg-white/25"
      >
        <ChevronDown size={15} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-30 w-80 p-1.5 rounded-xl bg-[#0c1322] border border-white/[0.1] shadow-[0_18px_50px_rgba(0,0,0,0.6)]">
          {NEW_ACTIONS.map((a) => (
            <IntentLink key={a.id} role="menuitem" intent={{ new: a.id }} className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.07] outline-none focus-visible:bg-white/[0.07]">
              <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-[#4A90D9]/12 border border-[#4A90D9]/25 text-[#7fb3ee] flex items-center justify-center">
                <a.icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-white">{a.label}</span>
                <span className="block text-[12px] text-white/45 leading-snug">{a.hint}</span>
              </span>
            </IntentLink>
          ))}
          <div className="h-px bg-white/[0.07] my-1" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onTemplates();
            }}
            className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.07] text-left"
          >
            <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/70 flex items-center justify-center">
              <LayoutTemplate size={15} />
            </span>
            <span>
              <span className="block text-[13.5px] font-semibold text-white">From a template</span>
              <span className="block text-[12px] text-white/45 leading-snug">E-commerce, SaaS, CRM, bookings and more</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── sidebar ─────────────────────────

export function Sidebar({ section, onSection, counts, openTabs, onOpenTab, onBack, onNavigate }: {
  section: Section;
  onSection: (s: Section) => void;
  counts: { all: number | null; recent: number | null };
  openTabs: ProjectTab[];
  onOpenTab: (id: string) => void;
  /** close the dashboard (the editor is right behind it) */
  onBack: () => void;
  /** called after any navigation (the mobile drawer closes) */
  onNavigate?: () => void;
}) {
  const item = (s: Section, icon: React.ReactNode, label: string, count?: number | null) => (
    <button
      onClick={() => {
        onSection(s);
        onNavigate?.();
      }}
      aria-current={section === s ? "page" : undefined}
      className={`w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13.5px] transition-colors ${section === s ? "bg-[#1a2540] text-white font-semibold shadow-[inset_2px_0_0_#4A90D9]" : "text-white/65 hover:text-white hover:bg-white/[0.05]"}`}
    >
      <span className={section === s ? "text-[#7fb3ee]" : "text-white/40"}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {typeof count === "number" && <span className="text-[11.5px] tabular-nums text-white/40">{count}</span>}
    </button>
  );
  const heading = (t: string) => <p className="px-3 pt-5 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/30">{t}</p>;
  return (
    <nav aria-label="Dashboard" className="h-full flex flex-col bg-[#0a0f1b] border-r border-white/[0.06]">
      <div className="h-16 shrink-0 flex items-center gap-2.5 px-5 border-b border-white/[0.06]">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-b from-[#3a82dc] to-[#1d5fb1] border border-white/20 flex items-center justify-center shadow-inner">
          <Database size={16} className="text-white" />
        </span>
        <span className="text-[17px] font-bold tracking-wide text-white">DesignDB</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-scrollbar px-3 pb-4">
        {heading("Workspace")}
        {item("all", <FolderOpen size={16} />, "All diagrams", counts.all)}
        {item("recent", <Clock size={16} />, "Edited this week", counts.recent)}
        {item("templates", <LayoutTemplate size={16} />, "Templates")}

        {heading("Open in the editor")}
        <button onClick={onBack} className="w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13.5px] text-white/65 hover:text-white hover:bg-white/[0.05]">
          <PanelsTopLeft size={16} className="text-white/40" />
          <span className="flex-1 text-left">Back to the editor</span>
        </button>
        {openTabs.slice(0, 6).map((t) => {
          const unsaved = t.id.startsWith("new-") || t.id === "default";
          return (
            <button key={t.id} onClick={() => onOpenTab(t.id)} className="w-full flex items-center gap-3 h-8 pl-10 pr-3 rounded-lg text-[12.5px] text-white/55 hover:text-white hover:bg-white/[0.05]" title={unsaved ? `${t.title} — not saved yet` : t.title}>
              <span className="flex-1 truncate text-left">{t.title}</span>
              {unsaved && <span className="shrink-0 text-[10px] font-semibold text-amber-300/90">not saved</span>}
            </button>
          );
        })}
      </div>

      {/* no account, billing or team settings: DesignDB is free and single-user; diagrams live in this server's database */}
      <div className="shrink-0 m-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        <p className="text-[12px] font-semibold text-white/80">Free · no account needed</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-white/40">Saved diagrams are stored on this DesignDB server.</p>
      </div>
    </nav>
  );
}

// ───────────────────────── states ─────────────────────────

export function SkeletonGrid({ view }: { view: "grid" | "list" }) {
  if (view === "list")
    return (
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[66px] rounded-xl bg-white/[0.025] animate-pulse" />
        ))}
      </div>
    );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="rounded-2xl bg-[#0e1524] border border-white/[0.05] overflow-hidden">
          <div className="aspect-[16/10] bg-white/[0.025] animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-3.5 w-2/3 rounded bg-white/[0.06] animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Zero diagrams: the page becomes onboarding — three ways to start, plus samples one click away. */
export function EmptyWorkspace({ onTemplates, samples }: { onTemplates: () => void; samples: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto py-10 sm:py-16 text-center">
      <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-b from-[#3a82dc] to-[#1d5fb1] border border-white/20 flex items-center justify-center shadow-[0_10px_30px_rgba(29,95,177,0.35)]">
        <Database size={24} className="text-white" />
      </div>
      <h2 className="mt-5 text-[26px] sm:text-[30px] font-bold text-white tracking-tight">Design your first database</h2>
      <p className="mt-2 text-[14.5px] text-white/55 max-w-xl mx-auto leading-relaxed">Start from scratch, bring a schema you already have, or let AI draft one. Everything stays editable — tables, keys, relationships and the diagram itself.</p>
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
        {NEW_ACTIONS.map((a, i) => (
          <IntentLink
            key={a.id}
            intent={{ new: a.id }}
            className={`group rounded-2xl p-5 border transition-all duration-200 hover:-translate-y-0.5 ${i === 0 ? "bg-gradient-to-b from-[#1a3a66] to-[#12243f] border-[#4A90D9]/45 hover:border-[#4A90D9]/80" : "bg-[#0e1524] border-white/[0.08] hover:border-[#4A90D9]/45"}`}
          >
            <span className="w-10 h-10 rounded-xl bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-[#8cc0f5] flex items-center justify-center">
              <a.icon size={18} />
            </span>
            <span className="block mt-4 text-[15px] font-semibold text-white">{a.label}</span>
            <span className="block mt-1 text-[12.5px] text-white/50 leading-snug">{a.hint}</span>
          </IntentLink>
        ))}
      </div>
      <div className="mt-10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/35">Or open a sample</p>
          <button onClick={onTemplates} className="text-[13px] font-semibold text-[#7fb3ee] hover:text-white">
            Browse all templates →
          </button>
        </div>
        {samples}
      </div>
    </div>
  );
}

export function NoMatches({ query, onClear, what }: { query: string; onClear: () => void; what: string }) {
  return (
    <div className="py-20 text-center">
      <Search size={28} className="mx-auto text-white/20" />
      <p className="mt-4 text-[16px] font-semibold text-white">{query ? <>No {what} match “{query}”</> : <>No {what} here yet</>}</p>
      <p className="mt-1 text-[13px] text-white/45">{query ? "Search looks in diagram names, table names and column names." : "Diagrams you edit show up here."}</p>
      {query && (
        <button onClick={onClear} className="mt-4 h-9 px-4 rounded-lg border border-white/[0.14] text-[13px] text-white/80 hover:text-white hover:bg-white/[0.06]">
          Clear search
        </button>
      )}
    </div>
  );
}
