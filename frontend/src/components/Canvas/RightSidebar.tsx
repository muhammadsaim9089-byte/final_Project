"use client";

import { useState, useEffect } from "react";
import { Settings, ChevronRight, Check, Trash2, Copy, Pencil, Plus, X, Key } from "lucide-react";
import { Node, Edge } from "@xyflow/react";

const SQL_TYPES = ["serial", "integer", "varchar(255)", "text", "boolean", "timestamp", "date", "float", "decimal", "uuid", "char(36)"];
const FONT_OPTIONS = ["Vagnola Regular", "Inter", "JetBrains Mono", "Roboto", "Fira Code"];
const THEME_COLORS = [
  { name: "Lime", hex: "#C2EF4E", bg: "bg-lime-green" },
  { name: "Purple", hex: "#6A5FC1", bg: "bg-sentry-purple" },
  { name: "Coral", hex: "#FF6B6B", bg: "bg-coral-accent" },
  { name: "Slate", hex: "#64748b", bg: "bg-slate-500" },
];

interface NodeAttribute {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
}

interface RightSidebarProps {
  nodes: Node[];
  setNodes: (updater: Node[] | ((nodes: Node[]) => Node[])) => void;
  edges: Edge[];
  setEdges: (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void;
  selectedNodeId: string | null;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  onAutoLayout: () => void;
}

export function RightSidebar({ nodes, setNodes, edges: _edges, setEdges, selectedNodeId, showGrid, setShowGrid, onAutoLayout }: RightSidebarProps) {

  // Editing state
  const [editingAttr, setEditingAttr] = useState<{idx:number,field:"name"|"type"}|null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingNodeName, setEditingNodeName] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");

  // UI state
  const [fontOpen, setFontOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("Vagnola Regular");
  const [themeColor, setThemeColor] = useState("#C2EF4E");
  const [showSettings, setShowSettings] = useState(false);
  const [sqlDialect, setSqlDialect] = useState("PostgreSQL");
  const [autoLayout, setAutoLayout] = useState(false);
  const [nodeOpacity, setNodeOpacity] = useState(100);

  // Apply CSS variables for theme
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--theme-color", themeColor);
    root.style.setProperty("--node-font", selectedFont === "Vagnola Regular" ? "Vagnola, sans-serif" : `${selectedFont}, sans-serif`);
    root.style.setProperty("--node-opacity", String(nodeOpacity / 100));
  }, [themeColor, selectedFont, nodeOpacity]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedAttrs = selectedNode ? ((selectedNode.data.attributes as NodeAttribute[]) || []) : [];

  // --- HELPERS ---
  const uniqueName = (base: string) => {
    const names = nodes.map(n => n.data.label as string);
    let name = base; let i = 1;
    while (names.includes(name)) { name = `${base}_${i}`; i++; }
    return name;
  };

  const addNode = (label: string, attrs: NodeAttribute[]) => {
    const offset = nodes.length * 60;
    const newNode: Node = {
      id: label, type: "tableMode",
      position: { x: 200 + offset, y: 150 + offset },
      data: { label, icon: "server", attributes: attrs },
    };
    setNodes((nds: Node[]) => [...nds, newNode]);
    if (autoLayout) setTimeout(onAutoLayout, 100);
  };

  // --- ATTRIBUTE CRUD ---
  const updateAttr = (idx: number, field: string, value: string | boolean) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs[idx] = { ...attrs[idx], [field]: value };
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));
  };

  const deleteAttr = (idx: number) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs.splice(idx, 1);
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));
  };

  const addAttr = () => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      const newAttr = { name: `field_${attrs.length + 1}`, type: "varchar(255)", isPk: false, isFk: false };
      return { ...n, data: { ...n.data, attributes: [...attrs, newAttr] } };
    }));
  };

  // --- NODE ACTIONS ---
  const renameNode = () => {
    if (!selectedNodeId || !newNodeName.trim()) return;
    setNodes((nds: Node[]) => nds.map(n =>
      n.id === selectedNodeId ? { ...n, id: newNodeName, data: { ...n.data, label: newNodeName } } : n
    ));
    setEdges((eds: Edge[]) => eds.map(e => ({
      ...e,
      source: e.source === selectedNodeId ? newNodeName : e.source,
      target: e.target === selectedNodeId ? newNodeName : e.target,
    })));
    setEditingNodeName(false);
  };

  const duplicateNode = () => {
    if (!selectedNode) return;
    const name = uniqueName((selectedNode.data.label as string) + "_copy");
    addNode(name, [...((selectedNode.data.attributes as NodeAttribute[]) || [])]);
  };

  const deleteNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.filter(n => n.id !== selectedNodeId));
    setEdges((eds: Edge[]) => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
  };

  return (
    <div className="absolute right-6 top-24 bottom-6 w-[300px] z-40 bg-[#060B15]/90 backdrop-blur-xl border border-white/[0.08] flex flex-col pointer-events-auto rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <h2 className="text-[15px] font-semibold flex items-center gap-1.5 tracking-tight">
          <span className="text-lime-green drop-shadow-[0_0_8px_rgba(194,239,78,0.3)]">Inspector</span>
          <ChevronRight size={14} className="text-white/20" />
        </h2>
        <span className="text-[9px] text-white/40 font-mono tracking-[0.2em] uppercase mt-1 block">Properties</span>
      </div>
      <div className="mx-5 h-px bg-white/[0.06]" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 p-scrollbar">
        {/* === SELECTED NODE === */}
        <div>
          <span className="text-[9px] text-white/40 font-mono uppercase tracking-[0.18em] block mb-2.5">Selected Node</span>
          {selectedNode ? (
            <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 space-y-3.5">
              {/* Node name */}
              <div className="flex items-center justify-between">
                {editingNodeName ? (
                  <input 
                    autoFocus 
                    value={newNodeName} 
                    onChange={e => setNewNodeName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && renameNode()}
                    onBlur={renameNode}
                    className="flex-1 bg-white/[0.06] border border-lime-green/40 rounded-lg px-2.5 py-1 text-[12px] text-lime-green font-mono outline-none focus:bg-white/[0.08]" 
                  />
                ) : (
                  <span className="text-[13px] text-lime-green font-mono font-bold truncate drop-shadow-[0_0_6px_rgba(194,239,78,0.2)]">
                    {selectedNode.data.label as string}
                  </span>
                )}
                <div className="flex gap-1.5 ml-2.5 shrink-0">
                  <button 
                    onClick={() => { setEditingNodeName(true); setNewNodeName(selectedNode.data.label as string); }}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white transition-all"
                  >
                    <Pencil size={11} />
                  </button>
                  <button 
                    onClick={duplicateNode}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-blue-400 transition-all"
                  >
                    <Copy size={11} />
                  </button>
                  <button 
                    onClick={deleteNode}
                    className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              <div className="h-px bg-white/[0.06]" />

              {/* Attributes */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto p-scrollbar pr-1">
                {selectedAttrs.map((attr: NodeAttribute, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 group py-1.5 px-2 rounded-lg bg-white/[0.01] hover:bg-white/[0.04] border border-transparent hover:border-white/[0.04] transition-all">
                    <button 
                      onClick={() => updateAttr(idx, "isPk", !attr.isPk)}
                      className={`shrink-0 ${attr.isPk ? "text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.3)]" : "text-white/20 hover:text-white/40"} transition-colors`}
                    >
                      <Key size={11} />
                    </button>
                    
                    {editingAttr?.idx === idx && editingAttr.field === "name" ? (
                      <input 
                        autoFocus 
                        value={editValue} 
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { updateAttr(idx, "name", editValue); setEditingAttr(null); } }}
                        onBlur={() => { updateAttr(idx, "name", editValue); setEditingAttr(null); }}
                        className="flex-1 bg-white/[0.06] border border-lime-green/30 rounded px-1.5 py-0.5 text-[11px] text-white font-mono outline-none" 
                      />
                    ) : (
                      <span 
                        onClick={() => { setEditingAttr({ idx, field: "name" }); setEditValue(attr.name); }}
                        className="flex-1 text-[11px] text-white/70 font-mono cursor-pointer hover:text-white truncate"
                      >
                        {attr.name}
                      </span>
                    )}

                    {editingAttr?.idx === idx && editingAttr.field === "type" ? (
                      <select 
                        autoFocus 
                        value={editValue} 
                        onChange={e => { updateAttr(idx, "type", e.target.value); setEditingAttr(null); }}
                        onBlur={() => setEditingAttr(null)}
                        className="bg-[#050913] border border-white/[0.1] rounded px-1 py-0.5 text-[10px] text-white/70 font-mono outline-none"
                      >
                        {SQL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span 
                        onClick={() => { setEditingAttr({ idx, field: "type" }); setEditValue(attr.type); }}
                        className="text-[10px] text-white/45 bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:text-white hover:bg-white/[0.08] shrink-0"
                      >
                        {attr.type}
                      </span>
                    )}

                    <button 
                      onClick={() => deleteAttr(idx)}
                      className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all shrink-0 p-0.5"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>

              <button 
                onClick={addAttr}
                className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-white/[0.08] hover:border-lime-green/30 hover:bg-lime-green/5 rounded-lg text-[10px] text-white/40 hover:text-lime-green transition-all font-mono font-bold"
              >
                <Plus size={11} /> Add Attribute
              </button>
            </div>
          ) : (
            <div className="bg-white/[0.01] rounded-xl border border-dashed border-white/[0.06] p-5 text-center">
              <span className="text-[11px] text-white/30 font-mono">Select a node to inspect properties</span>
            </div>
          )}
        </div>

        {/* === TYPOGRAPHY === */}
        <div className="relative">
          <span className="text-[9px] text-white/40 font-mono uppercase tracking-[0.18em] block mb-2.5">Typography</span>
          <div 
            onClick={() => setFontOpen(p => !p)}
            className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3.5 py-2.5 flex justify-between items-center cursor-pointer hover:bg-white/[0.06] hover:border-white/[0.12] transition-all"
          >
            <span className="text-[12px] text-white/80 font-medium">{selectedFont}</span>
            <span className="text-white/30 text-[10px]">▼</span>
          </div>
          {fontOpen && (
            <div className="absolute left-0 right-0 mt-2 bg-[#050913]/95 backdrop-blur-xl border border-white/[0.08] rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-50 p-1">
              {FONT_OPTIONS.map(f => (
                <button 
                  key={f} 
                  onClick={() => { setSelectedFont(f); setFontOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-[11px] rounded-lg transition-all ${
                    selectedFont === f 
                      ? "bg-lime-green/10 text-lime-green font-bold" 
                      : "text-white/50 hover:bg-white/[0.04] hover:text-white"
                  }`}
                  style={{ fontFamily: f === "Vagnola Regular" ? "Vagnola, sans-serif" : f }}
                >
                  <span>{f}</span>
                  {selectedFont === f && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* === TABLE THEME === */}
        <div>
          <span className="text-[9px] text-white/40 font-mono uppercase tracking-[0.18em] block mb-2.5">Table Theme</span>
          <div className="flex gap-3 px-1">
            {THEME_COLORS.map(tc => {
              const isSelected = themeColor === tc.hex;
              return (
                <div 
                  key={tc.name} 
                  onClick={() => setThemeColor(tc.hex)}
                  className={`w-7 h-7 rounded-lg ${tc.bg} cursor-pointer hover:scale-110 active:scale-95 transition-all ${
                    isSelected 
                      ? "ring-2 ring-white/40 ring-offset-2 ring-offset-[#060B15] shadow-[0_0_12px_rgba(255,255,255,0.15)]" 
                      : "opacity-75 hover:opacity-100"
                  }`} 
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* === SETTINGS === */}
      <div className="border-t border-white/[0.06] bg-white/[0.01] rounded-b-2xl">
        <button 
          onClick={() => setShowSettings(p => !p)}
          className="w-full flex items-center gap-2.5 px-5 py-3.5 text-white/40 hover:text-white transition-colors group font-bold"
        >
          <Settings size={15} className="group-hover:rotate-45 transition-transform duration-300 text-lime-green" />
          <span className="text-[12px] tracking-wide">Canvas Settings</span>
          <ChevronRight size={12} className={`ml-auto transition-transform duration-200 ${showSettings ? "rotate-90" : ""} text-white/20`} />
        </button>
        
        {showSettings && (
          <div className="px-5 pb-5 space-y-3.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">SQL Dialect</span>
              <div className="relative">
                <select 
                  value={sqlDialect} 
                  onChange={e => setSqlDialect(e.target.value)}
                  className="bg-[#050913] border border-white/[0.08] rounded-lg px-2.5 py-1 text-[10px] text-white/70 outline-none cursor-pointer focus:border-lime-green/30"
                >
                  <option>PostgreSQL</option>
                  <option>MySQL</option>
                  <option>SQLite</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Auto-layout</span>
              <button 
                onClick={() => setAutoLayout(!autoLayout)}
                className={`w-9 h-5 rounded-full transition-colors relative border border-white/[0.06] ${autoLayout ? "bg-lime-green" : "bg-white/5"}`}
              >
                <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
                  autoLayout ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/40"
                }`} />
              </button>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Opacity</span>
                <span className="text-[10px] text-lime-green font-mono font-bold">{nodeOpacity}%</span>
              </div>
              <input 
                type="range" 
                min="30" 
                max="100" 
                value={nodeOpacity} 
                onChange={e => setNodeOpacity(parseInt(e.target.value))}
                className="w-full accent-lime-green h-1 bg-white/10 rounded-lg cursor-pointer appearance-none" 
              />
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/40 font-mono uppercase tracking-wider">Show Grid</span>
              <button 
                onClick={() => setShowGrid(!showGrid)}
                className={`w-9 h-5 rounded-full transition-colors relative border border-white/[0.06] ${showGrid ? "bg-lime-green" : "bg-white/5"}`}
              >
                <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
                  showGrid ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/40"
                }`} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
