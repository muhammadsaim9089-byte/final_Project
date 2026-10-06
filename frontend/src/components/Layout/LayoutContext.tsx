"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import type { ParsedSchema } from "@/lib/sqlParser";
import type { DiagramModel, ProjectMeta } from "@/lib/model/types";
import { defaultMeta } from "@/lib/model/types";
import type { DbmlDiagnostic } from "@/lib/dbml/parser";
import type { LayoutKind } from "@/lib/layout";
import type { VersionKind, VersionRecord } from "@/lib/versions/store";
import type { DashboardSection } from "@/components/Canvas/editorIntent";

type UnifiedSidebarToggleHandler = (tab?: "add" | "inspector" | "views") => void;

export type CodeWindowMode = "split" | "fullscreen" | "collapsed";
export type SqlPanelTab = "dbml" | "editor";

/** Width of the docked AI chat panel (the code editor's full-screen mode and edge tab clear it). */
export const AI_DOCK_WIDTH = "clamp(320px, 26vw, 400px)";

export type ToolId =
  | "share"
  | "export"
  | "versions"
  | "templates"
  | "docs"
  | "convert"
  | "reverse"
  | "ai"
  | "enums"
  | "import"
  | "colors"
  | "groups"
  | "lineage";

export type ProjectTab = {
  id: string;
  title: string;
  nodes: any[];
  edges: any[];
  generatedSql: string;
  generatedMermaid: string;
  meta?: ProjectMeta;
  dbml?: string;
  /** Fingerprint (saveSignature) of this tab's diagram as last saved to / loaded from the server. Undefined for a
   *  project that was just opened: the editor takes the first fingerprint it computes as the saved state. */
  savedSig?: string;
  /** When it was last saved (ms), for "Saved 2 minutes ago". */
  savedAt?: number;
};

/** What the editor's save indicator shows. */
export interface SaveStatus {
  /** empty: nothing to save yet · unsaved: never saved · saved · dirty: changed since the last save · saving · error */
  state: "empty" | "unsaved" | "saved" | "dirty" | "saving" | "error";
  savedAt: number | null;
  error?: string;
}

export interface ApplyModelOptions {
  /** "replace" swaps the whole diagram, "merge" adds tables to the current one. */
  mode?: "replace" | "merge";
  layout?: "auto" | "keep";
  fit?: boolean;
  /** Snapshot the current diagram into version history first, with this label. */
  restorePoint?: string;
}

/** What tool modals and panels can ask the canvas to do. Registered by <Canvas/>. */
export interface CanvasApi {
  getState(): { nodes: Node[]; edges: Edge[]; meta: ProjectMeta };
  getModel(): DiagramModel;
  setGraph(g: { nodes: Node[]; edges: Edge[]; meta?: ProjectMeta }, opts?: { fit?: boolean; version?: VersionKind | false }): void;
  applyModel(model: DiagramModel, opts?: ApplyModelOptions): { tables: number };
  focusTable(nameOrId: string): void;
  fitView(): void;
  autoLayout(kind?: LayoutKind): void;
  /** Registers an undo point. Pass the just-changed nodes/edges directly — reading them back from state in the
   *  same tick would still see the pre-change value. */
  snapshot(override?: { nodes?: Node[]; edges?: Edge[] }): void;
  saveVersion(kind: VersionKind, label?: string): Promise<void>;
  restoreGraph(g: { nodes: Node[]; edges: Edge[]; meta: ProjectMeta }): void;
  getSvgOptions(): { detail: "all" | "keys" | "headers"; showRelationships: boolean };
  getSqlDialect(): string;
  setSqlDialect(d: string): void;
  /** Briefly marks tables "added"/"modified" (a coloured top border + New/Mod badge) so a change is easy to spot on the canvas. */
  highlightTables(statusByKey: Record<string, "added" | "modified">): void;
}

/** A pending AI change, shown identically in the AI chat, the DBML code editor and (once accepted) the canvas. */
export interface AiProposalView {
  id: string;
  label: string;
  before: string;
  after: string;
  /** Human-readable bullets: which tables/columns/refs were added, changed or removed. */
  changes: string[];
  resolve: (accept: boolean) => void;
}

export type RevealTarget = { table: string; column?: string; nonce: number };

type LayoutContextType = {
  isSqlOpen: boolean;
  toggleSql: () => void;
  setSqlOpen: (open: boolean) => void;
  codeWindowMode: CodeWindowMode;
  setCodeWindowMode: (mode: CodeWindowMode) => void;
  toggleCodeWindowFullscreen: () => void;
  sqlWidthVw: number;
  panelWidth: number;
  setPanelWidth: (w: number) => void;
  rfInstance: ReactFlowInstance | null;
  registerRfInstance: (rf: ReactFlowInstance | null) => void;
  getRfNodes: () => any[];
  registerApplySqlHandler: (fn: (parsed: ParsedSchema) => void) => void;
  applyParsedSchema: (parsed: ParsedSchema) => void;
  // Registration hooks so outer nav can toggle internals inside Canvas
  registerToggleUnifiedSidebar: (fn: UnifiedSidebarToggleHandler) => void;
  registerToggleSqlSandbox: (fn: () => void) => void;
  registerToggleLayout: (fn: () => void) => void;
  registerToggleRelations: (fn: () => void) => void;
  registerToggleAiInsights: (fn: () => void) => void;
  // Triggerers used by nav
  triggerToggleUnifiedSidebar: (tab?: "add" | "inspector" | "views") => void;
  triggerToggleSqlSandbox: () => void;
  triggerToggleLayout: () => void;
  triggerToggleRelations: () => void;
  triggerToggleAiInsights: () => void;
  // Generated SQL cache (last compiled)
  generatedSql: string;
  setGeneratedSql: (s: string) => void;
  sqlActiveTab: SqlPanelTab;
  setSqlActiveTab: (tab: SqlPanelTab) => void;

  // Project Tabs State
  tabs: ProjectTab[];
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  setTabs: React.Dispatch<React.SetStateAction<ProjectTab[]>>;
  updateActiveTab: (updates: Partial<ProjectTab>) => void;
  /** Opens a new tab (and switches to it). `opts.id` opens it as that saved project. */
  addTab: (title?: string, initial?: Partial<Pick<ProjectTab, "nodes" | "edges" | "meta" | "dbml" | "savedAt">>, opts?: { id?: string }) => string;
  closeTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;

  // Global Project Meta
  projectTitle: string;
  setProjectTitle: (t: string) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  // ── saving (the editor owns it; the top bar shows it) ──
  /** The active tab's save status (each tab has its own — a save finishing late never shows on another diagram). */
  saveStatus: SaveStatus;
  /** Sets a tab's save status (the active tab's when no id is given). */
  setSaveStatus: (s: SaveStatus, tabId?: string) => void;
  /** Any tab's current status, read synchronously (not from the last render). */
  getSaveStatus: (tabId: string) => SaveStatus | undefined;
  /** Saves the active diagram now (Ctrl+S, the save button, the DesignDB menu). Resolves true when it was saved. */
  requestSave: (opts?: { explicit?: boolean }) => Promise<boolean>;
  registerSaveHandler: (fn: ((opts?: { explicit?: boolean }) => Promise<boolean>) | null) => void;

  // ── the dashboard: a large panel over the editor (DesignDB ▾ → Dashboard) ──
  /** the open section, or null when the panel is closed */
  dashboard: DashboardSection | null;
  openDashboard: (section?: DashboardSection) => void;
  closeDashboard: () => void;
  generatedMermaid: string;
  setGeneratedMermaid: (m: string) => void;

  // Grid state
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;

  // ── Schema meta (enums, table-group styling, diagram views, project info) ──
  meta: ProjectMeta;
  setMeta: (updater: ProjectMeta | ((prev: ProjectMeta) => ProjectMeta)) => void;

  // ── DBML editor state ──
  dbmlText: string;
  setDbmlText: (t: string) => void;
  dbmlDiagnostics: DbmlDiagnostic[];
  setDbmlDiagnostics: (d: DbmlDiagnostic[]) => void;
  /** Called by the editor on every change; Canvas parses + applies it (debounced). */
  editDbml: (text: string) => void;
  registerDbmlEditHandler: (fn: (text: string) => void) => void;
  reveal: RevealTarget | null;
  revealInEditor: (table: string, column?: string) => void;
  /** Editor asks the canvas to focus a table (Ctrl+click on a name). */
  focusTableFromEditor: (name: string) => void;

  // ── Tools / modals ──
  activeTool: { id: ToolId; payload?: any } | null;
  openTool: (id: ToolId, payload?: any) => void;
  closeTool: () => void;
  /** The AI chat panel docks to the left of the code editor; it is independent of `activeTool`. */
  aiOpen: boolean;
  setAiOpen: (open: boolean) => void;
  toggleAi: () => void;
  /** The one AI change currently awaiting a decision — shown in the AI chat, the DBML editor and (once accepted) the canvas. */
  aiProposal: AiProposalView | null;
  setAiProposal: (p: AiProposalView | null) => void;

  // ── Version history live preview state ──
  previewVersion: VersionRecord | null;
  setPreviewVersion: (v: VersionRecord | null) => void;

  // ── Canvas API for tools ──
  registerCanvasApi: (api: CanvasApi | null) => void;
  getCanvasApi: () => CanvasApi | null;

  /** Set when a tab id changes because it was saved (unsaved id → project id): not a tab switch. */
  tabRenameRef: React.MutableRefObject<{ from: string; to: string } | null>;
};

const LayoutContext = createContext<LayoutContextType | null>(null);

const emptyTab = (id: string, title = "Untitled Schema"): ProjectTab => ({
  id,
  title,
  nodes: [],
  edges: [],
  generatedSql: "",
  generatedMermaid: "",
  meta: defaultMeta(),
  dbml: "",
});

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [codeWindowMode, setCodeWindowModeState] = useState<CodeWindowMode>("split");
  const [isSqlOpen, setIsSqlOpenState] = useState(true);
  const [panelWidth, setPanelWidth] = useState(35); // vw units
  const sqlWidthVw = 35; // 35% of viewport

  // Project Tab states
  const [tabs, setTabs] = useState<ProjectTab[]>([emptyTab("default")]);
  const [activeTabId, setActiveTabId] = useState<string>("default");

  // Global project states
  const [projectTitle, setProjectTitleState] = useState("Untitled Schema");
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);
  const [generatedMermaid, setGeneratedMermaid] = useState("");
  const [showGrid, setShowGrid] = useState(true);

  // The active tab's id as of the latest call — opening / saving a project renames the tab to the project id and then
  // sets the title in the same tick, so reading the `activeTabId` state there would still see the old id and the title
  // update would miss the tab (it kept showing the previous name).
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // Sync active tab title with global projectTitle and ID
  const setProjectTitle = (title: string) => {
    setProjectTitleState(title);
    updateTabTitle(activeTabIdRef.current, title);
  };

  const tabRenameRef = useRef<{ from: string; to: string } | null>(null);
  const setCurrentProjectId = (id: string | null) => {
    setCurrentProjectIdState(id);
    const current = activeTabIdRef.current;
    if (id && id !== current) {
      tabRenameRef.current = { from: current, to: id };
      setTabs((prev) => prev.map((t) => (t.id === current ? { ...t, id } : t)));
      setActiveTabId(id);
      activeTabIdRef.current = id;
    }
  };

  const updateTabTitle = (id: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const updateActiveTab = (updates: Partial<ProjectTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, ...updates } : t)));
  };

  const addTab = (title = "Untitled Schema", initial?: Partial<Pick<ProjectTab, "nodes" | "edges" | "meta" | "dbml" | "savedAt">>, opts?: { id?: string }): string => {
    const newId = opts?.id || `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTab: ProjectTab = { ...emptyTab(newId, title), ...initial, meta: initial?.meta || defaultMeta() };
    setTabs((prev) => [...prev.filter((t) => t.id !== newId), newTab]);
    setActiveTabId(newId);
    activeTabIdRef.current = newId;
    setProjectTitleState(title);
    setCurrentProjectIdState(opts?.id || null);
    return newId;
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (filtered.length === 0) {
        // Always keep at least one tab
        return [emptyTab(`new-${Date.now()}`)];
      }
      return filtered;
    });
  };

  // When the active tab is closed, move to a neighbour
  useEffect(() => {
    if (!tabs.some((t) => t.id === activeTabId) && tabs.length) setActiveTabId(tabs[tabs.length - 1].id);
  }, [tabs, activeTabId]);

  // When active tab changes, sync global states
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active) {
      setProjectTitleState(active.title);
      // If it starts with "new-", it's unsaved, so currentProjectId is null
      if (active.id.startsWith("new-") || active.id === "default") {
        setCurrentProjectIdState(null);
      } else {
        setCurrentProjectIdState(active.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const setCodeWindowMode = (mode: CodeWindowMode) => {
    setCodeWindowModeState(mode);
    setIsSqlOpenState(mode !== "collapsed");
  };

  const setSqlOpen = (open: boolean) => {
    setIsSqlOpenState(open);
    if (open) {
      if (codeWindowMode === "collapsed") setCodeWindowModeState("split");
    } else {
      setCodeWindowModeState("collapsed");
    }
  };

  const toggleSql = () => {
    if (codeWindowMode === "collapsed") {
      setCodeWindowMode("split");
    } else {
      setCodeWindowMode("collapsed");
    }
  };

  const toggleCodeWindowFullscreen = () => {
    if (codeWindowMode === "fullscreen") {
      setCodeWindowMode("split");
    } else {
      setCodeWindowMode("fullscreen");
    }
  };

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const applyHandlerRef = useRef<((p: ParsedSchema) => void) | null>(null);

  // Toggle registration refs
  const toggleUnifiedSidebarRef = useRef<UnifiedSidebarToggleHandler | null>(null);
  const toggleSqlSandboxRef = useRef<(() => void) | null>(null);
  const toggleLayoutRef = useRef<(() => void) | null>(null);
  const toggleRelationsRef = useRef<(() => void) | null>(null);
  const toggleAiRef = useRef<(() => void) | null>(null);

  const [generatedSql, setGeneratedSql] = useState<string>("");

  // Register RF instance — used to call fitView on panel toggles
  const registerRfInstance = (rf: ReactFlowInstance | null) => {
    rfRef.current = rf;
    setRfInstance(rf);
  };

  // Return nodes from registered ReactFlow instance (if available)
  const getRfNodes = () => {
    try {
      return rfRef.current ? rfRef.current.getNodes() : [];
    } catch (e) {
      return [];
    }
  };

  // Register handler when SQL panel should apply parsed schema into the canvas
  const registerApplySqlHandler = (fn: (parsed: ParsedSchema) => void) => {
    applyHandlerRef.current = fn;
  };

  const applyParsedSchema = (parsed: ParsedSchema) => {
    if (applyHandlerRef.current) {
      applyHandlerRef.current(parsed);
    }
  };

  useEffect(() => {
    if (!rfRef.current) return;
    const rf = rfRef.current;
    const t = setTimeout(() => {
      try {
        rf.fitView({ duration: 600, padding: 0.12 });
      } catch (e) {
        // ignore
      }
    }, 260);
    return () => clearTimeout(t);
  }, [isSqlOpen]);

  // Registration helpers for toggles
  const registerToggleUnifiedSidebar = (fn: UnifiedSidebarToggleHandler) => {
    toggleUnifiedSidebarRef.current = fn;
  };
  const registerToggleSqlSandbox = (fn: () => void) => { toggleSqlSandboxRef.current = fn; };
  const registerToggleLayout = (fn: () => void) => { toggleLayoutRef.current = fn; };
  const registerToggleRelations = (fn: () => void) => { toggleRelationsRef.current = fn; };
  const registerToggleAiInsights = (fn: () => void) => { toggleAiRef.current = fn; };

  const triggerToggleUnifiedSidebar = (tab?: "add" | "inspector" | "views") => {
    if (toggleUnifiedSidebarRef.current) toggleUnifiedSidebarRef.current(tab);
  };
  const triggerToggleSqlSandbox = () => { if (toggleSqlSandboxRef.current) toggleSqlSandboxRef.current(); };
  const triggerToggleLayout = () => { if (toggleLayoutRef.current) toggleLayoutRef.current(); };
  const triggerToggleRelations = () => { if (toggleRelationsRef.current) toggleRelationsRef.current(); };
  const triggerToggleAiInsights = () => { if (toggleAiRef.current) toggleAiRef.current(); };

  const [sqlActiveTab, setSqlActiveTab] = useState<SqlPanelTab>("dbml");

  // ── schema meta ──
  const [meta, setMetaState] = useState<ProjectMeta>(defaultMeta());
  const setMeta = useCallback((updater: ProjectMeta | ((prev: ProjectMeta) => ProjectMeta)) => {
    setMetaState((prev) => (typeof updater === "function" ? (updater as (p: ProjectMeta) => ProjectMeta)(prev) : updater));
  }, []);

  // ── DBML editor ──
  const [dbmlText, setDbmlText] = useState("");
  const [dbmlDiagnostics, setDbmlDiagnostics] = useState<DbmlDiagnostic[]>([]);
  const dbmlEditRef = useRef<((t: string) => void) | null>(null);
  const registerDbmlEditHandler = useCallback((fn: (t: string) => void) => {
    dbmlEditRef.current = fn;
  }, []);
  const editDbml = useCallback((text: string) => {
    setDbmlText(text);
    dbmlEditRef.current?.(text);
  }, []);
  const [reveal, setReveal] = useState<RevealTarget | null>(null);
  const revealInEditor = useCallback((table: string, column?: string) => {
    setReveal({ table, column, nonce: Date.now() });
  }, []);
  const focusCanvasTableRef = useRef<((name: string) => void) | null>(null);

  // ── tools ──
  const [activeTool, setActiveTool] = useState<{ id: ToolId; payload?: any } | null>(null);
  const [previewVersion, setPreviewVersion] = useState<VersionRecord | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const toggleAi = useCallback(() => setAiOpen((v) => !v), []);
  const [aiProposal, setAiProposal] = useState<AiProposalView | null>(null);
  const openTool = useCallback((id: ToolId, payload?: any) => {
    if (id === "ai") setAiOpen(true);
    else setActiveTool({ id, payload });
  }, []);
  const closeTool = useCallback(() => {
    setPreviewVersion(null);
    setActiveTool(null);
  }, []);

  // ── saving ──
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const saveStatusesRef = useRef<Record<string, SaveStatus>>({});
  const setSaveStatus = useCallback((st: SaveStatus, tabId?: string) => {
    const id = tabId ?? activeTabIdRef.current;
    const cur = saveStatusesRef.current[id];
    if (cur && cur.state === st.state && cur.savedAt === st.savedAt && cur.error === st.error) return;
    saveStatusesRef.current = { ...saveStatusesRef.current, [id]: st };
    setSaveStatuses(saveStatusesRef.current);
  }, []);
  const getSaveStatus = useCallback((tabId: string) => saveStatusesRef.current[tabId], []);
  const saveStatus: SaveStatus = saveStatuses[activeTabId] ?? { state: "empty", savedAt: null };
  const saveHandlerRef = useRef<((opts?: { explicit?: boolean }) => Promise<boolean>) | null>(null);
  const registerSaveHandler = useCallback((fn: ((opts?: { explicit?: boolean }) => Promise<boolean>) | null) => {
    saveHandlerRef.current = fn;
  }, []);
  const requestSave = useCallback(async (opts?: { explicit?: boolean }) => (saveHandlerRef.current ? saveHandlerRef.current(opts) : false), []);

  // ── dashboard panel ──
  const [dashboard, setDashboard] = useState<DashboardSection | null>(null);
  const openDashboard = useCallback((section: DashboardSection = "all") => setDashboard(section), []);
  const closeDashboard = useCallback(() => setDashboard(null), []);

  // ── canvas api ──
  const canvasApiRef = useRef<CanvasApi | null>(null);
  const registerCanvasApi = useCallback((api: CanvasApi | null) => {
    canvasApiRef.current = api;
    focusCanvasTableRef.current = api ? (name: string) => api.focusTable(name) : null;
  }, []);
  const getCanvasApi = useCallback(() => canvasApiRef.current, []);
  const focusTableFromEditor = useCallback((name: string) => focusCanvasTableRef.current?.(name), []);

  return (
    <LayoutContext.Provider
      value={{
        isSqlOpen,
        toggleSql,
        setSqlOpen,
        codeWindowMode,
        setCodeWindowMode,
        toggleCodeWindowFullscreen,
        sqlWidthVw,
        panelWidth,
        setPanelWidth,
        rfInstance,
        registerRfInstance,
        getRfNodes,
        registerApplySqlHandler,
        applyParsedSchema,
        registerToggleUnifiedSidebar,
        registerToggleSqlSandbox,
        registerToggleLayout,
        registerToggleRelations,
        registerToggleAiInsights,
        triggerToggleUnifiedSidebar,
        triggerToggleSqlSandbox,
        triggerToggleLayout,
        triggerToggleRelations,
        triggerToggleAiInsights,
        generatedSql,
        setGeneratedSql,
        sqlActiveTab,
        setSqlActiveTab,

        // Project tabs
        tabs,
        activeTabId,
        setActiveTabId,
        setTabs,
        updateActiveTab,
        addTab,
        closeTab,
        updateTabTitle,

        // Global project meta
        projectTitle,
        setProjectTitle,
        currentProjectId,
        setCurrentProjectId,
        saveStatus,
        setSaveStatus,
        getSaveStatus,
        requestSave,
        registerSaveHandler,
        dashboard,
        openDashboard,
        closeDashboard,
        generatedMermaid,
        setGeneratedMermaid,

        // Grid
        showGrid,
        setShowGrid,

        meta,
        setMeta,

        dbmlText,
        setDbmlText,
        dbmlDiagnostics,
        setDbmlDiagnostics,
        editDbml,
        registerDbmlEditHandler,
        reveal,
        revealInEditor,
        focusTableFromEditor,

        activeTool,
        openTool,
        closeTool,
        aiOpen,
        setAiOpen,
        toggleAi,
        aiProposal,
        setAiProposal,

        registerCanvasApi,
        getCanvasApi,
        tabRenameRef,
        previewVersion,
        setPreviewVersion,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error("useLayout must be used within LayoutProvider");
  return ctx;
}
