"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Filter, Menu, RefreshCw, X } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm";
import { matchProject, relativeTime, saveSignature, sortProjects, summarizeProject, type ProjectSort, type StoredProject } from "@/lib/projects";
import { normalizeMeta } from "@/lib/model/types";
import { ProjectCard, ProjectRow, type ProjectAction } from "./ProjectCard";
import { Dropdown, EmptyWorkspace, NewSchemaButton, NoMatches, SearchBox, Sidebar, SkeletonGrid, ViewToggle, type Section } from "./parts";
import { SampleStrip, TemplatesView } from "./TemplatesView";
import { OpenInEditorContext } from "./IntentLink";
import { requestEditorIntent, type EditorIntent } from "@/components/Canvas/editorIntent";
import { apiErrorMessage } from "@/lib/apiError";

/**
 * The workspace dashboard — a large panel over the editor (DesignDB ▾ → Dashboard; /dashboard redirects here): every
 * saved diagram, searchable by name and by what is inside (tables,
 * columns), filterable by database engine, sortable, as cards with a thumbnail or as a list — and everything you can
 * do to a diagram without opening it (rename, duplicate, export, delete). Starting something new happens here too.
 * Saving does not: that belongs to the editor, next to the work (see useProjectSave / docs/DASHBOARD.md).
 */
const WEEK = 7 * 24 * 3600 * 1000;
const PREFS_KEY = "designdb.dashboard";
const SORTS: { value: ProjectSort; label: string }[] = [
  { value: "modified", label: "Last modified" },
  { value: "name", label: "Name (A–Z)" },
  { value: "created", label: "Recently created" },
  { value: "tables", label: "Most tables" },
];

function loadPrefs(): { view: "grid" | "list"; sort: ProjectSort } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { view: p.view === "list" ? "list" : "grid", sort: SORTS.some((s) => s.value === p.sort) ? p.sort : "modified" };
  } catch {
    return { view: "grid", sort: "modified" };
  }
}

async function downloadText(text: string, filename: string, type: string) {
  const { downloadText: dl, safeFilename } = await import("@/lib/export/raster");
  dl(text, safeFilename(filename.replace(/\.[^.]+$/, ""), filename.split(".").pop() || "txt"), type);
}

export function WorkspaceDashboard({ section: requested, onClose }: { section: Section; onClose: () => void }) {
  const layout = useLayout();
  const [projects, setProjects] = useState<StoredProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(requested);
  const [query, setQuery] = useState("");
  const [engine, setEngine] = useState("all");
  const [sort, setSort] = useState<ProjectSort>("modified");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    setView(p.view);
    setSort(p.sort);
  }, []);
  useEffect(() => setSection(requested), [requested]);
  const savePrefs = (next: Partial<{ view: "grid" | "list"; sort: ProjectSort }>) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view, sort, ...next }));
    } catch {
      /* private mode — fine */
    }
  };

  const load = useCallback(async () => {
    setError(null);
    try {
      // "no-cache" = always ask the server, but send the ETag: an unchanged list comes back as a 304, not the whole payload
      const res = await fetch("/api/projects", { cache: "no-cache" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, `the server answered ${res.status}`));
      setProjects(data.projects || []);
    } catch (e: any) {
      setError(e?.message || "Couldn't load your diagrams");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // ── derived ──
  const summaries = useMemo(() => new Map((projects ?? []).map((p) => [p.id, summarizeProject(p)])), [projects]);
  const recentCount = useMemo(() => (projects ?? []).filter((p) => Date.now() - new Date(p.updatedAt).getTime() < WEEK).length, [projects]);
  const engines = useMemo(() => {
    const set = new Set<string>();
    for (const s of summaries.values()) set.add(s.engine ?? "Not set");
    return [...set].sort();
  }, [summaries]);
  const shown = useMemo(() => {
    if (!projects) return [];
    const inSection = section === "recent" ? projects.filter((p) => Date.now() - new Date(p.updatedAt).getTime() < WEEK) : projects;
    const hits: { p: StoredProject; where?: string }[] = [];
    for (const p of inSection) {
      const s = summaries.get(p.id)!;
      if (engine !== "all" && (s.engine ?? "Not set") !== engine) continue;
      const m = matchProject(p, query);
      if (m.match) hits.push({ p, where: m.where });
    }
    const order = new Map(sortProjects(hits.map((h) => h.p), sort).map((p, i) => [p.id, i]));
    return hits.sort((a, b) => order.get(a.p.id)! - order.get(b.p.id)!);
  }, [projects, section, engine, query, sort, summaries]);
  const openIds = useMemo(() => new Set(layout.tabs.map((t) => t.id)), [layout.tabs]);

  // ── actions ──
  const rename = async (p: StoredProject, title: string | null) => {
    setRenamingId(null);
    if (!title || title === p.title) return;
    setProjects((ps) => ps?.map((x) => (x.id === p.id ? { ...x, title } : x)) ?? ps);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      if (!res.ok) throw new Error(apiErrorMessage(await res.json().catch(() => ({})), "rename failed"));
      // open in the editor? keep its tab in step, so autosave doesn't put the old name back
      if (openIds.has(p.id)) {
        const savedSig = saveSignature(p.nodesJson as any, p.edgesJson as any, normalizeMeta(p.meta), title);
        layout.setTabs((ts) => ts.map((t) => (t.id === p.id ? { ...t, title, savedSig } : t)));
        if (layout.activeTabId === p.id) layout.setProjectTitle(title);
      }
      showToast(`Renamed to “${title}”`, "success");
    } catch (e: any) {
      setProjects((ps) => ps?.map((x) => (x.id === p.id ? { ...x, title: p.title } : x)) ?? ps);
      showToast(`Couldn't rename: ${e?.message || "unknown error"}`, "error");
    }
  };

  const onAction = async (p: StoredProject, action: ProjectAction, anchor: Element) => {
    const s = summaries.get(p.id)!;
    if (action === "rename") return setRenamingId(p.id);
    if (action === "duplicate") {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duplicate" }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.project) throw new Error(apiErrorMessage(data, "duplicate failed"));
        setProjects((ps) => (ps ? [data.project, ...ps] : ps));
        showToast(`Duplicated as “${data.project.title}”`, "success");
      } catch (e: any) {
        showToast(`Couldn't duplicate: ${e?.message || "unknown error"}`, "error");
      }
      return;
    }
    if (action === "export-sql" || action === "export-dbml") {
      const [{ canvasToModel }, { modelToSql }, { modelToDbml }] = await Promise.all([import("@/lib/model/canvasAdapter"), import("@/lib/sql/exporter"), import("@/lib/dbml/serializer")]);
      const model = canvasToModel(p.nodesJson as any, p.edgesJson as any, normalizeMeta(p.meta));
      if (action === "export-dbml") await downloadText(modelToDbml(model), `${p.title}.dbml`, "text/plain");
      else {
        const dialect = s.dialect ?? "postgres";
        await downloadText(modelToSql(model, { dialect }), `${p.title}_${dialect}.sql`, "application/sql");
        if (!s.dialect) showToast("Exported as PostgreSQL — set the database type in the editor to choose another", "success");
      }
      return;
    }
    // delete
    const open = openIds.has(p.id);
    const ok = await confirmAction({
      message: ["You're deleting diagram ", { strong: p.title }, ". Are you sure?"],
      detail: `${s.tables} table${s.tables === 1 ? "" : "s"} · edited ${relativeTime(p.updatedAt)}${open ? " · it stays open in the editor as an unsaved copy" : ""}`,
      note: "A deleted diagram can't be restored.",
      anchor,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(apiErrorMessage(await res.json().catch(() => ({})), "delete failed"));
      setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? ps);
      if (open) {
        // its tab becomes a never-saved diagram, so autosave doesn't bring the project back behind your back
        const fresh = `new-${Date.now()}`;
        const wasActive = layout.activeTabId === p.id;
        if (wasActive) layout.tabRenameRef.current = { from: p.id, to: fresh }; // the editor keeps what is on its canvas
        layout.setTabs((ts) => ts.map((t) => (t.id === p.id ? { ...t, id: fresh, savedSig: undefined, savedAt: undefined } : t)));
        if (wasActive) layout.setActiveTabId(fresh);
      }
      showToast(`Deleted “${p.title}”`, "success");
    } catch (e: any) {
      showToast(`Couldn't delete: ${e?.message || "unknown error"}`, "error");
    }
  };

  const openTab = (id: string) => {
    layout.setActiveTabId(id);
    onClose();
  };
  // opening a diagram / starting one happens in the editor right behind the panel
  const openInEditor = useCallback(
    (intent: EditorIntent) => {
      requestEditorIntent(intent);
      onClose();
    },
    [onClose]
  );

  // focus moves into the panel, so keys typed here don't reach the editor behind it
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before) && before !== document.body) before.focus({ preventScroll: true });
    };
  }, []);
  // …and when focus falls out of it (the menu item that had it closed), the next key is kept from the editor too
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      const t = e.target as Node;
      if (!panel || panel.contains(t) || (t instanceof Element && t.closest('[role="alertdialog"]'))) return;
      e.stopPropagation();
      panel.focus({ preventScroll: true });
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", guard, true);
    return () => document.removeEventListener("keydown", guard, true);
  }, [onClose]);

  // ── layout ──
  const empty = projects !== null && projects.length === 0;
  const title = section === "templates" ? "Templates" : section === "recent" ? "Edited this week" : "All diagrams";
  const subtitle =
    section === "templates"
      ? "Ready-made schemas — one click opens a copy as a new diagram"
      : projects === null
        ? "Loading…"
        : `${projects.length} diagram${projects.length === 1 ? "" : "s"}${recentCount ? ` · ${recentCount} edited this week` : ""}`;
  const sidebar = (
    <Sidebar
      section={section}
      onSection={setSection}
      counts={{ all: projects?.length ?? null, recent: projects ? recentCount : null }}
      openTabs={layout.tabs.filter((t) => (t.nodes?.length ?? 0) > 0 || !(t.id.startsWith("new-") || t.id === "default"))}
      onOpenTab={openTab}
      onBack={onClose}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <OpenInEditorContext.Provider value={openInEditor}>
    {/* the backdrop: a click on it (not on the panel) closes the dashboard */}
    <div
      className="fixed inset-0 z-[62] flex items-center justify-center sm:p-5 bg-black/55"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        // keys typed in the dashboard stay here: the editor behind (Delete, Ctrl+Z, shortcuts…) must not react to them
        e.stopPropagation();
        if (e.key === "Escape" && !e.defaultPrevented) onClose(); // menus, search and rename mark their own Esc
      }}
    >
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Dashboard"
      className="relative flex w-full h-full sm:w-[min(1360px,100%)] sm:h-[min(880px,100%)] bg-[#070b14] text-white sm:rounded-2xl border border-white/[0.1] shadow-[0_30px_90px_rgba(0,0,0,0.75)] overflow-hidden outline-none"
    >
      <aside className="hidden lg:block w-[248px] shrink-0 h-full">{sidebar}</aside>
      {drawer && (
        <div className="lg:hidden absolute inset-0 z-40 flex">
          <div className="w-[272px] max-w-[85vw] h-full shadow-2xl">{sidebar}</div>
          <button className="flex-1 bg-black/55" aria-label="Close menu" onClick={() => setDrawer(false)} />
        </div>
      )}

      <div className="flex-1 min-w-0 h-full overflow-y-auto p-scrollbar">
        <header className="sticky top-0 z-20 bg-[#070b14] border-b border-white/[0.06]">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-4 space-y-4">
            <div className="flex items-center gap-3">
              <button className="lg:hidden w-10 h-10 -ml-1 rounded-xl flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.06]" aria-label="Open menu" onClick={() => setDrawer(true)}>
                {drawer ? <X size={18} /> : <Menu size={18} />}
              </button>
              <div className="flex-1 min-w-0">
                <h1 className="text-[22px] sm:text-[24px] font-bold tracking-tight truncate">{title}</h1>
                <p className="text-[13px] text-white/45 truncate">{subtitle}</p>
              </div>
              <NewSchemaButton onTemplates={() => setSection("templates")} />
              <button onClick={onClose} className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors" aria-label="Close the dashboard" title="Close (Esc)">
                <X size={18} />
              </button>
            </div>
            {!empty && (
              <div className="flex flex-wrap items-center gap-2.5">
                <SearchBox value={query} onChange={setQuery} placeholder={section === "templates" ? "Search templates…" : "Search diagrams, tables and columns…"} />
                {section !== "templates" && (
                  <>
                    <Dropdown label="Engine" icon={<Filter size={14} className="text-white/40" />} value={engine} onChange={setEngine} options={[{ value: "all", label: "All" }, ...engines.map((e) => ({ value: e, label: e }))]} />
                    <Dropdown
                      label="Sort"
                      value={sort}
                      onChange={(v) => {
                        setSort(v);
                        savePrefs({ sort: v });
                      }}
                      options={SORTS}
                    />
                    <ViewToggle
                      view={view}
                      onChange={(v) => {
                        setView(v);
                        savePrefs({ view: v });
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {section === "templates" ? (
            <TemplatesView query={query} />
          ) : error ? (
            <div className="max-w-md mx-auto my-16 p-6 rounded-2xl bg-[#0e1524] border border-red-400/25 text-center">
              <AlertTriangle size={26} className="mx-auto text-red-300" />
              <p className="mt-3 text-[15px] font-semibold">Couldn&apos;t load your diagrams</p>
              <p className="mt-1 text-[13px] text-white/50">{error}</p>
              <button onClick={() => void load()} className="mt-4 h-9 px-4 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] text-[13px] font-semibold inline-flex items-center gap-2">
                <RefreshCw size={14} /> Try again
              </button>
            </div>
          ) : projects === null ? (
            <SkeletonGrid view={view} />
          ) : empty ? (
            <EmptyWorkspace onTemplates={() => setSection("templates")} samples={<SampleStrip />} />
          ) : !shown.length ? (
            <NoMatches
              query={query || (engine !== "all" ? engine : "")}
              what={section === "recent" ? "diagrams edited this week" : "diagrams"}
              onClear={() => {
                setQuery("");
                setEngine("all");
              }}
            />
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
              {shown.map(({ p, where }) => (
                <ProjectCard key={p.id} project={p} isOpen={openIds.has(p.id)} matchedIn={where} renaming={renamingId === p.id} onRename={(t) => void rename(p, t)} onAction={(a, el) => void onAction(p, a, el)} />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="hidden md:grid grid-cols-[72px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_40px] gap-4 px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white/30 border-b border-white/[0.06]">
                <span />
                <span>Name</span>
                <span>Engine</span>
                <span>Contents</span>
                <span>Edited</span>
                <span />
              </div>
              {shown.map(({ p, where }) => (
                <ProjectRow key={p.id} project={p} isOpen={openIds.has(p.id)} matchedIn={where} renaming={renamingId === p.id} onRename={(t) => void rename(p, t)} onAction={(a, el) => void onAction(p, a, el)} />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
    </div>
    </OpenInEditorContext.Provider>
  );
}
