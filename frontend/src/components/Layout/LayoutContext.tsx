"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { ParsedSchema } from "@/lib/sqlParser";

type UnifiedSidebarToggleHandler = (tab?: "add" | "inspector" | "views") => void;

export type CodeWindowMode = "split" | "fullscreen" | "collapsed";

export type ProjectTab = {
  id: string;
  title: string;
  nodes: any[];
  edges: any[];
  generatedSql: string;
  generatedMermaid: string;
};

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
  registerToggleDashboard: (fn: () => void) => void;
  registerToggleSqlSandbox: (fn: () => void) => void;
  registerToggleLayout: (fn: () => void) => void;
  registerToggleRelations: (fn: () => void) => void;
  registerToggleAiInsights: (fn: () => void) => void;
  // Triggerers used by nav
  triggerToggleUnifiedSidebar: (tab?: "add" | "inspector" | "views") => void;
  triggerToggleDashboard: () => void;
  triggerToggleSqlSandbox: () => void;
  triggerToggleLayout: () => void;
  triggerToggleRelations: () => void;
  triggerToggleAiInsights: () => void;
  // Generated SQL cache (last compiled)
  generatedSql: string;
  setGeneratedSql: (s: string) => void;
  sqlActiveTab: "editor" | "import";
  setSqlActiveTab: (tab: "editor" | "import") => void;

  // Project Tabs State
  tabs: ProjectTab[];
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  setTabs: React.Dispatch<React.SetStateAction<ProjectTab[]>>;
  updateActiveTab: (updates: Partial<ProjectTab>) => void;
  addTab: (title?: string) => void;
  closeTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;

  // Global Project Meta
  projectTitle: string;
  setProjectTitle: (t: string) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  generatedMermaid: string;
  setGeneratedMermaid: (m: string) => void;

  // Grid state
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
};

const LayoutContext = createContext<LayoutContextType | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [codeWindowMode, setCodeWindowModeState] = useState<CodeWindowMode>("split");
  const [isSqlOpen, setIsSqlOpenState] = useState(true);
  const [panelWidth, setPanelWidth] = useState(35); // vw units
  const sqlWidthVw = 35; // 35% of viewport

  // Project Tab states
  const [tabs, setTabs] = useState<ProjectTab[]>([
    {
      id: "default",
      title: "Untitled Schema",
      nodes: [],
      edges: [],
      generatedSql: "",
      generatedMermaid: "",
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("default");

  // Global project states
  const [projectTitle, setProjectTitleState] = useState("Untitled Schema");
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(null);
  const [generatedMermaid, setGeneratedMermaid] = useState("");
  const [showGrid, setShowGrid] = useState(true);

  // Sync active tab title with global projectTitle and ID
  const setProjectTitle = (title: string) => {
    setProjectTitleState(title);
    updateTabTitle(activeTabId, title);
  };

  const setCurrentProjectId = (id: string | null) => {
    setCurrentProjectIdState(id);
    if (id) {
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, id } : t));
      setActiveTabId(id);
    }
  };

  const updateTabTitle = (id: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t));
  };

  const updateActiveTab = (updates: Partial<ProjectTab>) => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, ...updates } : t));
  };

  const addTab = (title = "Untitled Schema") => {
    const newId = `new-${Date.now()}`;
    const newTab: ProjectTab = {
      id: newId,
      title,
      nodes: [],
      edges: [],
      generatedSql: "",
      generatedMermaid: "",
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setProjectTitleState(title);
    setCurrentProjectIdState(null);
  };

  const closeTab = (id: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== id);
      if (filtered.length === 0) {
        // Always keep at least one tab
        const defaultId = `new-${Date.now()}`;
        return [{
          id: defaultId,
          title: "Untitled Schema",
          nodes: [],
          edges: [],
          generatedSql: "",
          generatedMermaid: "",
        }];
      }
      return filtered;
    });
  };

  // When active tab changes, sync global states
  useEffect(() => {
    const active = tabs.find(t => t.id === activeTabId);
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
  const toggleDashboardRef = useRef<(() => void) | null>(null);
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
  const registerToggleDashboard = (fn: () => void) => { toggleDashboardRef.current = fn; };
  const registerToggleSqlSandbox = (fn: () => void) => { toggleSqlSandboxRef.current = fn; };
  const registerToggleLayout = (fn: () => void) => { toggleLayoutRef.current = fn; };
  const registerToggleRelations = (fn: () => void) => { toggleRelationsRef.current = fn; };
  const registerToggleAiInsights = (fn: () => void) => { toggleAiRef.current = fn; };

  const triggerToggleUnifiedSidebar = (tab?: "add" | "inspector" | "views") => {
    if (toggleUnifiedSidebarRef.current) toggleUnifiedSidebarRef.current(tab);
  };
  const triggerToggleDashboard = () => { if (toggleDashboardRef.current) toggleDashboardRef.current(); };
  const triggerToggleSqlSandbox = () => { if (toggleSqlSandboxRef.current) toggleSqlSandboxRef.current(); };
  const triggerToggleLayout = () => { if (toggleLayoutRef.current) toggleLayoutRef.current(); };
  const triggerToggleRelations = () => { if (toggleRelationsRef.current) toggleRelationsRef.current(); };
  const triggerToggleAiInsights = () => { if (toggleAiRef.current) toggleAiRef.current(); };

  const [sqlActiveTab, setSqlActiveTab] = useState<"editor" | "import">("editor");

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
        registerToggleDashboard,
        registerToggleSqlSandbox,
        registerToggleLayout,
        registerToggleRelations,
        registerToggleAiInsights,
        triggerToggleUnifiedSidebar,
        triggerToggleDashboard,
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
        generatedMermaid,
        setGeneratedMermaid,

        // Grid
        showGrid,
        setShowGrid,
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

