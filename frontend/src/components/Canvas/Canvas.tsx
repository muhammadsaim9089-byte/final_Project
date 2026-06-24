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
  Position
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { FloatingHeader } from "./FloatingHeader";
import { useLayout } from "@/components/Layout/LayoutContext";
import { ToastContainer } from "../ui/toast";
import { TableNode } from "./Nodes/TableNode";
import { PulseEdge } from "./Edges/PulseEdge";
import { CrowsFootEdge } from "./Edges/CrowsFootEdge";
import { HoverProvider } from "./HoverContext";
  
import { DataTypesPanel } from "./DataTypesPanel";
import { CursorDotGrid } from "./CursorDotGrid";
import { CanvasToolbar } from "./CanvasToolbar";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { UnifiedSidebar } from "./UnifiedSidebar";
import { SqlSandbox } from "./SqlSandbox";
import { Dashboard } from "./Dashboard";
import { Loader2, ArrowRight, Sparkles } from 'lucide-react';

const nodeTypes = {
  tableMode: TableNode,
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
      
      // If doing a mutation, just flash the entire modified graph instantly for snappy UX
      if (existingSchema) {
         setNodes(layouted.nodes);
         setEdges(layouted.edges);
         setIsGenerating(false);
         setGenerationProgress(100);
         takeSnapshot();
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
      
      <div className="flex-1 w-full relative overflow-hidden">
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
                style={{ left: "24px", bottom: "24px" }}
              >
                <div className="pointer-events-auto bg-[#090C15]/80 backdrop-blur-xl border border-white/[0.08] rounded-xl px-1.5 py-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                  <CanvasToolbar
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    rfInstance={rfInstance}
                  />
                </div>
              </Panel>
            </ReactFlow>
          </div>
        </HoverProvider>



        {isReviewsOpen && (
          <div 
            className="absolute z-40 w-[340px] max-h-[380px] glass-panel rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col shadow-[0_24px_64px_rgba(0,0,0,0.8)] pointer-events-auto"
            style={{ left: "80px", top: "80px" }}
          >
            <div className="bg-[#0C1222]/90 px-5 py-3.5 border-b border-white/[0.06] flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#4A90D9] animate-pulse" />
                <span className="text-xs font-semibold text-white tracking-wider uppercase font-mono">Architecture Audit</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold tracking-wider px-2 py-0.5 rounded bg-[#4A90D9]/10 border border-[#4A90D9]/20 text-[#4A90D9] uppercase">INTELLIGENCE</span>
                <button 
                  onClick={() => setIsReviewsOpen(false)}
                  className="text-white/65 hover:text-white hover:bg-white/[0.06] rounded-md text-xs p-1 px-1.5 transition-all"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto p-scrollbar bg-[#060A13]/60 flex-1 flex flex-col gap-3">
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

              {aiInsightReport && (
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

        <ToastContainer />
      </div>
    </div>
  );
}
