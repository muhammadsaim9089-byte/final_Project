"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
  Panel,
  ReactFlowInstance,
  Position,
  MiniMap
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { FloatingHeader } from "./FloatingHeader";
import { useLayout } from "@/components/Layout/LayoutContext";
import { ToastContainer } from "../ui/toast";
import { TableNode } from "./Nodes/TableNode";
import { StickyNoteNode } from "./Nodes/StickyNoteNode";
import { TableGroupNode } from "./Nodes/TableGroupNode";
import { PulseEdge } from "./Edges/PulseEdge";
import { CrowsFootEdge } from "./Edges/CrowsFootEdge";
import { HoverProvider } from "./HoverContext";
  
import { DataTypesPanel } from "./DataTypesPanel";
import { CursorDotGrid } from "./CursorDotGrid";
import { CanvasToolbar, type DetailsLevel } from "./CanvasToolbar";
import { validateCanvasSchema } from '@/lib/canvasValidation';
import { generateTables } from '@/lib/execution/export_sql';
import { Schema } from '@/lib/execution/utils/schema_validator';
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { UnifiedSidebar } from "./UnifiedSidebar";
import { SqlSandbox } from "./SqlSandbox";
import { Dashboard } from "./Dashboard";
import { SpotlightSearch } from "./SpotlightSearch";
import { ShortcutsModal } from "./ShortcutsModal";
import { showToast } from "../ui/toast";
import { Loader2, ArrowRight, Sparkles } from 'lucide-react';

const nodeTypes = {
  tableMode: TableNode,
  stickyNote: StickyNoteNode,
  tableGroup: TableGroupNode,
};

const edgeTypes = {
  pulseMode: PulseEdge,
  crowsFoot: CrowsFootEdge,
};

// dockItems moved inside component to access state

// --- DAGRE LAYOUT ENGINE ---
const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'LR') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  
  const isHorizontal = direction === 'LR' || direction === 'RL';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 80, ranksep: isHorizontal ? 350 : 200, align: 'UL' });

  nodes.forEach((node) => {
    const attrsCount = node.data?.attributes ? (node.data.attributes as any[]).length : 0;
    const nodeHeight = 60 + (attrsCount * 36); 
    dagreGraph.setNode(node.id, { width: 340, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: nodeWithPosition.x - 340 / 2,
        y: nodeWithPosition.y - nodeWithPosition.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

const serializeCanvasToSchema = (nodes: Node[], edges: Edge[]): Schema => {
  const entities = nodes.map(node => {
    const attributes = ((node.data.attributes as any[]) || []).map(attr => ({
      name: attr.name,
      dataType: attr.type || 'varchar(255)',
      isPrimaryKey: !!attr.isPk,
      isNullable: !attr.isPk && !attr.required,
      isUnique: !!attr.unique,
      defaultValue: attr.defaultValue || null,
    }));
    
    return {
      name: node.data.label as string,
      attributes,
      seedData: (node.data.seedData as any[]) || [],
    };
  });

  const relationships = edges.map(edge => {
    const fromNode = nodes.find(n => n.id === edge.target); // child
    const toNode = nodes.find(n => n.id === edge.source); // parent
    if (!fromNode || !toNode) return null;
    
    return {
      fromEntity: fromNode.data.label as string,
      toEntity: toNode.data.label as string,
      type: (edge.data?.relationshipType as any) || 'many-to-one',
      foreignKey: (edge.data?.targetColumn as string) || (edge.data?.targetField as string) || '',
      referencedKey: (edge.data?.sourceColumn as string) || (edge.data?.sourceField as string) || 'id',
      onDelete: (edge.data?.onDelete as any) || 'NO ACTION',
      onUpdate: (edge.data?.onUpdate as any) || 'CASCADE',
    };
  }).filter(Boolean) as any[];

  return { entities, relationships };
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
  
  // Logic tracking states
  const [rawSchemaContext, setRawSchemaContext] = useState<any>(null);
  
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const hasFetched = useRef(false);

  // Dock toggle states
  const [showUnifiedSidebar, setShowUnifiedSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"add" | "inspector" | "sql">("add");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [showSqlSandbox, setShowSqlSandbox] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("Untitled Schema");
  const [sqlDialect, setSqlDialect] = useState("postgres");
  const [showDataTypes, setShowDataTypes] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<'LR' | 'TB'>('LR');
  const [edgeStyle, setEdgeStyle] = useState<'crowsFoot' | 'pulseMode'>('crowsFoot');
  const [isReviewsOpen, setIsReviewsOpen] = useState(false);
  const [detailsLevel, setDetailsLevel] = useState<DetailsLevel>("all");

  // Normalization Audit & Wizard States
  const [auditSteps, setAuditSteps] = useState<string[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState<number>(-1);
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditTab, setAuditTab] = useState<"log" | "wizard">("log");

  const runAudit = async () => {
    setIsAuditing(true);
    try {
      const currentSchema = serializeCanvasToSchema(nodes, edges);
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: currentSchema, strictMode: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to run audit");
      
      const reportText = data.report || "";
      setAiInsightReport(reportText);

      const steps: string[] = [];
      reportText.split("\n").forEach((line: string) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("- [1NF]") || trimmed.startsWith("- [2NF]") || trimmed.startsWith("- [3NF]")) {
          steps.push(trimmed.substring(2)); // Strip "- "
        }
      });

      setAuditSteps(steps);
      if (steps.length > 0) {
        setCurrentStepIdx(0);
        setAuditTab("wizard");
        showToast(`Audit complete: Found ${steps.length} normalization recommendation(s).`, "validate");
      } else {
        setCurrentStepIdx(-1);
        setAuditTab("log");
        showToast("Your schema is already fully normalized (3NF compliant)! ✨", "success");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to audit schema", "error");
    } finally {
      setIsAuditing(false);
    }
  };

  const getTableFromStep = (stepText: string): string | null => {
    const pkMatch = stepText.match(/into '(\w+)'/);
    if (pkMatch) return pkMatch[1];

    const repeatingMatch = stepText.match(/from '(\w+)'/);
    if (repeatingMatch) return repeatingMatch[1];

    const partialMatch = stepText.match(/from '(\w+)'/);
    if (partialMatch) return partialMatch[1];

    const transitiveMatch = stepText.match(/from '(\w+)'/);
    if (transitiveMatch) return transitiveMatch[1];

    const strictMatch = stepText.match(/moved \[(.*?)\] into '(\w+)'/);
    if (strictMatch) {
      const cols = strictMatch[1].split(',').map(c => c.trim());
      const sourceNode = nodes.find(n => 
        (n.data.attributes as any[])?.some(a => cols.includes(a.name))
      );
      if (sourceNode) return sourceNode.data.label as string;
    }

    return null;
  };

  const highlightTableOnCanvas = (tableName: string) => {
    if (!rfInstance) return;
    const targetNode = nodes.find(n => n.data.label === tableName);
    if (targetNode) {
      setNodes(nds => nds.map(n => ({
        ...n,
        selected: n.id === targetNode.id
      })));
      rfInstance.fitView({
        nodes: [targetNode],
        duration: 800,
        padding: 1.5
      });
      showToast(`Highlighted table: ${tableName}`, "success");
    } else {
      showToast(`Table ${tableName} not found on canvas`, "error");
    }
  };

  const executeNormalizationStep = (stepText: string) => {
    let newNodes = [...nodes];
    const newEdges = [...edges];
    
    // 1. Missing PK
    const pkMatch = stepText.match(/Injected missing primary key '(\w+)' into '(\w+)'/);
    if (pkMatch) {
      const [_, pkName, tableName] = pkMatch;
      newNodes = newNodes.map(n => {
        if (n.data.label === tableName) {
          const attrs = [...(n.data.attributes as any[])];
          attrs.unshift({ name: pkName, type: 'INTEGER', isPk: true });
          return { ...n, data: { ...n.data, attributes: attrs } };
        }
        return n;
      });
    }

    // 2. Repeating group
    const repeatingMatch = stepText.match(/Extracted repeating group '(\w+)' from '(\w+)' into new entity '(\w+)'/);
    if (repeatingMatch) {
      const [_, attrName, tableName, newTableName] = repeatingMatch;
      newNodes = newNodes.map(n => {
        if (n.data.label === tableName) {
          const attrs = ((n.data.attributes as any[]) || []).filter(a => a.name !== attrName);
          return { ...n, data: { ...n.data, attributes: attrs } };
        }
        return n;
      });
      const originalNode = nodes.find(n => n.data.label === tableName);
      const originalPk = (originalNode?.data as any)?.attributes?.find((a: any) => a.isPk)?.name || `${tableName}_id`;
      const originalPkType = (originalNode?.data as any)?.attributes?.find((a: any) => a.isPk)?.type || 'INTEGER';

      newNodes.push({
        id: newTableName,
        type: 'tableMode',
        position: { x: 200, y: 200 },
        data: {
          label: newTableName,
          icon: 'server',
          attributes: [
            { name: `${newTableName}_id`, type: 'INTEGER', isPk: true },
            { name: originalPk, type: originalPkType, isFk: true },
            { name: 'value', type: 'VARCHAR(255)' }
          ]
        }
      });
      
      newEdges.push({
        id: `e-${Date.now()}`,
        source: tableName,
        target: newTableName,
        type: edgeStyle || 'crowsFoot',
        data: {
          sourceColumn: originalPk,
          targetColumn: originalPk,
          relationshipType: 'many-to-one'
        }
      });
    }

    // 3. 2NF Partial Dependency
    const partialMatch = stepText.match(/moved \[(.*?)\] from '(\w+)' into new table '(\w+)' \(dependent on '(\w+)'\)/);
    if (partialMatch) {
      const [_, colListStr, tableName, newTableName, pkColName] = partialMatch;
      const colsToMove = colListStr.split(',').map(c => c.trim());
      
      const originalNode = nodes.find(n => n.data.label === tableName);
      const pkType = (originalNode?.data as any)?.attributes?.find((a: any) => a.name === pkColName)?.type || 'INTEGER';

      newNodes = newNodes.map(n => {
        if (n.data.label === tableName) {
          const attrs = ((n.data.attributes as any[]) || []).filter(a => !colsToMove.includes(a.name));
          const hasFk = attrs.find(a => a.name === pkColName);
          if (hasFk) {
            hasFk.isFk = true;
          } else {
            attrs.push({ name: pkColName, type: pkType, isFk: true });
          }
          return { ...n, data: { ...n.data, attributes: attrs } };
        }
        return n;
      });

      newNodes.push({
        id: newTableName,
        type: 'tableMode',
        position: { x: 250, y: 250 },
        data: {
          label: newTableName,
          icon: 'server',
          attributes: [
            { name: pkColName, type: pkType, isPk: true },
            ...colsToMove.map(c => {
              const originalAttr = (originalNode?.data as any)?.attributes?.find((a: any) => a.name === c);
              return { name: c, type: originalAttr?.type || 'VARCHAR(255)' };
            })
          ]
        }
      });

      newEdges.push({
        id: `e-${Date.now()}`,
        source: newTableName,
        target: tableName,
        type: edgeStyle || 'crowsFoot',
        data: {
          sourceColumn: pkColName,
          targetColumn: pkColName,
          relationshipType: 'many-to-one'
        }
      });
    }

    // 4. 3NF Transitive Dependency
    const transitiveMatch = stepText.match(/Extracted transitive dependency: '(\w+)' → \[(.*?)\] from '(\w+)' into '(\w+)'/);
    if (transitiveMatch) {
      const [_, determinantName, colListStr, tableName, newTableName] = transitiveMatch;
      const colsToMove = colListStr.split(',').map(c => c.trim());
      
      const originalNode = nodes.find(n => n.data.label === tableName);
      const detType = (originalNode?.data as any)?.attributes?.find((a: any) => a.name === determinantName)?.type || 'VARCHAR(255)';

      newNodes = newNodes.map(n => {
        if (n.data.label === tableName) {
          const attrs = ((n.data.attributes as any[]) || []).filter(a => !colsToMove.includes(a.name));
          const detAttr = attrs.find(a => a.name === determinantName);
          if (detAttr) detAttr.isFk = true;
          return { ...n, data: { ...n.data, attributes: attrs } };
        }
        return n;
      });

      newNodes.push({
        id: newTableName,
        type: 'tableMode',
        position: { x: 300, y: 300 },
        data: {
          label: newTableName,
          icon: 'server',
          attributes: [
            { name: determinantName, type: detType, isPk: true },
            ...colsToMove.map(c => {
              const originalAttr = (originalNode?.data as any)?.attributes?.find((a: any) => a.name === c);
              return { name: c, type: originalAttr?.type || 'VARCHAR(255)' };
            })
          ]
        }
      });

      newEdges.push({
        id: `e-${Date.now()}`,
        source: newTableName,
        target: tableName,
        type: edgeStyle || 'crowsFoot',
        data: {
          sourceColumn: determinantName,
          targetColumn: determinantName,
          relationshipType: 'many-to-one'
        }
      });
    }

    // 5. 3NF strict
    const strictMatch = stepText.match(/Extracted prefix cluster '(\w+)_{1,2}\*': moved \[(.*?)\] into '(\w+)'/);
    if (strictMatch) {
      const [_, prefix, colListStr, newTableName] = strictMatch;
      const colsToMove = colListStr.split(',').map(c => c.trim());
      
      const sourceNode = nodes.find(n => 
        ((n.data as any).attributes as any[])?.some(a => colsToMove.includes(a.name))
      );
      
      if (sourceNode) {
        const tableName = sourceNode.data.label as string;
        const determinantName = `${prefix}_id`;
        const detType = 'INTEGER';

        newNodes = newNodes.map(n => {
          if (n.data.label === tableName) {
            const attrs = ((n.data.attributes as any[]) || []).filter(a => !colsToMove.includes(a.name));
            const hasDet = attrs.find(a => a.name === determinantName);
            if (hasDet) {
              hasDet.isFk = true;
            } else {
              attrs.push({ name: determinantName, type: detType, isFk: true });
            }
            return { ...n, data: { ...n.data, attributes: attrs } };
          }
          return n;
        });

        newNodes.push({
          id: newTableName,
          type: 'tableMode',
          position: { x: 320, y: 320 },
          data: {
            label: newTableName,
            icon: 'server',
            attributes: [
              { name: determinantName, type: detType, isPk: true },
              ...colsToMove.map(c => {
                const originalAttr = (sourceNode?.data as any)?.attributes?.find((a: any) => a.name === c);
                return { name: c, type: originalAttr?.type || 'VARCHAR(255)' };
              })
            ]
          }
        });

        newEdges.push({
          id: `e-${Date.now()}`,
          source: newTableName,
          target: tableName,
          type: edgeStyle || 'crowsFoot',
          data: {
            sourceColumn: determinantName,
            targetColumn: determinantName,
            relationshipType: 'many-to-one'
          }
        });
      }
    }

    const layouted = getLayoutedElements(newNodes, newEdges, layoutDirection);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
    takeSnapshot();

    setTimeout(() => {
      if (rfInstance) {
        rfInstance.fitView({ duration: 800, padding: 0.12 });
      }
    }, 100);

    setCurrentStepIdx(prev => prev + 1);
    showToast("Decomposed table and updated canvas schema successfully!", "success");
  };


  // Spotlight Search & Shortcuts Modal
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Schema Diffing State
  const [pendingDiff, setPendingDiff] = useState<{
    newNodes: Node[];
    newEdges: Edge[];
    oldNodes: Node[];
    oldEdges: Edge[];
    diffMap: Record<string, 'added' | 'modified' | 'deleted'>;
  } | null>(null);

  // Sidebar state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);

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

  const layout = useLayout();
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);

  // Synchronize generated SQL in real-time on local state edits
  useEffect(() => {
    if (nodes.length === 0) return;
    try {
      const schema = serializeCanvasToSchema(nodes, edges);
      const sql = generateTables(schema, sqlDialect as any);
      setGeneratedSql(sql);
      layoutRef.current.setGeneratedSql(sql);
    } catch (e) {
      console.warn("Failed to generate SQL locally:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, sqlDialect]);

  // Propagate global details level to all table nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "tableMode") return n;
        if (n.data.globalDetailsLevel === detailsLevel) return n;
        return { ...n, data: { ...n.data, globalDetailsLevel: detailsLevel } };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsLevel]);







  // --- Global Keyboard Shortcuts (Ctrl+K, ?, Ctrl+S, Ctrl+I) ---
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;

      // Ctrl+K / Cmd+K = Spotlight Search (always, even in inputs)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
        return;
      }

      // Skip remaining shortcuts when user is typing in form fields
      if (isInput) return;

      // ? = Shortcuts Cheat Sheet
      if (e.key === "?") {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      }
      // Ctrl+S = Copy SQL DDL
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const sql = layoutRef.current.generatedSql;
        if (sql) {
          navigator.clipboard.writeText(sql);
          showToast("SQL DDL copied to clipboard", "success");
        } else {
          showToast("No SQL generated yet", "error");
        }
      }
      // Ctrl+I = Open DDL Import Panel
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        layoutRef.current.setSqlActiveTab("import");
        layoutRef.current.setSqlOpen(true);
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
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

  useEffect(() => {
    if (layout.isSqlOpen) {
      setShowSqlSandbox(false);
      setShowUnifiedSidebar(false);
      setShowDashboard(false);
      setIsReviewsOpen(false);
    }
  }, [layout.isSqlOpen]);

  // Keep stable refs for sidebar state to avoid stale closures in toggle handlers
  const showUnifiedSidebarRef = useRef<boolean>(showUnifiedSidebar);
  useEffect(() => { showUnifiedSidebarRef.current = showUnifiedSidebar; }, [showUnifiedSidebar]);
  const sidebarTabRef = useRef<"add" | "inspector" | "sql">(sidebarTab);
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
      layout.registerToggleUnifiedSidebar((tab?: "add" | "inspector") => {
        // read current values from refs
        if (showUnifiedSidebarRef.current && tab === sidebarTabRef.current) {
          setShowUnifiedSidebar(false);
        } else {
          // ensure mutually exclusive panels
          setShowSqlSandbox(false);
          setIsReviewsOpen(false);
          setShowDashboard(false);
          layout.setSqlOpen(false);
          setShowUnifiedSidebar(true);
          if (tab) setSidebarTab(tab);
        }
      });
    }

    if (layout && layout.registerToggleDashboard) {
      layout.registerToggleDashboard(() => {
        setShowDashboard(s => {
          const next = !s;
          if (next) {
            // close others
            setShowUnifiedSidebar(false);
            setShowSqlSandbox(false);
            setIsReviewsOpen(false);
            layout.setSqlOpen(false);
          }
          return next;
        });
      });
    }

    if (layout && layout.registerToggleSqlSandbox) {
      layout.registerToggleSqlSandbox(() => {
        setShowSqlSandbox(s => {
          const next = !s;
          if (next) {
            setShowUnifiedSidebar(false);
            setShowDashboard(false);
            setIsReviewsOpen(false);
            layout.setSqlOpen(false);
          }
          return next;
        });
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
        setIsReviewsOpen(s => {
          const next = !s;
          if (next) {
            setShowUnifiedSidebar(false);
            setShowSqlSandbox(false);
            setShowDashboard(false);
            layout.setSqlOpen(false);
          }
          return next;
        });
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

          const layouted = getLayoutedElements(rawNodes, rawEdges, layoutDirection);
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

  // Chatbox state
  const [chatPrompt, setChatPrompt] = useState("");
  const [isChatFocused, setIsChatFocused] = useState(false);

  // Deletion confirmation state
  const [nodesToDelete, setNodesToDelete] = useState<string[] | null>(null);

  // Undo/Redo Hook
  const { takeSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo(nodes, setNodes, edges, setEdges);

  // Close open panels with Escape key (projects/dashboard, sidebar, SQL sandbox, AI insights)
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close any open overlay/panel
      if (showDashboard) setShowDashboard(false);
      if (showUnifiedSidebar) setShowUnifiedSidebar(false);
      if (showSqlSandbox) setShowSqlSandbox(false);
      if (isReviewsOpen) setIsReviewsOpen(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showDashboard, showUnifiedSidebar, showSqlSandbox, isReviewsOpen]);

  // Take initial snapshot on mount if nodes exist
  useEffect(() => {
    if (nodes.length > 0 && !hasFetched.current) {
      takeSnapshot();
    }
  }, [nodes.length, takeSnapshot]);

  // Global Keyboard shortcuts for confirmation modal
  useEffect(() => {
    if (!nodesToDelete) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setNodesToDelete(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesToDelete]);

  const handleAutoLayout = useCallback(() => {
    if (nodes.length > 0) {
      const layouted = getLayoutedElements(nodes, edges, layoutDirection);
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
      if (rfInstance) setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
      takeSnapshot();
    }
  }, [nodes, edges, layoutDirection, rfInstance, setNodes, setEdges, takeSnapshot]);

  const customOnNodesChange = useCallback(
    (changes: any) => {
      const removals = changes.filter((c: any) => c.type === 'remove');
      if (removals.length > 0) {
        setNodesToDelete(removals.map((r: any) => r.id));
        const otherChanges = changes.filter((c: any) => c.type !== 'remove');
        if (otherChanges.length > 0) {
          onNodesChange(otherChanges);
          takeSnapshot();
        }
      } else {
        onNodesChange(changes);
      }
    },
    [onNodesChange, takeSnapshot]
  );

  const requestDeleteNode = useCallback((id: string) => {
    setNodesToDelete([id]);
  }, []);

  const confirmDelete = () => {
    if (nodesToDelete) {
      takeSnapshot(); // Snapshot before delete
      setNodes((nds) => nds.filter((n) => !nodesToDelete.includes(n.id)));
      setEdges((eds) => eds.filter((e) => !nodesToDelete.includes(e.source) && !nodesToDelete.includes(e.target)));
      
      // Clear selection if the deleted node was selected
      if (selectedNodeId && nodesToDelete.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }
      
      setNodesToDelete(null);
    }
  };

  const cancelDelete = () => {
    setNodesToDelete(null);
  };

  const onConnect = useCallback((params: Edge | Connection) => {
    takeSnapshot();
    setEdges((eds) => addEdge(params, eds));
  }, [setEdges, takeSnapshot]);

  useEffect(() => {
    if (hasFetched.current) return;
    
    const prompt = sessionStorage.getItem("designdb_prompt");
    const directAction = sessionStorage.getItem("designdb_action");

    if (directAction === "import") {
      sessionStorage.removeItem("designdb_action");
      // Open SQL Workspace & Import tab directly
      layoutRef.current.setSqlActiveTab("import");
      layoutRef.current.setSqlOpen(true);
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

  const generateSchema = async (prompt: string, existingSchema?: any) => {
    setIsGenerating(true);
    setGenerationProgress(0);
    
    // We only clear the graph if it's a completely new build, 
    // otherwise we keep the old graph visible while mutating
    if (!existingSchema) {
      setNodes([]); 
      setEdges([]);
    }
    
    try {
      // Fake progress 0-50% while waiting for API
      const fetchInterval = setInterval(() => {
        setGenerationProgress(prev => (prev < 45 ? prev + 1 : prev));
      }, 100);

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, existingSchema }),
      });
      clearInterval(fetchInterval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }
      
      const data = await response.json();
      setGeneratedSql(data.sql); // Silently kept for quick export
      layout.setGeneratedSql(data.sql); // Push to SQL Code Workspace panel
      setGeneratedMermaid(data.mermaid || ""); // Keep mermaid for export
      setRawSchemaContext(data.schema); // Save real context for next iteration
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
      const layouted = getLayoutedElements(rawNodes, rawEdges, 'LR');
      
      // If doing a mutation, compute diff and show review banner instead of overwriting
      if (existingSchema) {
        // Compute diff map: which tables are new, modified, or deleted
        const oldNodeIds = new Set(nodesRef.current.map(n => n.id));
        const newNodeIds = new Set(layouted.nodes.map(n => n.id));
        const diffMap: Record<string, 'added' | 'modified' | 'deleted'> = {};

        // New tables (in new but not in old)
        layouted.nodes.forEach(n => {
          if (!oldNodeIds.has(n.id)) {
            diffMap[n.id] = 'added';
          } else {
            // Check if modified (different attributes)
            const oldNode = nodesRef.current.find(o => o.id === n.id);
            if (oldNode && JSON.stringify(oldNode.data?.attributes) !== JSON.stringify(n.data?.attributes)) {
              diffMap[n.id] = 'modified';
            }
          }
        });

        // Deleted tables (in old but not in new)
        nodesRef.current.forEach(n => {
          if (!newNodeIds.has(n.id)) {
            diffMap[n.id] = 'deleted';
          }
        });

        // Apply diff status to new nodes for visual styling
        const nodesWithDiff = layouted.nodes.map(n => ({
          ...n,
          data: { ...n.data, diffStatus: diffMap[n.id] || undefined }
        }));

        // Also add deleted nodes (keep them but mark as deleted)
        const deletedNodes = nodesRef.current
          .filter(n => diffMap[n.id] === 'deleted')
          .map(n => ({ ...n, data: { ...n.data, diffStatus: 'deleted' as const } }));

        const allDiffNodes = [...nodesWithDiff, ...deletedNodes];

        setPendingDiff({
          newNodes: layouted.nodes,
          newEdges: layouted.edges,
          oldNodes: JSON.parse(JSON.stringify(nodesRef.current)),
          oldEdges: JSON.parse(JSON.stringify(edgesRef.current)),
          diffMap,
        });

        setNodes(allDiffNodes);
        setEdges(layouted.edges);
        setIsGenerating(false);
        setGenerationProgress(100);
        if (rfInstance) {
          setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
        }
        return;
      }

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
      setIsGenerating(false);
      setIsStaggering(false);
    }
  };

  const showProgressOverlay = isGenerating || isStaggering;

  // Dynamic chatbox centering: compute horizontal offset based on open sidebars
  const chatboxOffset = useMemo(() => {
    const rightOffset = showUnifiedSidebar ? 170 : 0; // half of 340px sidebar
    return -rightOffset;
  }, [showUnifiedSidebar]);

  const onLoadProject = (project: any) => {
    setCurrentProjectId(project.id);
    setProjectTitle(project.title);
    setNodes(project.nodesJson);
    setEdges(project.edgesJson);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (rfInstance) {
      setTimeout(() => rfInstance.fitView({ duration: 800, padding: 0.1 }), 200);
    }
    takeSnapshot();
  };

  const onCreateNewProject = () => {
    setCurrentProjectId(null);
    setProjectTitle("Untitled Schema");
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    takeSnapshot();
  };

  const handleChatSubmit = () => {
    if (!chatPrompt.trim() || showProgressOverlay) return;
    generateSchema(chatPrompt.trim(), rawSchemaContext);
    setChatPrompt("");
    setIsChatFocused(false);
  };

  // --- Schema Diff Approve/Discard Handlers ---
  const approveDiff = useCallback(() => {
    if (!pendingDiff) return;
    // Strip diffStatus from all nodes and commit
    setNodes(pendingDiff.newNodes.map(n => ({
      ...n,
      data: { ...n.data, diffStatus: undefined }
    })));
    setEdges(pendingDiff.newEdges);
    setPendingDiff(null);
    takeSnapshot();
    showToast("Schema changes approved ✓", "success");
  }, [pendingDiff, setNodes, setEdges, takeSnapshot]);

  const discardDiff = useCallback(() => {
    if (!pendingDiff) return;
    // Revert to old state
    setNodes(pendingDiff.oldNodes);
    setEdges(pendingDiff.oldEdges);
    setPendingDiff(null);
    showToast("Changes discarded — reverted to previous schema", "error");
  }, [pendingDiff, setNodes, setEdges]);

  const miniMapStyle = useMemo(() => {
    let rightOffset = 24;
    let bottomOffset = 24;

    if (showUnifiedSidebar) {
      rightOffset = 388; // 340px sidebar width + 24px gap + 24px spacing
    }
    if (showSqlSandbox) {
      bottomOffset = 408; // 360px sandbox height + 24px gap + 24px spacing
    }

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
  }, [showUnifiedSidebar, showSqlSandbox]);

  return (
    <div className="w-full h-full flex flex-col relative text-sm">
      <FloatingHeader
        generatedSql={generatedSql}
        generatedMermaid={generatedMermaid}
        rfInstance={rfInstance}
        showSidebar={showUnifiedSidebar}
        projectTitle={projectTitle}
        setProjectTitle={setProjectTitle}
        currentProjectId={currentProjectId}
        setCurrentProjectId={setCurrentProjectId}
      />

      {/* ── Schema Diff Review Banner ── */}
      {pendingDiff && (
        <div className="absolute top-[52px] left-1/2 -translate-x-1/2 z-50 pointer-events-auto animate-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-4 px-5 py-2.5 rounded-2xl bg-[#0A0E1A]/95 border border-white/[0.08] backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.7)]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-semibold text-white/80">Review Changes</span>
            </div>

            <div className="flex items-center gap-2 text-[10px] font-mono">
              {Object.values(pendingDiff.diffMap).filter(v => v === 'added').length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  +{Object.values(pendingDiff.diffMap).filter(v => v === 'added').length} new
                </span>
              )}
              {Object.values(pendingDiff.diffMap).filter(v => v === 'modified').length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  ~{Object.values(pendingDiff.diffMap).filter(v => v === 'modified').length} modified
                </span>
              )}
              {Object.values(pendingDiff.diffMap).filter(v => v === 'deleted').length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
                  -{Object.values(pendingDiff.diffMap).filter(v => v === 'deleted').length} removed
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={discardDiff}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] transition-all"
              >
                Discard
              </button>
              <button
                onClick={approveDiff}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)] hover:shadow-[0_6px_16px_rgba(16,185,129,0.4)] transition-all"
              >
                Approve & Apply
              </button>
            </div>
          </div>
        </div>
      )}

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
      
        <div className="flex-1 h-full relative">
            <HoverProvider>
              <div className="absolute inset-0 z-0">
            {/* Animated dotted grid background */}
            {showGrid && <div className="animated-dot-grid" />}
            <div className="canvas-vignette" />
            {showGrid && <CursorDotGrid />}
            
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={customOnNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStop={() => takeSnapshot()}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={setRfInstance}
              onNodeClick={(_event, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setSidebarTab("inspector");
                setShowUnifiedSidebar(true);
              }}
              onNodeDoubleClick={(_event, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
                setSidebarTab("inspector");
                setShowUnifiedSidebar(true);
              }}
              onEdgeClick={(_event, edge) => {
                setSelectedEdgeId(edge.id);
                setSelectedNodeId(null);
                setSidebarTab("inspector");
                setShowUnifiedSidebar(true);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              colorMode="dark"
            >
              {showGrid && <Background gap={24} size={1.2} variant={BackgroundVariant.Dots} color="rgba(255, 255, 255, 0.08)" />}
              


              {/* Left Side Floating Dock Panel removed per design request */}

              {/* Bottom-Left Toolbar: Undo / Redo / Zoom */}
              <Panel
                position="bottom-left"
                className="pointer-events-none !m-0"
                style={{ left: "88px", bottom: "24px" }}
              >
                <div className="pointer-events-auto bg-[#090C15]/80 backdrop-blur-xl border border-white/[0.08] rounded-xl px-1.5 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                  <CanvasToolbar
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    rfInstance={rfInstance}
                    detailsLevel={detailsLevel}
                    setDetailsLevel={setDetailsLevel}
                  />
                </div>
              </Panel>

              {/* MiniMap for canvas navigation */}
              <MiniMap
                position="bottom-right"
                style={miniMapStyle}
                maskColor="rgba(0,0,0,0.6)"
                nodeColor="#4A90D9"
                pannable
                zoomable
              />
            </ReactFlow>
      </div>
    </HoverProvider>
  </div>
        {isReviewsOpen && (
          <div 
            className="absolute z-40 w-[350px] max-h-[450px] glass-panel rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.8)] pointer-events-auto"
            style={{ left: "80px", top: "80px" }}
          >
            <div className="bg-[#0C1222]/90 px-5 py-3 border-b border-white/[0.06] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#4A90D9] animate-pulse" />
                <span className="text-xs font-semibold text-white tracking-wider uppercase font-mono">Architecture Audit</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={runAudit}
                  disabled={isAuditing}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-[#4A90D9] text-[10px] font-bold hover:bg-[#4A90D9]/25 transition-all disabled:opacity-40"
                >
                  {isAuditing ? <Loader2 size={10} className="animate-spin" /> : "Scan Canvas"}
                </button>
                <button 
                  onClick={() => setIsReviewsOpen(false)}
                  className="text-white/65 hover:text-white hover:bg-white/[0.06] rounded-md text-xs p-1 px-1.5 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Tabs Selector */}
            <div className="flex border-b border-white/[0.04] bg-[#080d1a]/80 px-2 py-1 shrink-0 gap-1">
              <button
                onClick={() => setAuditTab("wizard")}
                className={`flex-1 text-center py-1 text-[10px] font-bold rounded transition-colors ${
                  auditTab === "wizard"
                    ? "bg-white/[0.06] text-white"
                    : "text-white/40 hover:text-white/60 hover:bg-white/[0.02]"
                }`}
              >
                Interactive Wizard {auditSteps.length > 0 && `(${auditSteps.length - Math.max(0, currentStepIdx)})`}
              </button>
              <button
                onClick={() => setAuditTab("log")}
                className={`flex-1 text-center py-1 text-[10px] font-bold rounded transition-colors ${
                  auditTab === "log"
                    ? "bg-white/[0.06] text-white"
                    : "text-white/40 hover:text-white/60 hover:bg-white/[0.02]"
                }`}
              >
                Audit Log
              </button>
            </div>

            <div className="p-4 overflow-y-auto p-scrollbar bg-[#060A13]/60 flex-1 flex flex-col gap-3">
              {isAuditing ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-white/50 text-xs select-none">
                  <Loader2 size={24} className="animate-spin text-[#4A90D9]" />
                  <span>Analyzing database schema constraints...</span>
                </div>
              ) : auditTab === "wizard" ? (
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  {auditSteps.length === 0 || currentStepIdx >= auditSteps.length ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center gap-2 select-none">
                      <div className="text-2xl">✨</div>
                      <h5 className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">No Active Warnings</h5>
                      <p className="text-xs text-white/50 px-2 leading-relaxed">
                        {currentStepIdx >= auditSteps.length && auditSteps.length > 0
                          ? "Great job! All identified normal form issues have been resolved."
                          : "Run a \"Scan Canvas\" audit above to check your current visual design for 1NF/2NF/3NF violations."}
                      </p>
                      {(auditSteps.length === 0 || currentStepIdx >= auditSteps.length) && (
                        <button
                          onClick={runAudit}
                          className="mt-3 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#4A90D9] to-[#2d6db5] text-white text-[10px] font-bold shadow-[0_4px_12px_rgba(74,144,217,0.2)] hover:shadow-[0_6px_16px_rgba(74,144,217,0.3)] transition-all"
                        >
                          Scan Canvas Now
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 flex-1 flex flex-col min-h-0">
                      {/* Step Header */}
                      <div className="flex justify-between items-center bg-white/[0.02] border border-white/[0.04] rounded-lg px-2.5 py-1.5 shrink-0">
                        <span className="text-[9px] text-[#4A90D9] font-bold font-mono uppercase">
                          Recommendation {currentStepIdx + 1} of {auditSteps.length}
                        </span>
                        <span className="text-[9px] text-white/40 font-mono">
                          {Math.round(((currentStepIdx) / auditSteps.length) * 100)}% Resolved
                        </span>
                      </div>

                      {/* Chat Wizard Card */}
                      <div className="bg-purple-950/10 border border-purple-500/20 rounded-xl p-4 flex gap-3 shadow-[0_4px_16px_rgba(124,58,237,0.05)] shrink-0">
                        <div className="text-purple-400 shrink-0 text-base font-bold animate-pulse">✨</div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[10px] font-bold tracking-wider font-mono text-purple-400 uppercase mb-1">AI Audit Wizard</h4>
                          <p className="text-[11px] text-slate-300 leading-relaxed font-sans font-medium whitespace-pre-line">
                            {auditSteps[currentStepIdx]}
                          </p>
                        </div>
                      </div>

                      {/* Wizard Actions */}
                      <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-2 shrink-0">
                        <span className="text-[9px] text-white/35 font-mono uppercase tracking-wider block border-b border-white/[0.04] pb-1 mb-1">Actions</span>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const tbl = getTableFromStep(auditSteps[currentStepIdx]);
                              if (tbl) highlightTableOnCanvas(tbl);
                              else showToast("Could not find table context in step log", "error");
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.06] transition-all"
                          >
                            🔍 Highlight Table
                          </button>

                          <button
                            onClick={() => executeNormalizationStep(auditSteps[currentStepIdx])}
                            className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_4px_12px_rgba(124,58,237,0.2)] hover:shadow-[0_6px_16px_rgba(124,58,237,0.3)] transition-all"
                          >
                            ✨ Apply Fix
                          </button>
                        </div>

                        <button
                          onClick={() => setCurrentStepIdx(prev => prev + 1)}
                          className="w-full text-center py-1 text-[9px] text-white/30 hover:text-white/50 underline transition-colors"
                        >
                          Skip recommendation
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col gap-3 min-h-0">
                  <div className="bg-purple-950/10 border border-purple-500/20 rounded-xl p-4 flex gap-3 shadow-[0_4px_16px_rgba(124,58,237,0.05)] shrink-0">
                    <div className="text-purple-400 shrink-0 text-base font-bold animate-pulse">✨</div>
                    <div>
                      <h4 className="text-[11px] font-bold tracking-wider font-mono text-purple-400 uppercase mb-1">Normalization engine</h4>
                      <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                        {!generatedSql 
                          ? "Awaiting model design execution... Enter requirements above to kick off automatic 3NF schemas." 
                          : "DesignDB runs deterministic constraint passes on the LLM's raw schema to resolve atomicity, candidate keys, and transitive dependencies."}
                      </p>
                    </div>
                  </div>

                  {aiInsightReport ? (
                    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 flex-1">
                      <h4 className="text-[10px] font-bold tracking-wider font-mono text-white/50 uppercase mb-3 pb-2 border-b border-white/[0.05]">Execution Log</h4>
                      <div className="space-y-2.5">
                        {aiInsightReport.split('\n').filter(line => line.trim()).map((line, i) => {
                          if (line.startsWith('# ')) {
                            return null; // Skip main title
                          }
                          if (line.startsWith('## ')) {
                            return <h5 key={i} className="text-white/80 font-bold text-xs mt-3 mb-1">{line.replace('## ', '')}</h5>;
                          }
                          if (line.startsWith('**Status:**')) {
                            return <div key={i} className="text-[11px] text-lime-green font-mono">{line.replace(/\*\*/g, '')}</div>;
                          }
                          if (line.startsWith('**')) {
                            return <div key={i} className="text-[11px] text-white/60 font-mono">{line.replace(/\*\*/g, '')}</div>;
                          }
                          if (line.startsWith('- [')) {
                            const [, badge, rest] = line.match(/- \[(.*?)\] (.*)/) || [null, '', line.replace('- ', '')];
                            return (
                              <div key={i} className="text-xs text-slate-300 flex items-start gap-2 leading-snug bg-white/[0.01] p-2 rounded-lg border border-white/[0.02]">
                                {badge && <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">{badge}</span>}
                                <span>{rest}</span>
                              </div>
                            );
                          }
                          if (line.startsWith('- ')) {
                            return <div key={i} className="text-xs text-slate-300 flex items-start gap-2 leading-snug"><span className="text-white/20 mt-0.5">•</span><span>{line.replace('- ', '')}</span></div>;
                          }
                          return <p key={i} className="text-xs text-slate-400">{line}</p>;
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center text-white/30 text-xs italic select-none">
                      No report generated yet. Click &quot;Scan Canvas&quot; above to audit schema.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
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
            onDeleteNode={requestDeleteNode}
            generatedSql={generatedSql}
            activeTab={sidebarTab}
            setActiveTab={setSidebarTab}
            onClose={() => setShowUnifiedSidebar(false)}
            sqlDialect={sqlDialect}
            setSqlDialect={setSqlDialect}
            takeSnapshot={takeSnapshot}
          />
        )}

        {/* Bottom popup SqlSandbox restored */}
        <SqlSandbox
          nodes={nodes}
          isOpen={showSqlSandbox}
          onClose={() => { setShowSqlSandbox(false); }}
        />

        {tourStep !== null && (
          <div className="absolute inset-0 z-50 pointer-events-none">
            <div className="absolute inset-0 bg-[#030712]/50 backdrop-blur-[2px] transition-all" />

            {tourStep === 1 && (
              <div className="absolute bottom-28 left-1/2 -translate-x-1/2 pointer-events-auto w-[320px] bg-[#090C15]/95 border border-[#4A90D9]/50 rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-3 animate-in zoom-in-95 duration-200">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-[#4A90D9] font-mono tracking-wider uppercase font-bold">Onboarding (Step 1/4)</span>
                  <button onClick={skipTour} className="text-white/65 hover:text-white text-xs">Skip</button>
                </div>
                <h4 className="text-sm font-semibold text-white">Modify with AI Chatbox</h4>
                <p className="text-[11px] text-white/65 leading-relaxed font-medium">
                  Describe your system requirements in natural language in the prompt box below (e.g. &quot;Create a product inventory system&quot;), and DesignDB will auto-generate your 3NF tables and relationships.
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



        {/* Compact Expanding Chatbox — bottom-center, sidebar-aware */}
        <div 
          className="absolute bottom-8 z-50 pointer-events-none transition-all duration-500 ease-out"
          style={{
            left: `calc(50% + ${chatboxOffset}px)`,
            transform: 'translateX(-50%)',
          }}
        >
          <div 
            className={`pointer-events-auto flex items-center gap-2 rounded-full
              bg-[#030712]/80 backdrop-blur-xl border shadow-[0_12px_40px_rgba(0,0,0,0.5)]
              transition-all duration-500 ease-out cursor-text
              ${
                isChatFocused 
                  ? 'px-5 py-3 border-[#4A90D9]/40 shadow-[0_16px_56px_rgba(0,0,0,0.6),0_0_24px_rgba(74,144,217,0.12)] max-w-2xl'
                  : 'px-4 py-2.5 border-white/[0.08] hover:border-white/[0.15] hover:shadow-[0_16px_48px_rgba(0,0,0,0.6)] max-w-xs'
              }
            `}
            onClick={() => setIsChatFocused(true)}
          >
            <Sparkles 
              size={14} 
              className={`shrink-0 transition-all duration-500 ${
                showProgressOverlay 
                  ? 'text-lime-green animate-pulse' 
                  : isChatFocused 
                    ? 'text-[#4A90D9]' 
                    : 'text-[#4A90D9]/60 animate-pulse'
              }`} 
            />
            <input
              id="canvas-chatbox-input"
              type="text"
              value={chatPrompt}
              onChange={(e) => setChatPrompt(e.target.value)}
              onFocus={() => setIsChatFocused(true)}
              onBlur={(e) => {
                // Don't blur if clicking the submit button
                if (e.relatedTarget?.id === 'chatbox-submit-btn') return;
                if (!chatPrompt.trim()) setIsChatFocused(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
              disabled={showProgressOverlay}
              placeholder={showProgressOverlay ? 'Synthesizing...' : isChatFocused ? 'Modify schema (e.g. Add an orders table)...' : 'Modify schema...'}
              className={`bg-transparent text-white outline-none font-sans transition-all duration-500 placeholder:text-white/35
                ${isChatFocused ? 'w-96 text-[13px]' : 'w-28 text-xs cursor-pointer'}
              `}
              aria-label="Schema modification prompt"
            />
            {isChatFocused && (
              <button
                id="chatbox-submit-btn"
                onClick={handleChatSubmit}
                disabled={!chatPrompt.trim() || showProgressOverlay}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: chatPrompt.trim() && !showProgressOverlay 
                    ? 'linear-gradient(135deg, #1e549f 0%, #052c52 100%)' 
                    : 'rgba(255,255,255,0.05)',
                  border: chatPrompt.trim() && !showProgressOverlay 
                    ? '1px solid rgba(30,84,159,0.5)' 
                    : '1px solid transparent',
                }}
                aria-label="Submit prompt"
              >
                {showProgressOverlay 
                  ? <Loader2 size={13} className="animate-spin text-white/50" />
                  : <ArrowRight size={13} className={chatPrompt.trim() ? 'text-white' : 'text-white/30'} />
                }
              </button>
            )}
          </div>
        </div>

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

        {nodesToDelete && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-auto">
            <div className="bg-[#0C1520] border border-white/10 p-6 rounded-2xl shadow-2xl flex flex-col gap-4 max-w-sm w-full shadow-[0_16px_64px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-white">Delete Node</h3>
              </div>
              <p className="text-white/60 text-[13px] leading-relaxed">
                Are you sure you want to delete this node? This action will remove it and any connected relationships from the canvas. This cannot be undone.
              </p>
              <div className="flex justify-end gap-3 mt-4">
                <button 
                  onClick={cancelDelete} 
                  tabIndex={0}
                  className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete} 
                  autoFocus
                  tabIndex={0}
                  className="px-4 py-2 text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 hover:text-red-300 rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/50"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
        <Dashboard
          isOpen={showDashboard}
          onClose={() => setShowDashboard(false)}
          currentProjectId={currentProjectId}
          setCurrentProjectId={setCurrentProjectId}
          projectTitle={projectTitle}
          setProjectTitle={setProjectTitle}
          nodes={nodes}
          edges={edges}
          onLoadProject={onLoadProject}
          onCreateNewProject={onCreateNewProject}
        />

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

        <ToastContainer />
      </div>
  );
}
