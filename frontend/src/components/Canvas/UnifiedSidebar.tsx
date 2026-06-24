"use client";

import React, { useState, useEffect } from "react";
import { PlusSquare, Component, FileCode2, X, Trash2, Key, Copy, Check, Info, Settings, ArrowUp, ArrowRightLeft } from "lucide-react";
import { Node, Edge } from "@xyflow/react";
import { parseSqlDdl } from "../../lib/sqlParser";

const SQL_TYPES = ["serial", "integer", "varchar(255)", "text", "boolean", "timestamp", "date", "float", "decimal(10,2)", "uuid", "char(36)"];
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

interface UnifiedSidebarProps {
  nodes: Node[];
  setNodes: any;
  edges: Edge[];
  setEdges: any;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  onAutoLayout: () => void;
  onDeleteNode?: (id: string) => void;
  generatedSql: string;
  activeTab: "add" | "inspector" | "sql";
  setActiveTab: (tab: "add" | "inspector" | "sql") => void;
  onClose: () => void;
  sqlDialect: string;
  setSqlDialect: (dialect: string) => void;
  takeSnapshot: () => void;
}

export function UnifiedSidebar({
  nodes,
  setNodes,
  edges,
  setEdges,
  selectedNodeId,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId,
  showGrid,
  setShowGrid,
  onAutoLayout,
  onDeleteNode,
  generatedSql,
  activeTab,
  setActiveTab,
  onClose,
  sqlDialect,
  setSqlDialect,
  takeSnapshot
}: UnifiedSidebarProps) {
  
  // --- ADD TAB STATES ---
  const [tableName, setTableName] = useState("");
  const [templateType, setTemplateType] = useState<"blank" | "users" | "products" | "view">("blank");
  const [customColumns, setCustomColumns] = useState<NodeAttribute[]>([
    { name: "id", type: "serial", isPk: true, isFk: false }
  ]);
  // View specific fields
  const [sourceTable, setSourceTable] = useState("");
  const [expression, setExpression] = useState("");

  // --- INSPECTOR NODE EDITING STATES ---
  const [editingAttr, setEditingAttr] = useState<{ idx: number; field: "name" | "type" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingNodeName, setEditingNodeName] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");

  // --- SQL CODE IMPORT STATE ---
  const [copiedSql, setCopiedSql] = useState(false);
  const [importSql, setImportSql] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [sqlSubTab, setSqlSubTab] = useState<"preview" | "import">("preview");

  // --- APPEARANCE & GLOBAL SETTINGS STATES ---
  const [_fontOpen, _setFontOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("Vagnola Regular");
  const [themeColor, setThemeColor] = useState("#6A5FC1");
  const [nodeOpacity, setNodeOpacity] = useState(100);
  const [autoLayout, setAutoLayout] = useState(false);

  // Apply CSS variables for theme
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--theme-color", themeColor);
    root.style.setProperty("--node-font", selectedFont === "Vagnola Regular" ? "Vagnola, sans-serif" : `${selectedFont}, sans-serif`);
    root.style.setProperty("--node-opacity", String(nodeOpacity / 100));
  }, [themeColor, selectedFont, nodeOpacity]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedAttrs = selectedNode ? ((selectedNode.data.attributes as NodeAttribute[]) || []) : [];
  
  const selectedEdge = selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) : null;

  // --- HELPERS ---
  const uniqueName = (base: string) => {
    const names = nodes.map(n => n.data.label as string);
    let name = base;
    let i = 1;
    while (names.includes(name)) {
      name = `${base}_${i}`;
      i++;
    }
    return name;
  };

  const addNode = (label: string, attrs: NodeAttribute[]) => {
    const offset = nodes.length * 60;
    const newNode: Node = {
      id: label,
      type: "tableMode",
      position: { x: 200 + offset, y: 150 + offset },
      data: { label, icon: "server", attributes: attrs },
    };
    setNodes((nds: Node[]) => [...nds, newNode]);
    if (autoLayout) setTimeout(onAutoLayout, 100);
    takeSnapshot();
  };

  // --- ADD TAB FIELD ACTIONS ---
  const handleAddCustomColumn = () => {
    setCustomColumns([...customColumns, {
      name: `field_${customColumns.length + 1}`,
      type: "varchar(255)",
      isPk: false,
      isFk: false
    }]);
  };

  const handleUpdateCustomColumn = (idx: number, field: keyof NodeAttribute, val: any) => {
    const updated = [...customColumns];
    updated[idx] = { ...updated[idx], [field]: val };
    setCustomColumns(updated);
  };

  const handleRemoveCustomColumn = (idx: number) => {
    setCustomColumns(customColumns.filter((_, i) => i !== idx));
  };

  const handleCreateTable = () => {
    let name = uniqueName(tableName.trim() || "new_table");
    let attrs: NodeAttribute[] = [];

    if (templateType === "blank") {
      attrs = [...customColumns];
      if (attrs.length === 0) {
        attrs.push({ name: "id", type: "serial", isPk: true, isFk: false });
      }
    } else if (templateType === "users") {
      name = uniqueName(tableName.trim() || "users");
      attrs = [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "email", type: "varchar(255)", isPk: false, isFk: false },
        { name: "password_hash", type: "varchar(255)", isPk: false, isFk: false },
        { name: "created_at", type: "timestamp", isPk: false, isFk: false },
      ];
    } else if (templateType === "products") {
      name = uniqueName(tableName.trim() || "products");
      attrs = [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "price", type: "decimal(10,2)", isPk: false, isFk: false },
        { name: "stock", type: "integer", isPk: false, isFk: false },
        { name: "category_id", type: "integer", isPk: false, isFk: true },
      ];
    } else if (templateType === "view") {
      name = uniqueName(tableName.trim() || "computed_view");
      attrs = [
        { name: "view_id", type: "serial", isPk: true, isFk: false },
        { name: "source_table", type: "varchar(100)", isPk: false, isFk: false },
        { name: "expression", type: "text", isPk: false, isFk: false },
      ];
    }

    addNode(name, attrs);
    
    // Reset forms
    setTableName("");
    setCustomColumns([{ name: "id", type: "serial", isPk: true, isFk: false }]);
    if (templateType === "view") {
      setSourceTable("");
      setExpression("");
    }
  };

  // --- ATTRIBUTE CRUD (INSPECTOR) ---
  const updateAttr = (idx: number, field: string, value: string | boolean) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs[idx] = { ...attrs[idx], [field]: value };
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));
    takeSnapshot();
  };

  const deleteAttr = (idx: number) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs.splice(idx, 1);
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));
    takeSnapshot();
  };

  const addAttr = () => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      const newAttr = { name: `field_${attrs.length + 1}`, type: "varchar(255)", isPk: false, isFk: false };
      return { ...n, data: { ...n.data, attributes: [...attrs, newAttr] } };
    }));
    takeSnapshot();
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
    setSelectedNodeId(newNodeName);
    setEditingNodeName(false);
    takeSnapshot();
  };

  const duplicateNode = () => {
    if (!selectedNode) return;
    const name = uniqueName((selectedNode.data.label as string) + "_copy");
    addNode(name, [...((selectedNode.data.attributes as NodeAttribute[]) || [])]);
  };

  const deleteNode = () => {
    if (!selectedNodeId) return;
    if (onDeleteNode) {
      onDeleteNode(selectedNodeId);
    } else {
      setNodes((nds: Node[]) => nds.filter(n => n.id !== selectedNodeId));
      setEdges((eds: Edge[]) => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    }
    takeSnapshot();
  };

  // --- EDGE ACTIONS & RELATIONSHIP EDITING ---
  const updateEdgeData = (field: string, value: any) => {
    if (!selectedEdgeId) return;
    setEdges((eds: Edge[]) => eds.map(e => {
      if (e.id !== selectedEdgeId) return e;
      return {
        ...e,
        data: {
          ...e.data,
          [field]: value
        }
      };
    }));
    takeSnapshot();
  };

  const handleRelationshipTypeChange = (type: string) => {
    updateEdgeData("relationshipType", type);
  };

  const deleteEdge = () => {
    if (!selectedEdgeId) return;
    setEdges((eds: Edge[]) => eds.filter(e => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    takeSnapshot();
  };

  // --- SQL IMPORT HANDLER ---
  const handleImportSql = () => {
    setImportStatus("");
    if (!importSql.trim()) {
      setImportStatus("Error: Please paste a valid SQL DDL script.");
      return;
    }

    try {
      const parsed = parseSqlDdl(importSql);
      if (parsed.entities.length === 0) {
        setImportStatus("Error: No CREATE TABLE statements found in parsed SQL.");
        return;
      }

      // Convert parsed schema to React Flow nodes and edges
      const newNodes: Node[] = parsed.entities.map((entity, index) => ({
        id: entity.name,
        type: "tableMode",
        position: { x: 100 + index * 80, y: 100 + index * 60 },
        data: {
          label: entity.name,
          icon: "server",
          attributes: entity.attributes.map(attr => ({
            name: attr.name,
            type: attr.dataType,
            isPk: attr.isPrimaryKey,
            isFk: attr.isForeignKey
          }))
        }
      }));

      const newEdges: Edge[] = parsed.relationships.map((rel, index) => ({
        id: `e-${Date.now()}-${index}`,
        source: rel.toEntity,
        target: rel.fromEntity,
        type: "crowsFoot",
        data: {
          relationshipType: rel.type,
          sourceColumn: "id",
          targetColumn: rel.foreignKey
        }
      }));

      setNodes(newNodes);
      setEdges(newEdges);
      setImportSql("");
      setImportStatus(`Success: Imported ${newNodes.length} tables and ${newEdges.length} relationships.`);
      setTimeout(() => setImportStatus(""), 4000);
      onAutoLayout();
      takeSnapshot();
    } catch (err: any) {
      setImportStatus(`Error: ${err.message || "Failed to parse SQL."}`);
    }
  };

  // --- COPY SQL HELPERS ---
  const handleCopySql = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div 
      id="design-unified-sidebar"
      className="absolute right-6 top-24 bottom-6 w-[340px] z-40 bg-[#060B15]/90 backdrop-blur-xl border border-white/[0.08] flex flex-col pointer-events-auto rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] duration-300 select-none animate-in fade-in slide-in-from-right-4"
    >
      {/* Sidebar Tabs */}
      <div className="flex border-b border-white/[0.06] p-2 gap-1 bg-white/[0.01] rounded-t-2xl shrink-0">
        <button
          onClick={() => { setActiveTab("add"); setSelectedNodeId(null); setSelectedEdgeId(null); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
            activeTab === "add" 
              ? "bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-white shadow-inner" 
              : "text-white/60 hover:text-white hover:bg-white/[0.03] border border-transparent"
          }`}
        >
          <PlusSquare size={13} />
          Add
        </button>
        <button
          onClick={() => setActiveTab("inspector")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
            activeTab === "inspector" 
              ? "bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-white shadow-inner" 
              : "text-white/60 hover:text-white hover:bg-white/[0.03] border border-transparent"
          }`}
        >
          <Component size={13} />
          Inspector
        </button>
        {/* SQL moved to left workspace panel — removed from right sidebar */}
        
        <button 
          onClick={onClose} 
          className="p-1.5 text-white/65 hover:text-white hover:bg-white/[0.06] rounded-xl transition-all self-center"
          aria-label="Close sidebar"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-5 p-scrollbar flex flex-col gap-5">
        
        {/* ==================== ADD TAB ==================== */}
        {activeTab === "add" && (
          <div className="space-y-4 flex flex-col">
            <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
              <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Add Canvas Table</span>
              <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Builder</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Table Name</label>
              <input 
                value={tableName} 
                onChange={e => setTableName(e.target.value)} 
                placeholder="e.g. orders"
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all" 
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Insertion Template</label>
              <div className="relative">
                <select 
                  value={templateType} 
                  onChange={e => setTemplateType(e.target.value as any)}
                  className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50 transition-all"
                >
                  <option value="blank">Custom Columns Table</option>
                  <option value="users">Users Preset</option>
                  <option value="products">Products Preset</option>
                  <option value="view">SQL View (Computed)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
              </div>
            </div>

            {/* Custom Table Builder fields list */}
            {templateType === "blank" && (
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center border-b border-white/[0.04] pb-1.5">
                  <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Columns Builder</span>
                  <button 
                    onClick={handleAddCustomColumn}
                    className="text-[10px] text-[#4A90D9] hover:text-[#4A90D9]/80 font-bold bg-[#4A90D9]/5 hover:bg-[#4A90D9]/10 px-2 py-0.5 rounded border border-[#4A90D9]/25 transition-all"
                  >
                    + Add Field
                  </button>
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto p-scrollbar pr-1">
                  {customColumns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-white/[0.01] border border-white/[0.04] p-1.5 rounded-xl">
                      {/* Name */}
                      <input 
                        type="text"
                        value={col.name}
                        onChange={(e) => handleUpdateCustomColumn(idx, "name", e.target.value)}
                        placeholder="col_name"
                        className="flex-1 bg-[#040810] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-[#4A90D9]/30"
                      />

                      {/* Type */}
                      <select
                        value={col.type}
                        onChange={(e) => handleUpdateCustomColumn(idx, "type", e.target.value)}
                        className="w-24 bg-[#040810] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white outline-none"
                      >
                        {SQL_TYPES.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>

                      {/* PK */}
                      <button
                        onClick={() => handleUpdateCustomColumn(idx, "isPk", !col.isPk)}
                        title="Toggle Primary Key"
                        className={`p-1 rounded border transition-colors ${
                          col.isPk 
                            ? "bg-yellow-400/20 border-yellow-400/40 text-yellow-400" 
                            : "bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white"
                        }`}
                      >
                        <Key size={10} />
                      </button>

                      {/* Trash */}
                      <button
                        onClick={() => handleRemoveCustomColumn(idx)}
                        disabled={customColumns.length === 1}
                        className="p-1 rounded border border-white/[0.06] text-white/30 hover:text-red-400 hover:border-red-400/20 disabled:opacity-20"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calculated view source table selector */}
            {templateType === "view" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Source Table</label>
                  <div className="relative">
                    <select 
                      value={sourceTable} 
                      onChange={e => setSourceTable(e.target.value)}
                      className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                    >
                      <option value="">Select source table...</option>
                      {nodes.map(n => (
                        <option key={n.id} value={n.data.label as string}>
                          {n.data.label as string}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Expression / Filter</label>
                  <textarea 
                    value={expression} 
                    onChange={e => setExpression(e.target.value)} 
                    placeholder="e.g. status = 'active'"
                    className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all resize-none h-16 p-scrollbar" 
                  />
                </div>
              </>
            )}

            <button 
              onClick={handleCreateTable} 
              className="w-full mt-4 py-2.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(74,144,217,0.25)] flex items-center justify-center gap-1.5"
            >
              <PlusSquare size={13} />
              {templateType === "view" ? "Create Computed View" : "Spawn Custom Table"}
            </button>
          </div>
        )}

        {/* ==================== INSPECTOR TAB ==================== */}
        {activeTab === "inspector" && (
          <div className="space-y-4 flex flex-col">
            
            {/* 1. NODE SELECTED */}
            {selectedNode && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Table Attributes</span>
                  <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Entity</span>
                </div>

                {/* Table Name Title Inline Editor */}
                <div className="space-y-1.5 bg-white/[0.01] border border-white/[0.04] p-3 rounded-xl">
                  <span className="text-[10px] text-white/45 uppercase font-sans tracking-wide block">Physical Table Name</span>
                  {editingNodeName ? (
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="text" 
                        value={newNodeName} 
                        onChange={e => setNewNodeName(e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-[#4A90D9]/40 rounded-lg px-2.5 py-1 text-xs text-[#C9C8C7] font-mono outline-none" 
                      />
                      <button onClick={renameNode} className="p-1 rounded bg-[#4A90D9] text-white"><Check size={12} /></button>
                      <button onClick={() => setEditingNodeName(false)} className="p-1 rounded bg-white/5 text-white/60"><X size={12} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#C9C8C7] font-mono font-bold truncate drop-shadow-[0_0_6px_rgba(74,144,217,0.2)]">
                        {selectedNode.data.label as string}
                      </span>
                      <button 
                        onClick={() => { setNewNodeName(selectedNode.data.label as string); setEditingNodeName(true); }}
                        className="text-[10px] text-[#4A90D9] hover:underline"
                      >
                        Rename
                      </button>
                    </div>
                  )}
                </div>

                {/* Columns Attribute List */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center border-b border-white/[0.04] pb-1">
                    <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Columns ({selectedAttrs.length})</span>
                    <button 
                      onClick={addAttr}
                      className="text-[9px] text-[#4A90D9] font-bold bg-[#4A90D9]/5 hover:bg-[#4A90D9]/10 px-2 py-0.5 rounded transition-all"
                    >
                      + Add Field
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 p-scrollbar">
                    {selectedAttrs.length === 0 ? (
                      <div className="text-xs text-white/30 italic py-2 text-center">No columns defined. Click Add Field above.</div>
                    ) : (
                      selectedAttrs.map((attr, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 bg-white/[0.005] border border-white/[0.04] p-1.5 rounded-xl hover:bg-white/[0.02] transition-all">
                          {editingAttr?.idx === idx && editingAttr.field === "name" ? (
                            <input 
                              type="text" 
                              value={editValue} 
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => { updateAttr(idx, "name", editValue); setEditingAttr(null); }}
                              onKeyDown={e => e.key === 'Enter' && {}}
                              autoFocus
                              className="flex-1 bg-white/[0.06] border border-[#4A90D9]/30 rounded px-1.5 py-0.5 text-[11px] text-white font-mono outline-none" 
                            />
                          ) : (
                            <span 
                              onClick={() => { setEditingAttr({ idx, field: "name" }); setEditValue(attr.name); }}
                              className="flex-1 text-[11px] text-white/70 font-mono cursor-pointer hover:text-white truncate"
                            >
                              {attr.name}
                            </span>
                          )}

                          <select
                            value={attr.type}
                            onChange={e => updateAttr(idx, "type", e.target.value)}
                            className="bg-[#050913] border border-white/[0.1] rounded px-1 py-0.5 text-[10px] text-white/70 font-mono outline-none"
                          >
                            {SQL_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>

                          {/* PK Toggle */}
                          <button
                            onClick={() => updateAttr(idx, "isPk", !attr.isPk)}
                            className={`p-1 rounded transition-colors ${attr.isPk ? "text-yellow-400 bg-yellow-400/10" : "text-white/35 hover:text-white/65"}`}
                          >
                            <Key size={10} />
                          </button>

                          {/* Delete Field */}
                          <button
                            onClick={() => deleteAttr(idx)}
                            className="p-1 rounded text-white/20 hover:text-red-400"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Appearance Swatches & Settings Accordion */}
                <div className="space-y-3 border-t border-white/[0.05] pt-3">
                  <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Entity Appearance</span>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/65 font-sans font-medium">Color Accent</span>
                    <div className="flex gap-2">
                      {THEME_COLORS.map(color => (
                        <button
                          key={color.name}
                          onClick={() => setThemeColor(color.hex)}
                          className={`w-4 h-4 rounded-full border transition-all ${color.bg} ${
                            themeColor === color.hex ? "ring-2 ring-white scale-110" : "border-white/20 hover:scale-105"
                          }`}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Node Operations */}
                <div className="flex gap-2 pt-2 border-t border-white/[0.05]">
                  <button 
                    onClick={duplicateNode}
                    className="flex-1 py-2 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] text-white text-[11px] font-bold rounded-lg transition-all"
                  >
                    Duplicate Table
                  </button>
                  <button 
                    onClick={deleteNode}
                    className="flex-1 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-lg transition-all"
                  >
                    Delete Table
                  </button>
                </div>
              </div>
            )}

            {/* 2. EDGE SELECTED */}
            {selectedEdge && !selectedNode && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Relationship Details</span>
                  <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Edge</span>
                </div>

                {/* Connection description */}
                <div className="bg-[#050913]/60 border border-white/[0.05] p-3 rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-[10px]">
                    <span>Source (Parent)</span>
                    <span>Target (Child)</span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-white font-mono">
                    <span className="text-yellow-400 truncate max-w-[100px]">{selectedEdge.source}</span>
                    <ArrowRightLeft size={12} className="text-[#4A90D9] mx-2" />
                    <span className="text-sky-400 truncate max-w-[100px]">{selectedEdge.target}</span>
                  </div>
                </div>

                {/* Relationship Type Selector (Cardinality) */}
                <div className="space-y-2">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Cardinality Notation</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { type: "one-to-one", label: "1 : 1 (One-to-One)" },
                      { type: "one-to-many", label: "1 : N (One-to-Many)" },
                      { type: "many-to-one", label: "N : 1 (Many-to-One)" },
                      { type: "many-to-many", label: "N : M (Many-to-Many)" }
                    ].map(card => {
                      const currentType = (selectedEdge.data?.relationshipType as string) || "one-to-many";
                      return (
                        <button
                          key={card.type}
                          onClick={() => handleRelationshipTypeChange(card.type)}
                          className={`py-2 px-1 text-[10px] font-semibold border rounded-lg transition-all ${
                            currentType === card.type
                              ? "bg-[#4A90D9]/15 border-[#4A90D9]/40 text-white shadow-inner"
                              : "bg-white/[0.01] border-white/[0.06] text-white/50 hover:text-white"
                          }`}
                        >
                          {card.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Column Mappings */}
                <div className="space-y-2">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Key Join Mapping</label>
                  
                  <div className="space-y-2 bg-[#040810]/40 border border-white/[0.04] p-3 rounded-xl">
                    {/* Source Column */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/65 font-mono block">Primary Key (Source)</span>
                      <select
                        value={(selectedEdge.data?.sourceColumn as string) || "id"}
                        onChange={e => updateEdgeData("sourceColumn", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none"
                      >
                        {((nodes.find(n => n.id === selectedEdge.source)?.data.attributes as any[]) || []).map(a => (
                          <option key={a.name} value={a.name}>{a.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Target Column */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/65 font-mono block">Foreign Key (Target)</span>
                      <select
                        value={(selectedEdge.data?.targetColumn as string) || ""}
                        onChange={e => updateEdgeData("targetColumn", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none"
                      >
                        <option value="">Select target column...</option>
                        {((nodes.find(n => n.id === selectedEdge.target)?.data.attributes as any[]) || []).map(a => (
                          <option key={a.name} value={a.name}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Cascade constraints ON DELETE / ON UPDATE */}
                <div className="space-y-2 border-t border-white/[0.05] pt-3">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide flex items-center gap-1.5">
                    <Info size={11} className="text-[#4A90D9]/80" />
                    Referential Integrity Constraints
                  </label>
                  
                  <div className="grid grid-cols-2 gap-2 bg-[#040810]/40 border border-white/[0.04] p-3 rounded-xl">
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/45 font-sans uppercase block">ON DELETE</span>
                      <select
                        value={(selectedEdge.data?.onDelete as string) || "NO ACTION"}
                        onChange={e => updateEdgeData("onDelete", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white/70 outline-none"
                      >
                        <option value="NO ACTION">NO ACTION</option>
                        <option value="CASCADE">CASCADE</option>
                        <option value="SET NULL">SET NULL</option>
                        <option value="RESTRICT">RESTRICT</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-white/45 font-sans uppercase block">ON UPDATE</span>
                      <select
                        value={(selectedEdge.data?.onUpdate as string) || "NO ACTION"}
                        onChange={e => updateEdgeData("onUpdate", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white/70 outline-none"
                      >
                        <option value="NO ACTION">NO ACTION</option>
                        <option value="CASCADE">CASCADE</option>
                        <option value="SET NULL">SET NULL</option>
                        <option value="RESTRICT">RESTRICT</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={deleteEdge}
                  className="w-full py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-lg transition-all"
                >
                  Delete Relationship
                </button>
              </div>
            )}

            {/* 3. NOTHING SELECTED - SHOW SETTINGS */}
            {!selectedNode && !selectedEdge && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Workspace Settings</span>
                  <Settings size={13} className="text-white/65" />
                </div>

                <div className="space-y-3 bg-[#050913]/30 border border-white/[0.04] p-3 rounded-xl">
                  {/* SQL Dialect */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-white/65 font-sans font-medium tracking-wide block">SQL dialect mapper</span>
                    <div className="relative">
                      <select 
                        value={sqlDialect} 
                        onChange={e => setSqlDialect(e.target.value)}
                        className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                      >
                        <option value="postgres">PostgreSQL</option>
                        <option value="mysql">MySQL Dialect</option>
                        <option value="sqlite">SQLite Dialect</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                    </div>
                  </div>

                  {/* Auto Layout */}
                  <div className="flex items-center justify-between py-2 border-t border-white/[0.04] mt-2">
                    <span className="text-[11px] text-white/70 font-semibold tracking-wide">Instant Auto-Layout</span>
                    <button 
                      onClick={() => setAutoLayout(!autoLayout)}
                      className={`w-9 h-5 rounded-full transition-all relative border border-white/[0.06] shadow-inner ${
                        autoLayout ? "bg-[#4A90D9] border-[#4A90D9]/20" : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ease-out shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${
                        autoLayout ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/60"
                      }`} />
                    </button>
                  </div>

                  {/* Show Grid */}
                  <div className="flex items-center justify-between py-2 border-t border-white/[0.04]">
                    <span className="text-[11px] text-white/70 font-semibold tracking-wide">Show Grid Patterns</span>
                    <button 
                      onClick={() => setShowGrid(!showGrid)}
                      className={`w-9 h-5 rounded-full transition-all relative border border-white/[0.06] shadow-inner ${
                        showGrid ? "bg-[#4A90D9] border-[#4A90D9]/20" : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ease-out shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${
                        showGrid ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/60"
                      }`} />
                    </button>
                  </div>

                  {/* Node Opacity */}
                  <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/70 font-semibold tracking-wide">Node Opacity Slider</span>
                      <span className="text-[10px] text-[#C9C8C7] font-mono font-bold bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded">
                        {nodeOpacity}%
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="30" 
                      max="100" 
                      value={nodeOpacity} 
                      onChange={e => setNodeOpacity(parseInt(e.target.value))}
                      className="w-full accent-[#4A90D9] h-1 bg-white/10 rounded-lg cursor-pointer appearance-none outline-none" 
                    />
                  </div>

                  {/* Typography Font Face */}
                  <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
                    <span className="text-[11px] text-white/65 font-sans font-medium tracking-wide block">Canvas Typography</span>
                    <div className="relative">
                      <select 
                        value={selectedFont} 
                        onChange={e => setSelectedFont(e.target.value)}
                        className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                      >
                        {FONT_OPTIONS.map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-white/35 leading-relaxed bg-[#050913]/10 border border-white/[0.02] p-3 rounded-xl flex gap-2">
                  <Info size={13} className="shrink-0 text-[#4A90D9]" />
                  <span>Double-click any schema entity node or single click any relationship line to inspect and configure attributes.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SQL workspace has been moved to the left panel (SQLCodePanel) */}
        
      </div>
    </div>
  );
}
