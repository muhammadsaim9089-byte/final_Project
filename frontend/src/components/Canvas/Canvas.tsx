"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  ConnectionMode,
  Edge,
  Node,
  BackgroundVariant,
  ReactFlowInstance,
  Position,
  MiniMap
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CanvasBottomBar } from "./CanvasBottomBar";
import { useLayout, type CodeWindowMode } from "@/components/Layout/LayoutContext";
import { requestAutoArrange } from "./AutoArrange";
import { useProjectSave } from "@/hooks/useProjectSave";
import { EDITOR_INTENT_EVENT, type EditorIntent } from "./editorIntent";
import { applyTemplate } from "@/components/Tools/applyTemplate";
import { ToastContainer } from "../ui/toast";
import { TableNode } from "./Nodes/TableNode";
import { StickyNoteNode, editNoteOnMount } from "./Nodes/StickyNoteNode";
import { TableGroupNode } from "./Nodes/TableGroupNode";
import { PulseEdge } from "./Edges/PulseEdge";
import { CrowsFootEdge } from "./Edges/CrowsFootEdge";
import { DepEdge } from "./Edges/DepEdge";
import { HoverProvider } from "./HoverContext";
import { DisplayContext, DisplayState } from "./DisplayContext";
import { ToolHost } from "@/components/Tools/ToolHost";
import { useCanvasSync } from "@/hooks/useCanvasSync";
import { buildDisplayGraph, isGroupNodeId, groupNameFromId, moveGroupMembers } from "@/lib/model/displayGraph";
import { detectHubs, hubStructureKey } from "@/lib/model/hubs";
import { isTableNode } from "@/lib/model/canvasAdapter";
import { describeDeletion, describeGroupDeletion, removeElements } from "@/lib/model/deletion";
import { confirmAction } from "@/components/ui/confirm";
import { DELETE_REQUEST_EVENT, type DeleteRequest } from "./deleteRequest";
import { normalizeMeta } from "@/lib/model/types";
import { DEFAULT_LAYOUT, layoutNodes, type LayoutKind } from "@/lib/layout";
import { traceLineage, tablesWithDeps, newDependency } from "@/lib/model/lineage";
import { assignGroup, createGroup, gatherGroup, groupFrameAt, groupNameProblem, groupOf, listGroups, nextGroupColor, ungroupTables } from "@/lib/model/groups";
import { estimateNodeSize } from "@/lib/nodeSize";
import { SIDE_DRAWER_WIDTH, type DiagramOps, type DiagramSnap } from "./panels/DrawerShell";
import { SelectionBar } from "./SelectionBar";
  
import { DataTypesPanel } from "./DataTypesPanel";
import { CursorDotGrid } from "./CursorDotGrid";
import { type DetailsLevel } from "./CanvasToolbar";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { INSPECT_DRAWER_WIDTH, UnifiedSidebar } from "./UnifiedSidebar";
import { tableKeyOf } from "@/lib/model/types";
import { TableEditorModal } from "./Nodes/TableEditorModal";
import { SampleDataModal } from "./Nodes/SampleDataModal";
import dynamic from "next/dynamic";
import { SpotlightSearch } from "./SpotlightSearch";
import { ShortcutsModal } from "./ShortcutsModal";
import { OPEN_SHORTCUTS_EVENT } from "./shortcuts";
import { showToast } from "../ui/toast";
import { Eye, Loader2, Map as MapIcon, Minimize2, PenLine, RotateCcw } from 'lucide-react';
import { apiErrorMessage } from "@/lib/apiError";

function ago(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Canvas width below which the minimap no longer fits beside the bottom toolbar (~560px toolbar centred + 2 × (202px map + margins)). */
const MINIMAP_SIDE_BY_SIDE_MIN_W = 1080;
/** Canvas width below which the bottom toolbar (~600px) drops its text label to stay inside the canvas. */
const BOTTOM_BAR_COMPACT_BELOW_W = 660;
/** Bottom offset that clears the bottom toolbar (`bottom-5` + 50px tall = 70px) with a small 12px gap. */
const ABOVE_BOTTOM_BARS = 82;
/** React Flow's default minimap height, including its 1px border. */
const MINIMAP_H = 152;
/** localStorage key remembering whether the user keeps the minimap open (a per-browser preference, not diagram data). */
const MINIMAP_OPEN_KEY = 'designdb.minimapOpen';

// The SQL playground (CodeMirror SQL, sql.js runtime, schema tree, results grid) is its own chunk — nothing of it is
// downloaded until the playground is first opened.
// The audit drawer (and its checks) load the first time it opens; it stays mounted afterwards, keeping its results.
const AuditDrawer = dynamic(() => import("./AuditDrawer").then((m) => m.AuditDrawer), { ssr: false });
/** the audit drawer's width (its w-96) — the minimap and "Focus" keep clear of it */
const AUDIT_DRAWER_WIDTH = 384;
const VERSIONS_DRAWER_WIDTH = 384; // components/Tools/VersionsPanel: w-96
const SqlSandbox = dynamic(() => import("./SqlSandbox").then((m) => m.SqlSandbox), { ssr: false });
// the Groups and Lineage drawers load the first time they open
const GroupsDrawer = dynamic(() => import("./panels/GroupsDrawer").then((m) => m.GroupsDrawer), { ssr: false });
const LineageDrawer = dynamic(() => import("./panels/LineageDrawer").then((m) => m.LineageDrawer), { ssr: false });
/** the line being dragged in Draw dependency mode looks like the dashed amber arrow it will become */
const DEP_CONNECTION_LINE = { stroke: "#f59e0b", strokeWidth: 2, strokeDasharray: "7 5" };

const nodeTypes = {
  tableMode: TableNode,
  stickyNote: StickyNoteNode,
  tableGroup: TableGroupNode,
};

const edgeTypes = {
  pulseMode: PulseEdge,
  crowsFoot: CrowsFootEdge,
  depEdge: DepEdge,
};

// dockItems moved inside component to access state

// --- LAYOUT ENGINE (dagre / grid / radial live in @/lib/layout) ---
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction: LayoutKind = DEFAULT_LAYOUT) => {
  return { nodes: layoutNodes(nodes, edges, direction), edges };
};

export function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [generatedSql, setGeneratedSql] = useState<string>("");
  const [generatedMermaid, setGeneratedMermaid] = useState<string>("");
  const [aiInsightReport, setAiInsightReport] = useState<string>("");
  
  // Progress & Sync states
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isStaggering, setIsStaggering] = useState(false);
  
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const hasFetched = useRef(false);

  // Dock toggle states
  const [showUnifiedSidebar, setShowUnifiedSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"add" | "inspector" | "views">("add");
  const [activeEditingTableNodeId, setActiveEditingTableNodeId] = useState<string | "new" | null>(null);
  const [activeSampleDataNodeId, setActiveSampleDataNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showSqlSandbox, setShowSqlSandbox] = useState(false);
  const closeSqlSandbox = useCallback(() => setShowSqlSandbox(false), []);
  // The docked playground needs the canvas' full width (result grids are wide): opening it collapses the AI chat and the
  // code editor — remembering which were open, to slide them back out when it closes. Reopening either while the
  // playground is open hides the playground (temporarily) until that panel is closed again. Nothing is unmounted, so no
  // panel loses its conversation, text, cursor or results.
  const [sandboxSuspended, setSandboxSuspended] = useState(false);
  const sandboxCollapsedRef = useRef<{ ai: boolean; code: CodeWindowMode | null } | null>(null);
  const showSqlSandboxRef = useRef(showSqlSandbox);
  showSqlSandboxRef.current = showSqlSandbox;
  const sandboxSuspendedRef = useRef(sandboxSuspended);
  sandboxSuspendedRef.current = sandboxSuspended;
  // mounted on first open and kept mounted (hidden) afterwards, so the query, results and database survive closing it
  const [sqlSandboxMounted, setSqlSandboxMounted] = useState(false);
  useEffect(() => {
    if (showSqlSandbox) setSqlSandboxMounted(true);
  }, [showSqlSandbox]);
  const [sqlDialect, setSqlDialect] = useState("postgres");
  const [showDataTypes, setShowDataTypes] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<'LR' | 'TB'>('LR');
  const [edgeStyle, setEdgeStyle] = useState<'crowsFoot' | 'pulseMode'>('crowsFoot');
  const [isReviewsOpen, setIsReviewsOpen] = useState(false);
  // read by the layout-registered toggles (registered once, so they can't close over the state)
  const isReviewsOpenRef = useRef(isReviewsOpen);
  isReviewsOpenRef.current = isReviewsOpen;
  const [auditMounted, setAuditMounted] = useState(false);
  useEffect(() => {
    if (isReviewsOpen) setAuditMounted(true);
  }, [isReviewsOpen]);
  const [detailsLevel, setDetailsLevel] = useState<DetailsLevel>("all");

  // Grid state & Layout Context (the grid toggle lives in the layout context so the top navbar can drive it)
  const layout = useLayout();
  const showGrid = layout.showGrid;
  const setShowGrid = layout.setShowGrid;

  // Version history (rendered by ToolHost), Table groups and Data lineage (rendered below) are layout tools docked on the
  // right like Inspect and the audit. They take turns: opening one closes whichever was open.
  const versionsOpen = layout.activeTool?.id === "versions";
  const groupsOpen = layout.activeTool?.id === "groups";
  const lineageOpen = layout.activeTool?.id === "lineage";
  const toolDrawerOpen = versionsOpen || groupsOpen || lineageOpen;
  const rightDrawerWRef = useRef(0);
  const prevDrawersRef = useRef({ tool: toolDrawerOpen, inspect: false, audit: false });
  useEffect(() => {
    const prev = prevDrawersRef.current;
    prevDrawersRef.current = { tool: toolDrawerOpen, inspect: showUnifiedSidebar, audit: isReviewsOpen };
    if (!toolDrawerOpen) return;
    if (!prev.tool) {
      setShowUnifiedSidebar(false);
      setIsReviewsOpen(false);
    } else if ((showUnifiedSidebar && !prev.inspect) || (isReviewsOpen && !prev.audit)) {
      layout.closeTool();
    }
  }, [toolDrawerOpen, showUnifiedSidebar, isReviewsOpen, layout]);
  // Draw dependency (the Lineage drawer's mode): lines dragged on the canvas become Deps, not foreign keys. It ends with
  // the drawer.
  const [drawDeps, setDrawDeps] = useState(false);
  const drawDepsRef = useRef(drawDeps);
  drawDepsRef.current = drawDeps;
  useEffect(() => {
    if (!lineageOpen) setDrawDeps(false);
  }, [lineageOpen]);
  // a table dragged over another group's frame: that group (its frame lights up; dropping there adds the table to it)
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const dropGroupRef = useRef<string | null>(null);
  // the selection bar's "name the group" field (its Group button, or Ctrl+G)
  const [groupingOpen, setGroupingOpen] = useState(false);
  // the table toolbar's group picker (through DisplayContext; set once commitDiagram exists, further down)
  const setTableGroupRef = useRef<(tableId: string, group: string) => void>(() => undefined);
  const [lineageFocus, setLineageFocus] = useState<{ tableId: string; column?: string } | null>(null);



  // Spotlight Search & Shortcuts Modal
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Sidebar state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Onboarding tour state
  const [tourStep, setTourStep] = useState<number | null>(null);

  // Onboarding tour triggers
  const skipTour = () => {
    localStorage.setItem("designdb_tour_completed", "true");
    setTourStep(null);
  };

  const completeTour = () => {
    localStorage.setItem("designdb_tour_completed", "true");
    setTourStep(null);
  };

  useEffect(() => {
    const completed = localStorage.getItem("designdb_tour_completed");
    if (!completed) {
      setTimeout(() => setTourStep(1), 1000);
    }
  }, []);

  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  // Listen for open-table-editor events from TableNode toolbar
  useEffect(() => {
    const handleOpenEditor = (e: any) => {
      if (e.detail?.id) {
        setActiveEditingTableNodeId(e.detail.id);
      }
    };
    window.addEventListener("open-table-editor", handleOpenEditor);
    return () => window.removeEventListener("open-table-editor", handleOpenEditor);
  }, []);

  // The "···" buttons on the group popover and the relationship toolbar: select that object and open the Inspect drawer
  useEffect(() => {
    const handleOpenInspector = (e: any) => {
      const { nodeId, edgeId } = e.detail || {};
      if (nodeId) {
        setSelectedNodeId(nodeId);
        setSelectedEdgeId(null);
      } else if (edgeId) {
        setSelectedEdgeId(edgeId);
        setSelectedNodeId(null);
      }
      setShowSqlSandbox(false);
      setIsReviewsOpen(false);
      setSidebarTab("inspector");
      setShowUnifiedSidebar(true);
    };
    window.addEventListener("open-inspector", handleOpenInspector);
    return () => window.removeEventListener("open-inspector", handleOpenInspector);
  }, []);

  // Listen for open-sample-data-modal events from TableNode toolbar / comment
  useEffect(() => {
    const handleOpenSampleData = (e: any) => {
      if (e.detail?.id) {
        setActiveSampleDataNodeId(e.detail.id);
      }
    };
    window.addEventListener("open-sample-data-modal", handleOpenSampleData);
    return () => window.removeEventListener("open-sample-data-modal", handleOpenSampleData);
  }, []);







  // --- Global Keyboard Shortcuts (Ctrl+K, ?, Ctrl+S, Ctrl+I) ---
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        // the DBML and SQL editors are CodeMirror (contenteditable) — typing "?" there is text, not the cheat sheet
        !!(e.target as HTMLElement | null)?.isContentEditable ||
        !!(e.target as HTMLElement | null)?.closest?.(".cm-editor");

      // Ctrl+K / Cmd+K = Spotlight Search (always, even in inputs)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
        return;
      }

      // Skip remaining shortcuts when user is typing in form fields
      if (isInput) return;

      // Ctrl+G = group the selected tables (the selection bar's name field)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (layoutRef.current.previewVersion) return;
        if (nodesRef.current.some((n) => n.selected && isTableNode(n))) setGroupingOpen(true);
        else showToast("Select tables first (Ctrl+click, or Shift+drag a box), then press Ctrl+G", "validate");
        return;
      }

      // ? = Shortcuts Cheat Sheet
      if (e.key === "?") {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      }
      // (Ctrl+S = save diagram is handled by the top navbar)
      // Ctrl+I = Open DDL Import Panel
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        layoutRef.current.openTool("import");
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    // the Help menu's "All keyboard shortcuts…"
    const openSheet = () => setIsShortcutsOpen(true);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, openSheet);
    return () => {
      window.removeEventListener("keydown", handleGlobalShortcuts);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, openSheet);
    };
  }, []);

  // --- Spotlight Search: Select & Focus Node Handler ---
  const handleSelectNodeFromSearch = useCallback(
    (nodeId: string) => {
      setIsSearchOpen(false);
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setSidebarTab("inspector");
      setShowUnifiedSidebar(true);

      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode && rfInstance) {
        const width = targetNode.measured?.width || 240;
        const height = targetNode.measured?.height || 300;
        const x = targetNode.position.x + width / 2;
        const y = targetNode.position.y + height / 2;
        rfInstance.setCenter(x, y, { zoom: 1.1, duration: 800 });

        // Pulse highlight for 2.5 seconds
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, spotlightActive: true } }
              : n
          )
        );
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, spotlightActive: false } }
                : n
            )
          );
        }, 2500);
      }
    },
    [nodes, rfInstance, setNodes]
  );

  // --- Diagram Views: Focus & Highlight Node Handler ---
  const handleFocusNodeFromViews = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);

      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode && rfInstance) {
        const width = targetNode.measured?.width || 240;
        const height = targetNode.measured?.height || 300;
        const x = targetNode.position.x + width / 2;
        const y = targetNode.position.y + height / 2;
        rfInstance.setCenter(x, y, { zoom: 1.1, duration: 800 });

        // Pulse highlight for 2.5 seconds
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, spotlightActive: true } }
              : n
          )
        );
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, spotlightActive: false } }
                : n
            )
          );
        }, 2500);
      }
    },
    [nodes, rfInstance, setNodes]
  );

  useEffect(() => {
    if (layout.isSqlOpen) {
      setShowUnifiedSidebar(false);
      setIsReviewsOpen(false);
    }
  }, [layout.isSqlOpen]);

  // Keep stable refs for sidebar state to avoid stale closures in toggle handlers
  const showUnifiedSidebarRef = useRef<boolean>(showUnifiedSidebar);
  useEffect(() => { showUnifiedSidebarRef.current = showUnifiedSidebar; }, [showUnifiedSidebar]);
  const sidebarTabRef = useRef<"add" | "inspector" | "views">(sidebarTab);
  useEffect(() => { sidebarTabRef.current = sidebarTab; }, [sidebarTab]);
  // Refs for layout direction and edge style to prevent stale closures in registered handlers
  const layoutDirectionRef = useRef<'LR' | 'TB'>(layoutDirection);
  useEffect(() => { layoutDirectionRef.current = layoutDirection; }, [layoutDirection]);
  const edgeStyleRef = useRef<'crowsFoot' | 'pulseMode'>(edgeStyle);
  useEffect(() => { edgeStyleRef.current = edgeStyle; }, [edgeStyle]);
  const nodesRef = useRef<Node[]>(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  const edgesRef = useRef<Edge[]>(edges);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  useEffect(() => {
    if (layout && layout.registerRfInstance) {
      layout.registerRfInstance(rfInstance);
    }
    if (layout && layout.registerToggleUnifiedSidebar) {
      layout.registerToggleUnifiedSidebar((tab?: "add" | "inspector" | "views") => {
        if (tab === "add") {
          setShowUnifiedSidebar(false);
          setShowSqlSandbox(false);
          setIsReviewsOpen(false);
          layout.setSqlOpen(false);
          setActiveEditingTableNodeId("new");
          return;
        }
        // read current values from refs
        if (showUnifiedSidebarRef.current && tab === sidebarTabRef.current) {
          setShowUnifiedSidebar(false);
        } else {
          // ensure mutually exclusive panels
          setShowSqlSandbox(false);
          setIsReviewsOpen(false);
          layout.setSqlOpen(false);
          setShowUnifiedSidebar(true);
          if (tab) setSidebarTab(tab);
        }
      });
    }


    if (layout && layout.registerToggleSqlSandbox) {
      layout.registerToggleSqlSandbox(() => {
        // collapse the side panels the docked playground would be squeezed by, remembering them for later
        const collapseSidePanels = () => {
          const l = layoutRef.current;
          const ai = l.aiOpen;
          const code = l.codeWindowMode !== "collapsed" ? l.codeWindowMode : null;
          if (!ai && !code) return;
          const prev = sandboxCollapsedRef.current;
          sandboxCollapsedRef.current = { ai: ai || !!prev?.ai, code: code ?? prev?.code ?? null };
          if (ai) l.setAiOpen(false);
          if (code) l.setCodeWindowMode("collapsed");
        };
        if (showSqlSandboxRef.current && sandboxSuspendedRef.current) {
          // hidden behind a side panel — bring it back (and fold that panel away again)
          collapseSidePanels();
          setSandboxSuspended(false);
        } else if (!showSqlSandboxRef.current) {
          setShowUnifiedSidebar(false);
          setIsReviewsOpen(false);
          collapseSidePanels();
          setShowSqlSandbox(true);
        } else {
          setShowSqlSandbox(false);
        }
      });
    }
    
    if (layout && layout.registerToggleLayout) {
      layout.registerToggleLayout(() => {
        // Use refs to avoid stale closure
        const curDir = layoutDirectionRef.current;
        const newDir = curDir === 'LR' ? 'TB' : 'LR';
        setLayoutDirection(newDir);
        const curNodes = nodesRef.current;
        const curEdges = edgesRef.current;
        if (curNodes.length > 0) {
          const layouted = getLayoutedElements(curNodes, curEdges, newDir);
          setNodes(layouted.nodes);
          setEdges(layouted.edges);
          if (rfInstance) {
            setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
          }
          takeSnapshot();
        }
      });
    }
    if (layout && layout.registerToggleRelations) {
      layout.registerToggleRelations(() => {
        // Use refs to avoid stale closure
        const curStyle = edgeStyleRef.current;
        const newStyle = curStyle === 'crowsFoot' ? 'pulseMode' : 'crowsFoot';
        setEdgeStyle(newStyle);
        setEdges(eds => eds.map(e => ({ ...e, type: newStyle })));
        takeSnapshot();
      });
    }
    if (layout && layout.registerToggleAiInsights) {
      layout.registerToggleAiInsights(() => {
        const next = !isReviewsOpenRef.current;
        if (next) {
          setShowUnifiedSidebar(false);
          setShowSqlSandbox(false);
          layout.setSqlOpen(false);
        }
        setIsReviewsOpen(next);
      });
    }

    // Register apply handler for SQL panel
    if (layout && layout.registerApplySqlHandler) {
      layout.registerApplySqlHandler((parsed) => {
        try {
          // Convert parsed schema to nodes and edges and set state
          const rawNodes: Node[] = parsed.entities.map((entity: any, idx: number) => ({
            id: entity.name,
            type: 'tableMode',
            position: { x: 100 + idx * 60, y: 150 + idx * 50 },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            data: {
              label: entity.name,
              icon: 'server',
              attributes: entity.attributes.map((attr: any) => ({
                name: attr.name,
                type: attr.dataType,
                isPk: attr.isPrimaryKey,
                isFk: attr.isForeignKey,
              }))
            }
          }));

          const rawEdges: Edge[] = parsed.relationships.map((rel: any, index: number) => ({
            id: `e-sql-${index}-${Date.now()}`,
            source: rel.toEntity,
            target: rel.fromEntity,
            type: 'crowsFoot',
            data: { relationshipType: rel.type }
          }));

          const layouted = getLayoutedElements(rawNodes, rawEdges, layoutDirection === 'TB' ? 'TB' : DEFAULT_LAYOUT);
          setNodes(layouted.nodes);
          setEdges(layouted.edges);
          takeSnapshot();
          if (rfInstance) setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
        } catch (err) {
          console.error('Failed to apply parsed SQL schema', err);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, rfInstance]);

  // Undo/Redo Hook
  const { takeSnapshot, undo, redo, reset: resetHistory, canUndo, canRedo } = useUndoRedo(nodes, setNodes, edges, setEdges, layout.meta, layout.setMeta);

  // DBML ⇄ canvas sync, canvas API for tools, per-tab meta, version snapshots, copy/paste, share links
  const { createRelationship, loadGraph } = useCanvasSync({
    nodes,
    edges,
    setNodes,
    setEdges,
    takeSnapshot,
    resetHistory,
    rfInstance,
    sqlDialect,
    setSqlDialect,
    layoutDirection,
    edgeStyle,
    detailsLevel,
    generatedSql,
    generatedMermaid,
    setGeneratedSql,
  });

  // Saving: a save status in the top bar, Ctrl+S, autosave once a diagram has been saved (see useProjectSave)
  useProjectSave({ nodes, edges });

  // Close open panels with Escape key (sidebar, AI insights)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close any open overlay/panel
      if (showUnifiedSidebar) setShowUnifiedSidebar(false);
      if (isReviewsOpen) setIsReviewsOpen(false);
      // (the SQL playground handles Escape itself: full screen → docked panel → closed)
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showUnifiedSidebar, isReviewsOpen]);

  // Take initial snapshot on mount if nodes exist
  useEffect(() => {
    if (nodes.length > 0 && !hasFetched.current) {
      takeSnapshot();
    }
  }, [nodes.length, takeSnapshot]);

  // ─── Deleting — keyboard, trash buttons, the relationship toolbar, the Inspect drawer: every path confirms by name
  // ("You're deleting table customers. Are you sure?"), deletes (FK markings cleaned up) and records one undo step
  const takeSnapshotRef = useRef(takeSnapshot);
  takeSnapshotRef.current = takeSnapshot;
  const deleteWithConfirm = useCallback(
    async (req: DeleteRequest): Promise<boolean> => {
      const undoNote = "Ctrl+Z undoes it.";
      if (req.group) {
        const name = req.group;
        const count = nodesRef.current.filter((n) => isTableNode(n) && (n.data as any).group === name).length;
        if (!(await confirmAction({ ...describeGroupDeletion(name, count), note: undoNote, anchor: req.anchor }))) return false;
        const l = layoutRef.current;
        const meta = l.meta;
        const { [name]: _gone, ...groups } = meta.groups;
        const nextMeta = { ...meta, groups, views: meta.views.map((v) => ({ ...v, groups: v.groups.filter((g) => g !== name) })) };
        const cur = nodesRef.current;
        const nextNodes = cur.map((n) => (isTableNode(n) && (n.data as any).group === name ? { ...n, data: { ...n.data, group: "" } } : n));
        takeSnapshotRef.current({ nodes: cur, edges: edgesRef.current, meta });
        setNodes(nextNodes);
        l.setMeta(nextMeta);
        takeSnapshotRef.current({ nodes: nextNodes, edges: edgesRef.current, meta: nextMeta });
        return true;
      }
      const nodeIds = (req.nodeIds || []).filter((id) => !isGroupNodeId(id));
      const edgeIds = req.edgeIds || [];
      const summary = describeDeletion(nodesRef.current, edgesRef.current, nodeIds, edgeIds);
      if (!summary || !(await confirmAction({ ...summary, note: undoNote, anchor: req.anchor }))) return false;
      const cur = { nodes: nodesRef.current, edges: edgesRef.current };
      const next = removeElements(cur.nodes, cur.edges, nodeIds, edgeIds);
      takeSnapshotRef.current(cur); // a freshly opened diagram may have no undo step for the state being changed
      setNodes(next.nodes);
      setEdges(next.edges);
      takeSnapshotRef.current(next);
      setSelectedNodeId((s) => (s && nodeIds.includes(s) ? null : s));
      setSelectedEdgeId((s) => (s && !next.edges.some((e) => e.id === s) ? null : s));
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setNodes, setEdges]
  );
  useEffect(() => {
    const onRequest = (ev: Event) => {
      const req = (ev as CustomEvent<DeleteRequest>).detail || {};
      void deleteWithConfirm(req).then((ok) => req.onDone?.(ok));
    };
    window.addEventListener(DELETE_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(DELETE_REQUEST_EVENT, onRequest);
  }, [deleteWithConfirm]);
  // Delete / Backspace on the canvas: React Flow asks first — we confirm and delete ourselves, so it never does
  const onBeforeDelete = useCallback(
    async ({ nodes: gone, edges: goneEdges }: { nodes: Node[]; edges: Edge[] }) => {
      const real = new Set(edgesRef.current.map((e) => e.id)); // display edges re-routed onto a collapsed group aren't real
      await deleteWithConfirm({ nodeIds: gone.map((n) => n.id), edgeIds: goneEdges.map((e) => e.id).filter((id) => real.has(id)) });
      return false;
    },
    [deleteWithConfirm]
  );

  // the Inspect drawer's "Auto layout" buttons open the same chooser + confirmation as the bottom toolbar
  const handleAutoLayout = useCallback(() => requestAutoArrange(), []);

  const customOnNodesChange = useCallback(
    (incoming: any) => {
      let changes = incoming;
      // group frames / collapsed cards are display-only nodes: dragging one moves the tables inside it
      if (changes.some((c: any) => c.id && isGroupNodeId(c.id))) {
        for (const c of changes) {
          if (c.id && isGroupNodeId(c.id) && c.type === 'position' && c.position) {
            const frame = displayNodesRef.current.find((n) => n.id === c.id);
            if (frame) {
              const dx = c.position.x - frame.position.x;
              const dy = c.position.y - frame.position.y;
              if (dx || dy) setNodes((nds) => moveGroupMembers(nds, groupNameFromId(c.id), dx, dy));
            }
          }
        }
        changes = changes.filter((c: any) => !(c.id && isGroupNodeId(c.id)));
        if (!changes.length) return;
      }
      // (removals never arrive here: onBeforeDelete confirms and deletes them itself)
      onNodesChange(changes);
    },
    [onNodesChange, setNodes]
  );

  // Dragging column → column (or table → table) creates a real foreign-key relationship
  // …or, in Draw dependency mode, a Dep from where the drag started to where it ended (column to column when it began or
  // ended on a column). Loose mode hands the ends over swapped when the drag began on a left-hand handle.
  const connectStartRef = useRef<string | null>(null);
  const onConnect = useCallback((params: Connection) => {
    if (!drawDepsRef.current) {
      createRelationship(params);
      return;
    }
    let { source, target, sourceHandle, targetHandle } = params;
    if (connectStartRef.current && connectStartRef.current === target && source !== target) [source, target, sourceHandle, targetHandle] = [target, source, targetHandle, sourceHandle];
    const colOf = (h?: string | null) => (h && h.startsWith("c:") ? h.slice(2, h.lastIndexOf(":")) : "");
    const cur = { nodes: nodesRef.current, edges: edgesRef.current };
    const res = newDependency(cur.nodes, cur.edges, { from: source, fromColumn: colOf(sourceHandle), to: target, toColumn: colOf(targetHandle) });
    if ("error" in res) {
      showToast(res.error, "validate");
      return;
    }
    const nextEdges = [...cur.edges, res.edge];
    takeSnapshot(cur);
    setEdges(nextEdges);
    takeSnapshot({ nodes: cur.nodes, edges: nextEdges });
    const name = (id: string) => String((cur.nodes.find((n) => n.id === id)?.data as any)?.label ?? id);
    showToast(`Lineage added: ${name(source)} → ${name(target)}`, "success");
  }, [createRelationship, setEdges, takeSnapshot]);

  useEffect(() => {
    if (hasFetched.current) return;
    
    const prompt = sessionStorage.getItem("designdb_prompt");
    const directAction = sessionStorage.getItem("designdb_action");

    if (directAction === "import") {
      sessionStorage.removeItem("designdb_action");
      // open the Import dialog directly
      layoutRef.current.openTool("import");
    }

    if (prompt) {
      sessionStorage.removeItem("designdb_prompt");
      generateSchema(prompt);
    } else if (nodes.length === 0) {
      setGeneratedSql("-- DesignDB: No prompt provided. Type something on the home page!");
    }
    
    hasFetched.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Builds a diagram from the prompt typed on the home page. (Changing an existing diagram with AI happens in the AI panel,
  // where every change is reviewed as a diff first.)
  const generateSchema = async (prompt: string) => {
    setIsGenerating(true);
    setGenerationProgress(0);
    setNodes([]);
    setEdges([]);

    try {
      // Fake progress 0-50% while waiting for API
      const fetchInterval = setInterval(() => {
        setGenerationProgress(prev => (prev < 45 ? prev + 1 : prev));
      }, 100);

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      clearInterval(fetchInterval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(errorData, `Server error: ${response.status}`));
      }
      
      const data = await response.json();
      setGeneratedSql(data.sql); // Silently kept for quick export
      layout.setGeneratedSql(data.sql); // Push to SQL Code Workspace panel
      setGeneratedMermaid(data.mermaid || ""); // Keep mermaid for export
      setAiInsightReport(data.report || ""); // Save AI Insights report
      setGenerationProgress(50); // API is complete, start rendering graph

      // Construct un-layouted nodes with schema data
      const rawNodes: Node[] = data.schema.entities.map((entity: any) => ({
        id: entity.name,
        type: 'tableMode',
        position: { x: 0, y: 0 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          label: entity.name,
          icon: 'server',
          attributes: entity.attributes.map((attr: any) => ({
            name: attr.name,
            type: attr.dataType,
            isPk: attr.isPrimaryKey,
            isFk: data.schema.relationships.some((r: any) => r.fromEntity === entity.name && r.foreignKey === attr.name),
          }))
        }
      }));

      // Construct edges explicitly to flow from Parent (One) -> Child (Many) for the layout
      const rawEdges: Edge[] = data.schema.relationships.map((rel: any, index: number) => ({
        id: `e-${index}`,
        source: rel.toEntity,
        target: rel.fromEntity,
        type: 'crowsFoot',
        data: { relationshipType: rel.type },
      }));

      // Apply Horizontal DAG Layout Engine
      const layouted = getLayoutedElements(rawNodes, rawEdges);
      
      // If initial build, execute Staggered Sync Progress 50% -> 100%
      setIsStaggering(true);
      const totalElements = layouted.nodes.length + layouted.edges.length;
      let revealedNodes: Node[] = [];
      let revealedEdges: Edge[] = [];
      
      let nodeIdx = 0;
      let edgeIdx = 0;

      // Reveal 1 element every 150ms for a satisfying build effect
      const staggerInterval = setInterval(() => {
        let progressed = false;

        // Reveal Nodes first
        if (nodeIdx < layouted.nodes.length) {
          revealedNodes = [...revealedNodes, layouted.nodes[nodeIdx]];
          setNodes(revealedNodes);
          nodeIdx++;
          progressed = true;
        } 
        // Then reveal Edges
        else if (edgeIdx < layouted.edges.length) {
          revealedEdges = [...revealedEdges, layouted.edges[edgeIdx]];
          setEdges(revealedEdges);
          edgeIdx++;
          progressed = true;
        }

        // Sync Progress Bar
        const renderedCount = nodeIdx + edgeIdx;
        const progressChunk = Math.round(50 + ((renderedCount / totalElements) * 50));
        setGenerationProgress(Math.min(progressChunk, 100));

        // Dynamically fit view as the graph grows horizontally
        if (rfInstance) {
           rfInstance.fitView({ duration: 300, padding: 0.2 });
        }

        // Finish
        if (!progressed) {
          clearInterval(staggerInterval);
          setIsStaggering(false);
          setIsGenerating(false);
          takeSnapshot();
          
          if (rfInstance) {
            setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
          }
        }
      }, 150);

    } catch (error: any) {
      console.error('Failed to generate schema:', error);
      const errorMessage = error.message || "Please check your API key and try again.";
      setGeneratedSql(`-- Error generating schema: ${errorMessage}\n-- Check your terminal logs for details.`);
      showToast(`Couldn't generate the diagram. ${errorMessage}`, "error"); // e.g. "Too many requests. Try again in 2 min."
      setIsGenerating(false);
      setIsStaggering(false);
    }
  };

  const showProgressOverlay = isGenerating || isStaggering;

  const onLoadProject = (project: any) => {
    layoutRef.current.setCurrentProjectId(project.id);
    layoutRef.current.setProjectTitle(project.title);
    loadGraph({ nodes: project.nodesJson || [], edges: project.edgesJson || [], meta: project.meta }, { fit: true, reset: true, snapshot: true });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };
  // SQL playground ⇄ side panels (see sandboxSuspended above)
  const codePanelOpen = layout.codeWindowMode !== "collapsed";
  const sidePanelsRef = useRef({ ai: layout.aiOpen, code: codePanelOpen });
  useEffect(() => {
    const prev = sidePanelsRef.current;
    sidePanelsRef.current = { ai: layout.aiOpen, code: codePanelOpen };
    if (!showSqlSandbox) return;
    const reopened = (!prev.ai && layout.aiOpen) || (!prev.code && codePanelOpen);
    if (reopened && !sandboxSuspended) {
      // the user brought a side panel back: it wins the space, the playground waits (state intact)
      sandboxCollapsedRef.current = null;
      setSandboxSuspended(true);
    } else if (sandboxSuspended && !layout.aiOpen && !codePanelOpen) {
      setSandboxSuspended(false); // …and returns once the side panels are closed again
    }
  }, [layout.aiOpen, codePanelOpen, showSqlSandbox, sandboxSuspended]);
  const sandboxWasOpenRef = useRef(showSqlSandbox);
  useEffect(() => {
    const was = sandboxWasOpenRef.current;
    sandboxWasOpenRef.current = showSqlSandbox;
    if (!was || showSqlSandbox) return;
    // the playground closed (any way): slide back out whatever it had folded away
    setSandboxSuspended(false);
    const folded = sandboxCollapsedRef.current;
    sandboxCollapsedRef.current = null;
    if (folded?.ai) layoutRef.current.setAiOpen(true);
    if (folded?.code) layoutRef.current.setCodeWindowMode(folded.code);
  }, [showSqlSandbox]);
  const sqlPlaygroundState: "closed" | "open" | "hidden" = !showSqlSandbox ? "closed" : sandboxSuspended ? "hidden" : "open";

  // Opening a saved diagram (a dashboard card via ?project=, or the DesignDB menu's "My diagrams"): switch to its tab if it
  // is already open; otherwise load it into the current tab when that one is empty and never saved, or into a new tab —
  // never over the diagram you were working on.
  const onLoadProjectRef = useRef(onLoadProject);
  onLoadProjectRef.current = onLoadProject;
  const openProject = useCallback((project: any) => {
    const l = layoutRef.current;
    if (l.tabs.some((t) => t.id === project.id)) {
      if (l.activeTabId !== project.id) l.setActiveTabId(project.id);
      return;
    }
    const savedAt = Date.parse(project.updatedAt) || Date.now();
    if (!l.currentProjectId && nodesRef.current.length === 0) {
      onLoadProjectRef.current(project); // renames this tab to the project's id
      l.updateActiveTab({ savedSig: undefined, savedAt });
      return;
    }
    l.addTab(project.title, { nodes: project.nodesJson || [], edges: project.edgesJson || [], meta: normalizeMeta(project.meta), savedAt }, { id: project.id });
  }, []);
  useEffect(() => {
    const open = (e: Event) => {
      const project = (e as CustomEvent).detail?.project;
      if (project) openProject(project);
    };
    window.addEventListener("open-project", open);
    return () => window.removeEventListener("open-project", open);
  }, [openProject]);

  // Opening things in the editor — from the dashboard panel (a window event) or from a link carrying the same intent in
  // the URL (/canvas?project=<id> · ?template=<id> · ?new=blank|import|ai · ?dashboard=all|recent|templates). New
  // diagrams reuse the current tab when it is an empty, never-saved one; nothing ever replaces work in progress.
  const runIntent = useCallback(
    async (intent: EditorIntent) => {
      const l = layoutRef.current;
      if (intent.project || intent.projectId) {
        let project = intent.project;
        if (!project) {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(intent.projectId!)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.project) throw new Error(apiErrorMessage(data, "not found"));
            project = data.project;
          } catch {
            showToast("Couldn't open that diagram — it may have been deleted", "error");
            return;
          }
        }
        openProject(project);
        return;
      }
      const blank = !l.currentProjectId && nodesRef.current.length === 0 ? l.activeTabId : null;
      if (intent.template) {
        const { TEMPLATES } = await import("@/lib/templates");
        const t = TEMPLATES.find((x) => x.id === intent.template);
        if (!t) return;
        applyTemplate(layoutRef.current, t, "new");
        if (blank) layoutRef.current.closeTab(blank); // replaced, not left behind next to the sample
        return;
      }
      if (!blank) l.addTab("Untitled Schema");
      if (intent.new === "import") setTimeout(() => layoutRef.current.openTool("import"), 50);
      else if (intent.new === "ai") setTimeout(() => layoutRef.current.setAiOpen(true), 50);
    },
    [openProject]
  );
  useEffect(() => {
    const on = (e: Event) => void runIntent((e as CustomEvent<EditorIntent>).detail || {});
    window.addEventListener(EDITOR_INTENT_EVENT, on);
    return () => window.removeEventListener(EDITOR_INTENT_EVENT, on);
  }, [runIntent]);
  // …and from the URL, once; the URL is cleaned straight away so a reload doesn't repeat it
  const intentHandled = useRef(false);
  useEffect(() => {
    if (intentHandled.current) return; // (a ref, not an effect cleanup: survives React's dev-mode double mount)
    intentHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get("project");
    const kind = params.get("new");
    const template = params.get("template");
    const dashboard = params.get("dashboard");
    if (!projectId && !kind && !template && !dashboard) return;
    window.history.replaceState(null, "", "/canvas");
    setTimeout(() => {
      if (dashboard) layoutRef.current.openDashboard(dashboard === "recent" || dashboard === "templates" ? dashboard : "all");
      else if (projectId) void runIntent({ projectId });
      else if (template) void runIntent({ template });
      else void runIntent({ new: kind === "import" || kind === "ai" ? kind : "blank" });
    }, 0);
  }, [runIntent]);

  // ── Version History Live Preview ──
  const isPreviewMode = !!layout.previewVersion;
  const previewSnapshot = layout.previewVersion;

  const activeNodes = previewSnapshot ? previewSnapshot.nodes : nodes;
  const activeEdges = previewSnapshot ? previewSnapshot.edges : edges;
  const activeMeta = previewSnapshot ? previewSnapshot.meta : layout.meta;

  // ── hub tables (tenants, users …): detected from the structure only, so dragging a table does not redo it ──
  const hubKey = useMemo(() => hubStructureKey(activeNodes, activeEdges), [activeNodes, activeEdges]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hubs = useMemo(() => detectHubs(activeNodes, activeEdges), [hubKey]);
  const hubEdgesShown = normalizeMeta(activeMeta).showHubEdges;

  // ── display layer: views, hidden colours, table-group frames/collapse, hub connections, lineage tracing ──
  const display = useMemo(() => buildDisplayGraph(activeNodes, activeEdges, activeMeta, { hubs }), [activeNodes, activeEdges, activeMeta, hubs]);
  const displayNodesRef = useRef<Node[]>([]);
  displayNodesRef.current = display.nodes;

  // fit into the part of the canvas that's actually visible: under the preview banner, left of the version drawer
  const fitVisible = useCallback(
    (duration: number) =>
      rfInstance?.fitView({ duration, padding: { top: "84px", bottom: "72px", left: "40px", right: `${rightDrawerWRef.current + 40}px` } }),
    [rfInstance]
  );
  useEffect(() => {
    if (previewSnapshot && rfInstance) {
      const t = setTimeout(() => fitVisible(450), 50);
      return () => clearTimeout(t);
    }
  }, [previewSnapshot, rfInstance, fitVisible]);

  const prevPreviewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPreviewIdRef.current && !previewSnapshot && rfInstance) {
      fitVisible(350);
    }
    prevPreviewIdRef.current = previewSnapshot?.id || null;
  }, [previewSnapshot, rfInstance, fitVisible]);

  const handleRestorePreview = useCallback(() => {
    if (!previewSnapshot) return;
    const api = layout.getCanvasApi();
    if (api) {
      api.restoreGraph({
        nodes: previewSnapshot.nodes,
        edges: previewSnapshot.edges,
        meta: previewSnapshot.meta,
      });
    }
    const label = previewSnapshot.label;
    layout.setPreviewVersion(null);
    layout.closeTool();
    showToast(`Restored version “${label}”`, "success");
  }, [previewSnapshot, layout]);

  const handleCancelPreview = useCallback(() => {
    layout.setPreviewVersion(null);
    showToast("Reverted to current working state", "validate");
  }, [layout]);

  const lineageResult = useMemo(() => (lineageFocus ? traceLineage(activeEdges, lineageFocus) : null), [lineageFocus, activeEdges]);
  const lineageTables = useMemo(() => tablesWithDeps(activeNodes, activeEdges), [activeNodes, activeEdges]);
  const groupNames = useMemo(
    () => Array.from(new Set([...Object.keys(activeMeta.groups), ...activeNodes.filter(isTableNode).map((n) => String((n.data as any).group || "")).filter(Boolean)])).sort(),
    [activeNodes, activeMeta.groups]
  );
  const displayState: DisplayState = useMemo(
    () => ({
      readOnly: isPreviewMode,
      detailsLevel,
      lineage: lineageResult,
      lineageFocus,
      lineageTables,
      groupNames,
      onColumnClick: (tableId: string, column: string) => {
        if (isPreviewMode) return;
        setLineageFocus((cur) => (cur && cur.tableId === tableId && cur.column === column ? null : { tableId, column }));
      },
      clearLineage: () => setLineageFocus(null),
      onReveal: (tableId: string, column?: string) => {
        if (isPreviewMode) return;
        const n = nodesRef.current.find((x) => x.id === tableId);
        if (!n) return;
        const l = layoutRef.current;
        l.setSqlActiveTab("dbml");
        l.setSqlOpen(true);
        l.revealInEditor(String((n.data as any).label), column);
      },
      hubs,
      hubEdgesShown,
      onGoToTable: (tableId: string) => {
        // a hub badge: bring the hub table into view and flash it
        rfInstance?.fitView({ nodes: [{ id: tableId }], duration: 500, maxZoom: 1, padding: 0.6 });
        const flash = (on: boolean) => setNodes((nds) => nds.map((n) => (n.id === tableId && !!(n.data as any).spotlightActive !== on ? { ...n, data: { ...n.data, spotlightActive: on } } : n)));
        flash(true);
        setTimeout(() => flash(false), 2400);
      },
      dropGroup,
      onSetTableGroup: (tableId: string, group: string) => setTableGroupRef.current(tableId, group),
    }),
    [isPreviewMode, detailsLevel, lineageResult, lineageFocus, lineageTables, groupNames, hubs, hubEdgesShown, rfInstance, setNodes, dropGroup]
  );

  // ── minimap ──
  // Always a floating map button the user opens / minimises — whether or not the AI or code panel is open — and the choice
  // is remembered. Where it sits depends on room: bottom-right beside the toolbar when the canvas is wide enough, else
  // (AI panel, code panel or Inspect drawer eating the width) just *above* the toolbar.
  // a callback ref (element in state), so the observer follows the wrapper if it is ever re-mounted
  const [canvasAreaEl, setCanvasAreaEl] = useState<HTMLDivElement | null>(null);
  const [canvasAreaW, setCanvasAreaW] = useState(0);
  const rfInstanceRef = useRef(rfInstance);
  rfInstanceRef.current = rfInstance;
  const canvasAreaHRef = useRef(0);
  useEffect(() => {
    if (!canvasAreaEl) return;
    const box = canvasAreaEl.getBoundingClientRect();
    setCanvasAreaW(Math.round(box.width)); // right away — RO's first report waits for a paint
    canvasAreaHRef.current = Math.round(box.height);
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let dy = 0;
    const ro = new ResizeObserver(([entry]) => {
      // React Flow keeps the viewport pinned to the top-left when its box changes height, so the docked SQL playground
      // opening (or being resized) would push what you were looking at off the bottom — keep the visual centre instead
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      const prev = canvasAreaHRef.current;
      canvasAreaHRef.current = h;
      if (prev > 0 && h > 0) dy += (h - prev) / 2;
      // both are applied next frame: changing layout inside the observer callback (width drives minimap placement and the
      // compact toolbar; the viewport re-renders React Flow) makes browsers report a "ResizeObserver loop"
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setCanvasAreaW(w);
        const rf = rfInstanceRef.current;
        if (rf && dy) {
          const vp = rf.getViewport();
          rf.setViewport({ ...vp, y: vp.y + dy });
        }
        dy = 0;
      });
    });
    ro.observe(canvasAreaEl);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [canvasAreaEl]);
  // a right-hand drawer (Inspect, the audit or version history) covers part of the canvas: the minimap, "Focus" and
  // the version-preview banner keep clear of it
  const rightDrawerW = showUnifiedSidebar ? INSPECT_DRAWER_WIDTH : isReviewsOpen ? AUDIT_DRAWER_WIDTH : versionsOpen ? VERSIONS_DRAWER_WIDTH : toolDrawerOpen ? SIDE_DRAWER_WIDTH : 0;
  rightDrawerWRef.current = rightDrawerW;
  const freeCanvasW = canvasAreaW - rightDrawerW;
  const miniMapAboveBars = canvasAreaW > 0 && freeCanvasW < MINIMAP_SIDE_BY_SIDE_MIN_W;
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  useEffect(() => {
    // read after mount (not in useState's initialiser) so the server render and hydration agree
    try {
      if (localStorage.getItem(MINIMAP_OPEN_KEY) === '1') setMiniMapOpen(true);
    } catch {}
  }, []);
  const toggleMiniMap = useCallback((open: boolean) => {
    setMiniMapOpen(open);
    try {
      localStorage.setItem(MINIMAP_OPEN_KEY, open ? '1' : '0');
    } catch {}
  }, []);

  const miniMapPos = useMemo(() => {
    const right = rightDrawerW + (miniMapAboveBars ? 16 : 24); // clear the drawer too
    const bottom = miniMapAboveBars || rightDrawerW ? ABOVE_BOTTOM_BARS : 24;
    return { right, bottom };
  }, [rightDrawerW, miniMapAboveBars]);

  // The bottom toolbar's sticky note: in the middle of the visible canvas (left of any drawer), nudged down-right past
  // notes already there, selected and open for typing — one undo step
  const addStickyNote = useCallback(() => {
    const rf = rfInstance;
    const area = canvasAreaEl?.getBoundingClientRect();
    if (!rf || !area) return;
    const NOTE_W = 208;
    const NOTE_H = 110;
    const c = rf.screenToFlowPosition({ x: area.left + Math.max(240, area.width - rightDrawerW) / 2, y: area.top + area.height / 2 });
    const cur = nodesRef.current;
    let pos = { x: Math.round(c.x - NOTE_W / 2), y: Math.round(c.y - NOTE_H / 2) };
    while (cur.some((n) => n.type === "stickyNote" && Math.abs(n.position.x - pos.x) < 12 && Math.abs(n.position.y - pos.y) < 12)) pos = { x: pos.x + 24, y: pos.y + 24 };
    const id = `note_${Date.now().toString(36)}`;
    const count = cur.filter((n) => n.type === "stickyNote").length;
    const note: Node = { id, type: "stickyNote", position: pos, selected: true, data: { text: "", colorIndex: 0, name: `note_${count + 1}` } };
    const next = [...cur.map((n) => (n.selected ? { ...n, selected: false } : n)), note];
    editNoteOnMount(id);
    takeSnapshot({ nodes: cur, edges: edgesRef.current });
    setNodes(next);
    takeSnapshot({ nodes: next, edges: edgesRef.current });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  }, [rfInstance, canvasAreaEl, rightDrawerW, setNodes, takeSnapshot]);

  const closeAudit = useCallback(() => setIsReviewsOpen(false), []);
  // "Focus" on an audit finding: select the tables involved, flash them, and fit them into the visible part of the canvas
  // (the drawers' "show on the canvas" flashes without selecting, so the selection bar doesn't pop up)
  const focusNodeIds = useCallback(
    (wantedIds: string[], select = true) => {
      const rf = rfInstance;
      const area = canvasAreaEl?.getBoundingClientRect();
      const wanted = new Set(wantedIds);
      const targets = nodesRef.current.filter((n) => isTableNode(n) && wanted.has(n.id));
      if (!rf || !area || !targets.length) return;
      const ids = new Set(targets.map((n) => n.id));
      setNodes((nds) => nds.map((n) => ({ ...n, selected: select ? ids.has(n.id) : n.selected, data: ids.has(n.id) ? { ...n.data, spotlightActive: true } : n.data })));
      setTimeout(() => setNodes((nds) => nds.map((n) => (ids.has(n.id) && (n.data as any).spotlightActive ? { ...n, data: { ...n.data, spotlightActive: false } } : n))), 2400);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of targets) {
        const w = (n as any).measured?.width ?? 260;
        const h = (n as any).measured?.height ?? 200;
        minX = Math.min(minX, n.position.x);
        minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w);
        maxY = Math.max(maxY, n.position.y + h);
      }
      const visibleW = Math.max(240, area.width - rightDrawerW);
      const zoom = Math.max(0.2, Math.min(1.1, Math.min((visibleW * 0.8) / (maxX - minX), (area.height * 0.72) / (maxY - minY))));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      rf.setViewport({ x: visibleW / 2 - cx * zoom, y: area.height / 2 - cy * zoom, zoom }, { duration: 650 });
    },
    [rfInstance, canvasAreaEl, rightDrawerW, setNodes]
  );
  const focusTables = useCallback(
    (keys: string[]) => {
      const wanted = new Set(keys);
      focusNodeIds(nodesRef.current.filter((n) => isTableNode(n) && wanted.has(tableKeyOf({ schema: (n.data as any).schema, name: String((n.data as any).label) }))).map((n) => n.id));
    },
    [focusNodeIds]
  );

  // ── Table groups and Data lineage drawers, the selection bar: one commit per action = one undo step ──
  const commitDiagram = useCallback(
    (next: DiagramSnap) => {
      const l = layoutRef.current;
      const cur = { nodes: nodesRef.current, edges: edgesRef.current, meta: l.meta };
      takeSnapshotRef.current(cur); // a freshly opened diagram may have no undo step for the state being changed
      if (next.nodes) setNodes(next.nodes);
      if (next.edges) setEdges(next.edges);
      if (next.meta) l.setMeta(next.meta);
      takeSnapshotRef.current({ nodes: next.nodes ?? cur.nodes, edges: next.edges ?? cur.edges, meta: next.meta ?? cur.meta });
    },
    [setNodes, setEdges]
  );
  setTableGroupRef.current = (tableId, group) => {
    const cur = nodesRef.current;
    const meta = layoutRef.current.meta;
    if (!group) return commitDiagram({ nodes: ungroupTables(cur, [tableId]) });
    const nextMeta = meta.groups[group] ? meta : { ...meta, groups: { ...meta.groups, [group]: { color: nextGroupColor(cur, meta) } } };
    commitDiagram({ nodes: gatherGroup(assignGroup(cur, [tableId], group), nextMeta, group), meta: nextMeta });
  };
  const diagramOps: DiagramOps = useMemo(() => ({ nodes, edges, meta: layout.meta, commit: commitDiagram }), [nodes, edges, layout.meta, commitDiagram]);
  // the selected tables, as a list that only changes when the selection does (not on every drag frame)
  const selectedKey = nodes
    .filter((n) => n.selected && isTableNode(n))
    .map((n) => n.id)
    .join("\n");
  const selectedTableIds = useMemo(() => (selectedKey ? selectedKey.split("\n") : []), [selectedKey]);
  useEffect(() => {
    if (!selectedTableIds.length) setGroupingOpen(false);
  }, [selectedTableIds]);
  const groupChoices = useMemo(() => listGroups(nodes, layout.meta).map((g) => ({ name: g.name, color: g.color })), [nodes, layout.meta]);
  const clearSelection = useCallback(() => {
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setGroupingOpen(false);
  }, [setNodes]);
  const groupSelection = useCallback(
    (name: string): string | null => {
      const res = createGroup(nodesRef.current, layoutRef.current.meta, name, selectedTableIds);
      if (!res) return groupNameProblem(nodesRef.current, layoutRef.current.meta, name) || "Select at least one table";
      commitDiagram({ ...res, nodes: gatherGroup(res.nodes, res.meta, name.trim()) });
      setGroupingOpen(false);
      showToast(`Grouped ${selectedTableIds.length === 1 ? "1 table" : `${selectedTableIds.length} tables`} into “${name.trim()}”`, "success");
      return null;
    },
    [selectedTableIds, commitDiagram]
  );
  const addSelectionToGroup = useCallback(
    (name: string) => {
      commitDiagram({ nodes: gatherGroup(assignGroup(nodesRef.current, selectedTableIds, name), layoutRef.current.meta, name) });
      setGroupingOpen(false);
      showToast(`Added ${selectedTableIds.length === 1 ? "1 table" : `${selectedTableIds.length} tables`} to “${name}”`, "success");
    },
    [selectedTableIds, commitDiagram]
  );
  // trace a table's whole lineage from the Lineage drawer's map, and bring it into view
  const traceTable = useCallback(
    (tableId: string | null) => {
      setLineageFocus(tableId ? { tableId } : null);
      if (tableId) focusNodeIds([...traceLineage(edgesRef.current, { tableId }).columns.keys()], false);
    },
    [focusNodeIds]
  );
  const showEdge = useCallback(
    (edgeId: string) => {
      const e = edgesRef.current.find((x) => x.id === edgeId);
      if (!e) return;
      setEdges((eds) => eds.map((x) => (!!x.selected !== (x.id === edgeId) ? { ...x, selected: x.id === edgeId } : x)));
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      focusNodeIds([e.source, e.target], false);
    },
    [setEdges, focusNodeIds]
  );

  // Dropping a table onto another group's frame adds it to that group (the frame lights up while it's over it)
  const onNodeDrag = useCallback((_e: unknown, node: Node) => {
    let g: string | null = null;
    if (isTableNode(node)) {
      const size = node.measured?.width && node.measured?.height ? { width: node.measured.width, height: node.measured.height } : estimateNodeSize(node);
      g = groupFrameAt(displayNodesRef.current, { x: node.position.x + size.width / 2, y: node.position.y + size.height / 2 }, groupOf(node));
    }
    if (g !== dropGroupRef.current) {
      dropGroupRef.current = g;
      setDropGroup(g);
    }
  }, []);
  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node, dragged: Node[]) => {
      const g = dropGroupRef.current;
      dropGroupRef.current = null;
      setDropGroup(null);
      if (!g) {
        takeSnapshot();
        return;
      }
      const moved = dragged.length ? dragged : [node];
      const at = new Map(moved.map((n) => [n.id, n.position]));
      const ids = moved.filter(isTableNode).map((n) => n.id);
      // the dragged nodes carry their final positions — the ref may still be a frame behind
      const next = gatherGroup(assignGroup(nodesRef.current.map((n) => (at.has(n.id) ? { ...n, position: at.get(n.id)! } : n)), ids, g), layoutRef.current.meta, g);
      setNodes(next);
      takeSnapshot({ nodes: next });
      const label = String((moved[0].data as any)?.label ?? "");
      showToast(ids.length === 1 ? `Added “${label}” to “${g}”` : `Added ${ids.length} tables to “${g}”`, "success");
    },
    [setNodes, takeSnapshot]
  );

  const miniMapStyle = useMemo(() => {
    const rightOffset = miniMapPos.right;
    const bottomOffset = miniMapPos.bottom;

    return {
      background: '#0a0e1a',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      position: 'absolute' as const,
      right: `${rightOffset}px`,
      bottom: `${bottomOffset}px`,
      margin: '0',
      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    };
  }, [miniMapPos]);

  return (
    <div className="w-full h-full flex flex-col relative text-sm">
      {/* SVG Definitions for Crow's Foot Markers */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}>
        <defs>
          <marker id="crow-one" markerWidth="20" markerHeight="16" refX="10" refY="8" orient="auto-start-reverse">
            <path d="M 0 8 L 15 8 M 7 3 L 7 13 M 12 3 L 12 13" stroke="rgba(106, 95, 193, 0.8)" fill="none" strokeWidth="1.5" />
          </marker>
          <marker id="crow-many" markerWidth="20" markerHeight="16" refX="15" refY="8" orient="auto-start-reverse">
            <path d="M 0 8 L 15 8 M 5 8 L 15 3 M 5 8 L 15 13" stroke="rgba(106, 95, 193, 0.8)" fill="none" strokeWidth="1.5" />
          </marker>
        </defs>
      </svg>
      
        <div ref={setCanvasAreaEl} className="flex-1 min-h-0 h-full relative pt-0">
            <HoverProvider>
             <DisplayContext.Provider value={displayState}>
              <div className="absolute inset-0 z-0">
            {/* Animated dotted grid background */}
            {showGrid && <div className="animated-dot-grid" />}
            <div className="canvas-vignette" />
            {showGrid && <CursorDotGrid />}
            
            <ReactFlow
              nodes={display.nodes}
              edges={display.edges}
              onNodesChange={isPreviewMode ? undefined : customOnNodesChange}
              onEdgesChange={isPreviewMode ? undefined : onEdgesChange}
              onBeforeDelete={isPreviewMode ? async () => false : onBeforeDelete}
              deleteKeyCode={isPreviewMode || layout.dashboard ? null : ["Delete", "Backspace"]}
              onConnect={isPreviewMode ? undefined : onConnect}
              onConnectStart={isPreviewMode ? undefined : (_e, p) => { connectStartRef.current = p.nodeId ?? null; }}
              connectionLineStyle={drawDeps ? DEP_CONNECTION_LINE : undefined}
              connectionMode={ConnectionMode.Loose}
              minZoom={0.02}
              maxZoom={2.5}
              nodesDraggable={!isPreviewMode}
              nodesConnectable={!isPreviewMode}
              elementsSelectable={!isPreviewMode}
              onlyRenderVisibleElements={activeNodes.length > 60}
              zoomOnDoubleClick={false}
              onNodeDrag={isPreviewMode ? undefined : onNodeDrag}
              onNodeDragStop={isPreviewMode ? undefined : onNodeDragStop}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={setRfInstance}
              onNodeClick={(_event, node) => {
                if (isPreviewMode) return;
                // Selecting never opens/closes the Inspect panel by itself — it only decides what the panel
                // would show if it's already open. Groups and relationships get their own on-canvas quick
                // actions (TableGroupNode's popover, RelationEdge's), so nothing has to force the panel open.
                if (isGroupNodeId(node.id)) {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                  setSidebarTab("inspector");
                  return;
                }
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                if (node.type !== "tableMode") setSidebarTab("inspector");
              }}
              onNodeDoubleClick={(_event, node) => {
                if (isPreviewMode) return;
                if (isGroupNodeId(node.id)) return;
                if (node.type === "tableMode") {
                  // the table editor modal is the deep-edit destination for tables; step the panel aside
                  setShowUnifiedSidebar(false);
                  setActiveEditingTableNodeId(node.id);
                } else {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                  setSidebarTab("inspector");
                }
              }}
              onEdgeClick={(_event, edge) => {
                if (isPreviewMode) return;
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setSidebarTab("inspector");
              }}
              onPaneClick={() => {
                if (isPreviewMode) return;
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
                setLineageFocus(null);
              }}
              colorMode="dark"
            >
              {showGrid && <Background gap={24} size={1.2} variant={BackgroundVariant.Dots} color="rgba(255, 255, 255, 0.08)" />}
              


              {/* Left Side Floating Dock Panel removed per design request */}

              {/* Floating Bottom Toolbar for Canvas Navigation and Controls */}
              <CanvasBottomBar
                undo={undo}
                redo={redo}
                canUndo={canUndo}
                canRedo={canRedo}
                rfInstance={rfInstance}
                detailsLevel={detailsLevel}
                setDetailsLevel={setDetailsLevel}
                compact={canvasAreaW > 0 && freeCanvasW < BOTTOM_BAR_COMPACT_BELOW_W}
                rightInset={rightDrawerW}
                onAddNote={isPreviewMode ? undefined : addStickyNote}
                hubConnections={hubs.hubs.size ? { shown: hubEdgesShown, hidden: display.hiddenHubEdges, total: hubs.hubEdgeIds.size, names: [...hubs.hubs.values()].map((h) => h.label) } : undefined}
                sqlPlayground={sqlPlaygroundState}
                auditOpen={isReviewsOpen}
              />

              {/* MiniMap for canvas navigation — opened / minimised by the user via a floating button (see miniMapPos) */}
              {miniMapOpen && (
                <MiniMap
                  position="bottom-right"
                  style={miniMapStyle}
                  className="origin-bottom-right animate-in fade-in zoom-in-90 duration-150"
                  maskColor="rgba(0,0,0,0.6)"
                  nodeColor={(n: Node) => (n.type === "tableMode" ? String((n.data as any).color || "#4A90D9") : n.type === "stickyNote" ? "#fbbf24" : "transparent")}
                  pannable
                  zoomable
                />
              )}
              {!miniMapOpen && (
                <button
                  onClick={() => toggleMiniMap(true)}
                  aria-expanded={false}
                  aria-label="Show minimap"
                  title="Show minimap"
                  style={{ right: miniMapPos.right, bottom: miniMapPos.bottom }}
                  className="absolute z-10 w-10 h-10 rounded-xl flex items-center justify-center bg-[#090d16]/92 backdrop-blur-2xl border border-white/[0.1] text-white/70 hover:text-white hover:border-white/[0.2] shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-colors animate-in fade-in zoom-in-90 duration-150"
                >
                  <MapIcon size={17} />
                </button>
              )}
              {miniMapOpen && (
                <button
                  onClick={() => toggleMiniMap(false)}
                  aria-expanded
                  aria-label="Minimise minimap"
                  title="Minimise minimap"
                  style={{ right: miniMapPos.right + 6, bottom: miniMapPos.bottom + MINIMAP_H - 6 - 24 }}
                  className="absolute z-10 w-6 h-6 rounded-md flex items-center justify-center bg-[#090d16]/90 border border-white/[0.12] text-white/60 hover:text-white hover:bg-[#162033] transition-colors"
                >
                  <Minimize2 size={12} />
                </button>
              )}
            </ReactFlow>
      </div>
             </DisplayContext.Provider>
    </HoverProvider>

    {/* Sticky Floating Action Banner for Live Snapshot Preview */}
    {isPreviewMode && previewSnapshot && (
      // centred over the visible canvas (left of the version drawer), never wider than it; wraps its buttons onto a
      // second line rather than overflowing when the canvas is narrow (code panel / playground open)
      <div
        role="status"
        className="absolute top-4 z-40 -translate-x-1/2 w-max pointer-events-auto"
        style={canvasAreaW > 0 ? { left: freeCanvasW / 2, maxWidth: Math.max(240, freeCanvasW - 72) } : { left: "50%" }}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 pl-3.5 pr-2 py-2 rounded-xl bg-[#0d1322] border border-amber-500/40 shadow-[0_12px_36px_rgba(0,0,0,0.55)] text-white">
          <div className="flex items-center gap-2 min-w-0">
            <Eye size={14} className="shrink-0 text-amber-400" />
            <span className="shrink-0 text-[12px] font-semibold text-amber-300 whitespace-nowrap">Previewing</span>
            <span className="min-w-0 max-w-[260px] truncate text-[12.5px] font-semibold text-white" title={previewSnapshot.label}>
              {previewSnapshot.label}
            </span>
            <span className="shrink-0 text-[11.5px] text-white/45 whitespace-nowrap" title={new Date(previewSnapshot.createdAt).toLocaleString()}>
              {ago(previewSnapshot.createdAt)} · read-only
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleRestorePreview}
              className="h-8 px-3 flex items-center gap-1.5 rounded-lg bg-[#2563eb] hover:bg-[#3b82f6] text-white text-[12px] font-semibold whitespace-nowrap transition-colors"
            >
              <RotateCcw size={13} />
              Restore this version
            </button>
            <button
              onClick={handleCancelPreview}
              className="h-8 px-3 flex items-center rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/75 hover:text-white text-[12px] font-medium whitespace-nowrap transition-colors"
              title="Back to your current diagram"
            >
              Exit preview
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Draw dependency mode (Lineage drawer): what dragging a line does now */}
    {drawDeps && !isPreviewMode && (
      <div role="status" className="absolute top-4 z-30 -translate-x-1/2 w-max pointer-events-auto" style={canvasAreaW > 0 ? { left: freeCanvasW / 2, maxWidth: Math.max(240, freeCanvasW - 48) } : { left: "50%" }}>
        <div className="flex items-center gap-3 pl-3.5 pr-1.5 py-1.5 rounded-xl bg-[#1a1408] border border-amber-500/50 shadow-[0_12px_36px_rgba(0,0,0,0.55)]">
          <PenLine size={14} className="shrink-0 text-amber-300" />
          <span className="text-[12px] text-amber-100">Drawing dependencies: drag from the upstream table to the downstream one</span>
          <button onClick={() => setDrawDeps(false)} className="h-7 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[12px] font-semibold transition-colors">
            Done
          </button>
        </div>
      </div>
    )}

    {/* several tables selected: group them (Ctrl+G), add them to a group, or link two as a dependency */}
    {!isPreviewMode && (selectedTableIds.length >= 2 || (groupingOpen && selectedTableIds.length >= 1)) && (
      <SelectionBar
        labels={selectedTableIds.map((id) => String((nodes.find((n) => n.id === id)?.data as any)?.label ?? id))}
        groups={groupChoices}
        grouping={groupingOpen}
        setGrouping={setGroupingOpen}
        onCreateGroup={groupSelection}
        onAddToGroup={addSelectionToGroup}
        onLinkDependency={selectedTableIds.length === 2 ? () => layout.openTool("lineage", { from: selectedTableIds[0], to: selectedTableIds[1] }) : undefined}
        onClear={clearSelection}
        left={canvasAreaW > 0 ? freeCanvasW / 2 : "50%"}
        maxWidth={canvasAreaW > 0 ? Math.max(240, freeCanvasW - 48) : undefined}
        top={drawDeps ? 64 : 16}
      />
    )}
  </div>
        {/* AI Architecture Audit: docked to the right like the Inspect drawer (the two take turns) */}
        {auditMounted && <AuditDrawer open={isReviewsOpen} onClose={closeAudit} nodes={nodes} edges={edges} onFocus={focusTables} generationReport={aiInsightReport} />}

        {/* Table groups and Data lineage: docked on the right, opened from the tab row */}
        {groupsOpen && <GroupsDrawer ops={diagramOps} selectedTableIds={selectedTableIds} onFocusTables={(ids) => focusNodeIds(ids, false)} onClose={layout.closeTool} />}
        {lineageOpen && (
          <LineageDrawer
            ops={diagramOps}
            drawMode={drawDeps}
            setDrawMode={setDrawDeps}
            tracedTableId={lineageFocus?.tableId ?? null}
            lineage={lineageResult}
            onTrace={traceTable}
            onShowEdge={showEdge}
            prefill={layout.activeTool?.payload ?? null}
            onClose={layout.closeTool}
          />
        )}

        {showUnifiedSidebar && (
          <UnifiedSidebar
            nodes={nodes}
            setNodes={setNodes}
            edges={edges}
            setEdges={setEdges}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            setSelectedNodeId={setSelectedNodeId}
            setSelectedEdgeId={setSelectedEdgeId}
            showGrid={showGrid}
            setShowGrid={setShowGrid}
            onAutoLayout={handleAutoLayout}
            generatedSql={generatedSql}
            activeTab={sidebarTab}
            setActiveTab={setSidebarTab}
            onClose={() => setShowUnifiedSidebar(false)}
            sqlDialect={sqlDialect}
            setSqlDialect={setSqlDialect}
            takeSnapshot={takeSnapshot}
            onFocusNode={handleFocusNodeFromViews}
            onOpenTableEditor={(id) => {
              setShowUnifiedSidebar(false);
              setActiveEditingTableNodeId(id);
            }}
          />
        )}

        {/* SQL playground — docked under the canvas (in this flex column, so the canvas shrinks) or full screen */}
        {sqlSandboxMounted && <SqlSandbox nodes={nodes} edges={edges} isOpen={showSqlSandbox && !sandboxSuspended} onClose={closeSqlSandbox} />}

        {tourStep !== null && (
          <div className="absolute inset-0 z-50 pointer-events-none">
            <div className="absolute inset-0 bg-[#030712]/50 backdrop-blur-[2px] transition-all" />

            {tourStep === 1 && (
              <div className="absolute top-4 right-6 pointer-events-auto w-[320px] bg-[#090C15]/95 border border-[#4A90D9]/50 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#4A90D9] font-mono tracking-wider uppercase font-bold">Onboarding (Step 1/4)</span>
                  <button onClick={skipTour} className="text-white/65 hover:text-white text-xs">Skip</button>
                </div>
                <h4 className="text-sm font-semibold text-white">Build and edit with AI</h4>
                <p className="text-[11px] text-white/65 leading-relaxed font-medium">
                  Click <span className="font-semibold text-white/85">AI</span> in the top bar and describe what you need in plain language (e.g. &quot;Create a product inventory system&quot;). Every change is shown as a diff you accept or reject before it touches your diagram.
                </p>
                <div className="flex justify-end gap-2 mt-1">
                  <button 
                    onClick={() => {
                      setTourStep(2);
                      setShowUnifiedSidebar(true);
                      setSidebarTab("add");
                    }}
                    className="px-3.5 py-1.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {tourStep === 2 && (
              <div className="absolute top-28 right-[370px] pointer-events-auto w-[320px] bg-[#090C15]/95 border border-[#4A90D9]/50 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#4A90D9] font-mono tracking-wider uppercase font-bold">Onboarding (Step 2/4)</span>
                  <button onClick={skipTour} className="text-white/65 hover:text-white text-xs">Skip</button>
                </div>
                <h4 className="text-sm font-semibold text-white">Unified Sidebar Panel</h4>
                <p className="text-[11px] text-white/65 leading-relaxed font-medium">
                  Use the consolidated right sidebar to manually create custom tables field-by-field, inspect and modify selected tables or relationships, and view real-time SQL DDL script code.
                </p>
                <div className="flex justify-end gap-2 mt-1">
                  <button 
                    onClick={() => setTourStep(1)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-[11px] font-bold rounded-lg transition-all"
                  >
                    Back
                  </button>
                  <button 
                    onClick={() => setTourStep(3)}
                    className="px-3.5 py-1.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {tourStep === 3 && (
              <div className="absolute top-1/3 left-40 pointer-events-auto w-[320px] bg-[#090C15]/95 border border-[#4A90D9]/50 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#4A90D9] font-mono tracking-wider uppercase font-bold">Onboarding (Step 3/4)</span>
                  <button onClick={skipTour} className="text-white/65 hover:text-white text-xs">Skip</button>
                </div>
                <h4 className="text-sm font-semibold text-white">Interactive ERD Canvas</h4>
                <p className="text-[11px] text-white/65 leading-relaxed font-medium">
                  Drag connections between table handle nodes to relate attributes. Double-click any table to rename columns and change data types inline in the inspector.
                </p>
                <div className="flex justify-end gap-2 mt-1">
                  <button 
                    onClick={() => setTourStep(2)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-[11px] font-bold rounded-lg transition-all"
                  >
                    Back
                  </button>
                  <button 
                    onClick={() => setTourStep(4)}
                    className="px-3.5 py-1.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all"
                  >
                    Next Step
                  </button>
                </div>
              </div>
            )}

            {tourStep === 4 && (
              <div className="absolute top-20 right-6 pointer-events-auto w-[320px] bg-[#090C15]/95 border border-[#4A90D9]/50 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#4A90D9] font-mono tracking-wider uppercase font-bold">Onboarding (Step 4/4)</span>
                  <button onClick={skipTour} className="text-white/65 hover:text-white text-xs">Close</button>
                </div>
                <h4 className="text-sm font-semibold text-white">Export & Share Work</h4>
                <p className="text-[11px] text-white/65 leading-relaxed font-medium">
                  Click the &quot;Actions&quot; dropdown at the top-right to download your production-ready SQL scripts, Mermaid diagram code, or PNG image exports.
                </p>
                <div className="flex justify-end gap-2 mt-1">
                  <button 
                    onClick={() => setTourStep(3)}
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-[11px] font-bold rounded-lg transition-all"
                  >
                    Back
                  </button>
                  <button 
                    onClick={completeTour}
                    className="px-3.5 py-1.5 bg-lime-green text-[#030712] hover:bg-lime-green/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(194,239,78,0.25)]"
                  >
                    Complete Tour
                  </button>
                </div>
              </div>
            )}
          </div>
        )}



        {showDataTypes && (
          <DataTypesPanel onClose={() => setShowDataTypes(false)} />
        )}

        {showProgressOverlay && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/10 backdrop-blur-[1px] z-50 pointer-events-none">
            <div className="pointer-events-auto flex flex-col items-center gap-3 backdrop-blur-md bg-[#090C15]/90 px-8 py-5 rounded-2xl border border-sentry-purple/50 shadow-[0_24px_64px_rgba(0,0,0,0.8),0_0_40px_rgba(106,95,193,0.15)]">
              <div className="flex items-center gap-3 text-white">
                <Loader2 className="animate-spin text-sentry-purple" size={20} />
                <span className="text-sm tracking-widest uppercase font-semibold">
                   {isStaggering ? "Rendering Architecture" : "Synthesizing Schema"}
                </span>
              </div>
              {/* Progress Bar */}
              <div className="w-56 h-1.5 bg-white/10 rounded-full overflow-hidden mt-2 relative">
                <div 
                  className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-sentry-purple to-[#4a90d9] transition-all duration-300 ease-out"
                  style={{ width: `${generationProgress}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-white/50 tracking-wider">
                 {generationProgress}%
              </div>
            </div>
          </div>
        )}


        {/* Spotlight Search Modal */}
        <SpotlightSearch
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          nodes={nodes}
          onSelectNode={handleSelectNodeFromSearch}
        />

        {/* Keyboard Shortcuts Cheat Sheet */}
        <ShortcutsModal
          isOpen={isShortcutsOpen}
          onClose={() => setIsShortcutsOpen(false)}
        />

        {/* Table Editor Fullscreen Modal */}
        <TableEditorModal
          isOpen={activeEditingTableNodeId !== null}
          tableNodeId={activeEditingTableNodeId}
          nodes={nodes}
          setNodes={setNodes}
          edges={edges}
          setEdges={setEdges}
          onClose={() => setActiveEditingTableNodeId(null)}
          takeSnapshot={takeSnapshot}
        />

        {/* Sample Data Records Modal */}
        <SampleDataModal
          isOpen={activeSampleDataNodeId !== null}
          tableNodeId={activeSampleDataNodeId}
          nodes={nodes}
          onClose={() => setActiveSampleDataNodeId(null)}
          onOpenEditModal={(id) => setActiveEditingTableNodeId(id)}
        />

        <ToolHost />

        <ToastContainer />
      </div>
  );
}
