"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import type { ParsedSchema } from "@/lib/sqlParser";

type UnifiedSidebarToggleHandler = (tab?: "add" | "inspector") => void;

type LayoutContextType = {
  isSqlOpen: boolean;
  toggleSql: () => void;
  setSqlOpen: (open: boolean) => void;
  sqlWidthVw: number;
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
  triggerToggleUnifiedSidebar: (tab?: "add" | "inspector") => void;
  triggerToggleDashboard: () => void;
  triggerToggleSqlSandbox: () => void;
  triggerToggleLayout: () => void;
  triggerToggleRelations: () => void;
  triggerToggleAiInsights: () => void;
  // Generated SQL cache (last compiled)
  generatedSql: string;
  setGeneratedSql: (s: string) => void;
};

const LayoutContext = createContext<LayoutContextType | null>(null);

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [isSqlOpen, setIsSqlOpen] = useState(false);
  const sqlWidthVw = 35; // 35% of viewport

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
    } else {
      // Fallback: store the generated SQL if handler not available
      // (Canvas may not have registered yet)
      // Keep generatedSql so user can copy it
      // No-op otherwise
    }
  };

  useEffect(() => {
    // Trigger a fitView when the SQL panel opens/closes so React Flow re-centers
    if (!rfRef.current) return;
    const rf = rfRef.current;
    // Delay slightly to allow CSS transition to finish
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

  const triggerToggleUnifiedSidebar = (tab?: "add" | "inspector") => {
    if (toggleUnifiedSidebarRef.current) toggleUnifiedSidebarRef.current(tab);
  };
  const triggerToggleDashboard = () => { if (toggleDashboardRef.current) toggleDashboardRef.current(); };
  const triggerToggleSqlSandbox = () => { if (toggleSqlSandboxRef.current) toggleSqlSandboxRef.current(); };
  const triggerToggleLayout = () => { if (toggleLayoutRef.current) toggleLayoutRef.current(); };
  const triggerToggleRelations = () => { if (toggleRelationsRef.current) toggleRelationsRef.current(); };
  const triggerToggleAiInsights = () => { if (toggleAiRef.current) toggleAiRef.current(); };

  return (
    <LayoutContext.Provider
      value={{
        isSqlOpen,
        toggleSql: () => setIsSqlOpen(v => !v),
        setSqlOpen: setIsSqlOpen,
        sqlWidthVw,
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
