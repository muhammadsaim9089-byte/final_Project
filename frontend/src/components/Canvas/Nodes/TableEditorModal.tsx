"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Plus, Trash2, GripVertical, Database, ShieldAlert, Key, SlidersHorizontal } from "lucide-react";
import { Node, Edge } from "@xyflow/react";

interface NodeAttribute {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  size?: string;
  defaultVal?: string;
  allowNull?: boolean;
  unique?: boolean;
  autoIncrement?: boolean;
  color?: string;
  comment?: string;
  fkRefTable?: string;
  fkRefField?: string;
  fkRelationType?: string;
}

interface TableIndex {
  name: string;
  columns: string[];
  type: string; // BTREE | UNIQUE | HASH | GIST | GIN
  isUnique?: boolean;
}

interface TableConstraint {
  name: string;
  type?: string; // CHECK | UNIQUE | EXCLUSION
  expression: string;
}

interface TableEditorModalProps {
  isOpen: boolean;
  tableNodeId: string | "new" | null;
  nodes: Node[];
  setNodes: any;
  edges: Edge[];
  setEdges: any;
  onClose: () => void;
  takeSnapshot: (override?: { nodes: Node[]; edges: Edge[] }) => void;
}

const SQL_TYPES = ["serial", "integer", "bigint", "varchar", "text", "boolean", "timestamp", "date", "float", "decimal", "uuid", "char", "json", "jsonb"];
const RELATION_TYPES = ["One to One", "One to Many", "Many to One"];
const THEME_COLORS = [
  { name: "Lime", hex: "#C2EF4E" },
  { name: "Purple", hex: "#6A5FC1" },
  { name: "Coral", hex: "#FF6B6B" },
  { name: "Slate", hex: "#64748b" },
  { name: "Blue", hex: "#4A90D9" },
  { name: "Orange", hex: "#f97316" },
  { name: "Emerald", hex: "#10B981" },
];
const COL_COLORS = ["", "#C2EF4E", "#6A5FC1", "#FF6B6B", "#4A90D9", "#f97316", "#10B981"];

function mapRelationType(ui: string | undefined): string {
  if (ui === "One to One") return "one-to-one";
  if (ui === "Many to One") return "many-to-one";
  return "one-to-many";
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out outline-none ${
        checked ? "bg-[#2b79c9]" : "bg-slate-300 dark:bg-white/20"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
          checked ? "translate-x-3.5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function TableEditorModal({
  isOpen,
  tableNodeId,
  nodes,
  setNodes,
  edges,
  setEdges,
  onClose,
  takeSnapshot,
}: TableEditorModalProps) {
  const [tableName, setTableName] = useState("new_table");
  const [tableColor, setTableColor] = useState("#C2EF4E");
  const [tableGroup, setTableGroup] = useState("");
  const [tableComment, setTableComment] = useState("");
  const [columns, setColumns] = useState<NodeAttribute[]>([
    { name: "id", type: "integer", isPk: true, isFk: false, allowNull: false, unique: true, autoIncrement: true, color: "" },
  ]);
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [constraints, setConstraints] = useState<TableConstraint[]>([]);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [nameError, setNameError] = useState("");
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen && tableNodeId && tableNodeId !== "new") {
      const node = nodes.find((n) => n.id === tableNodeId);
      if (node) {
        const data = node.data as any;
        setTableName(data.label || "");
        setTableColor(data.color || "#C2EF4E");
        setTableGroup(data.group || "");
        setTableComment(data.comment || "");
        setColumns(
          ((data.attributes as any[]) || []).map((attr) => ({
            name: attr.name || "",
            type: attr.type || "varchar",
            isPk: !!attr.isPk,
            isFk: !!attr.isFk,
            size: attr.size || "",
            defaultVal: attr.defaultVal || "",
            allowNull: attr.allowNull !== undefined ? attr.allowNull : !attr.isPk,
            unique: !!attr.unique,
            autoIncrement: !!attr.autoIncrement,
            color: attr.color || "",
            comment: attr.comment || "",
            fkRefTable: attr.fkRefTable || "",
            fkRefField: attr.fkRefField || "",
            fkRelationType: attr.fkRelationType || "Many to One",
          }))
        );
        setIndexes(data.indexes || []);
        setConstraints(data.constraints || []);
        setNameError("");
      }
    } else if (isOpen && tableNodeId === "new") {
      let count = 1;
      while (nodes.some((n) => n.data.label === `table_${count}`)) count++;
      setTableName(`table_${count}`);
      setTableColor("#C2EF4E");
      setTableGroup("");
      setTableComment("");
      setColumns([
        { name: "id", type: "integer", isPk: true, isFk: false, allowNull: false, unique: true, autoIncrement: true, color: "" },
      ]);
      setIndexes([]);
      setConstraints([]);
      setNameError("");
    }
  }, [isOpen, tableNodeId, nodes]);

  if (!isOpen) return null;

  // ── Column Handlers ──
  const handleAddColumn = () => {
    setColumns([
      ...columns,
      {
        name: `field_${columns.length + 1}`,
        type: "varchar",
        isPk: false,
        isFk: false,
        allowNull: true,
        unique: false,
        autoIncrement: false,
        color: "",
      },
    ]);
  };

  const handleUpdateColumn = (idx: number, key: keyof NodeAttribute, val: any) => {
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const updated = { ...c, [key]: val };
        if (key === "isFk" && !val) {
          updated.fkRefTable = "";
          updated.fkRefField = "";
          updated.fkRelationType = "Many to One";
        }
        if (key === "isPk" && val) {
          updated.allowNull = false;
          updated.unique = true;
        }
        return updated;
      })
    );
  };

  const handleRemoveColumn = (idx: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleReorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setColumns((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // ── Index Handlers ──
  const handleAddIndex = () => {
    setIndexes([
      ...indexes,
      {
        name: `idx_${tableName || "table"}_${indexes.length + 1}`,
        columns: [columns[0]?.name || "id"],
        type: "btree",
        isUnique: false,
      },
    ]);
  };

  const handleUpdateIndex = (idx: number, key: keyof TableIndex, val: any) => {
    setIndexes((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: val } : item)));
  };

  const handleRemoveIndex = (idx: number) => {
    setIndexes((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Constraint Handlers ──
  const handleAddConstraint = () => {
    setConstraints([
      ...constraints,
      {
        name: `chk_${tableName || "table"}_${constraints.length + 1}`,
        type: "CHECK",
        expression: "",
      },
    ]);
  };

  const handleUpdateConstraint = (idx: number, key: keyof TableConstraint, val: any) => {
    setConstraints((prev) => prev.map((chk, i) => (i === idx ? { ...chk, [key]: val } : chk)));
  };

  const handleRemoveConstraint = (idx: number) => {
    setConstraints((prev) => prev.filter((_, i) => i !== idx));
  };

  const buildAttrPayload = (c: NodeAttribute) => ({
    name: c.name,
    type: c.type,
    isPk: c.isPk,
    isFk: c.isFk,
    size: c.size,
    defaultVal: c.defaultVal,
    allowNull: c.allowNull,
    unique: c.unique,
    autoIncrement: c.autoIncrement,
    color: c.color,
    comment: c.comment,
    fkRefTable: c.fkRefTable,
    fkRefField: c.fkRefField,
    fkRelationType: c.fkRelationType,
  });

  const buildFkEdges = (childNodeId: string): { edges: Edge[]; misses: string[] } => {
    const list: Edge[] = [];
    const misses: string[] = [];
    columns.forEach((c, idx) => {
      if (!c.isFk || !c.fkRefTable) return;
      const parentNode = nodes.find((n) => n.data.label === c.fkRefTable);
      if (!parentNode) {
        misses.push(c.fkRefTable);
        return;
      }
      list.push({
        id: `edge-${childNodeId}-${c.name}-${Date.now()}-${idx}`,
        source: parentNode.id,
        target: childNodeId,
        type: "crowsFoot",
        data: {
          relationshipType: mapRelationType(c.fkRelationType),
          foreignKey: c.name,
          referencedKey: c.fkRefField || "id",
          targetColumn: c.name,
          sourceColumn: c.fkRefField || "id",
        },
      });
    });
    return { edges: list, misses };
  };

  const handleSave = () => {
    const finalTableName = tableName.trim();
    if (!finalTableName) {
      setNameError("Table name is required.");
      return;
    }
    const nameClash = nodes.some(
      (n) => n.type === "tableMode" && n.id !== tableNodeId && (n.data.label as string) === finalTableName
    );
    if (nameClash) {
      setNameError(`A table named "${finalTableName}" already exists.`);
      return;
    }
    setNameError("");

    const ourFkNames = new Set(columns.filter((c) => c.isFk && c.name).map((c) => c.name));

    const filterOwnedChildEdges = (eds: Edge[], childId: string) =>
      eds.filter((e) => {
        const fk = (e.data as any)?.foreignKey as string | undefined;
        if (fk && ourFkNames.has(fk) && (e.source === childId || e.target === childId)) {
          return false;
        }
        if (!fk && e.target === childId) return false;
        return true;
      });

    if (tableNodeId === "new") {
      const newNodeId = `table_${Date.now()}`;
      const offset = nodes.length * 50;
      const newNode: Node = {
        id: newNodeId,
        type: "tableMode",
        position: { x: 100 + offset, y: 100 + offset },
        data: {
          label: finalTableName,
          color: tableColor,
          group: tableGroup,
          comment: tableComment,
          attributes: columns.map(buildAttrPayload),
          indexes,
          constraints,
        },
      };
      const nextNodes = [...nodes, newNode];
      const { edges: newEdgesList } = buildFkEdges(newNodeId);
      const nextEdges = [...edges, ...newEdgesList];
      setNodes(nextNodes);
      setEdges(nextEdges);
      takeSnapshot({ nodes: nextNodes, edges: nextEdges });
    } else {
      const nextNodes = nodes.map((n) => {
        if (n.id !== tableNodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            label: finalTableName,
            color: tableColor,
            group: tableGroup,
            comment: tableComment,
            attributes: columns.map(buildAttrPayload),
            indexes,
            constraints,
          },
        };
      });

      const { edges: updatedEdgesList } = buildFkEdges(tableNodeId as string);
      const preserved = filterOwnedChildEdges(edges, tableNodeId as string);
      const nextEdges = [...preserved, ...updatedEdgesList];

      setNodes(nextNodes);
      setEdges(nextEdges);
      takeSnapshot({ nodes: nextNodes, edges: nextEdges });
    }

    onClose();
  };

  const otherTables = nodes.filter((n) => n.type === "tableMode" && n.id !== tableNodeId);

  return (
    <div className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-md flex items-center justify-center p-6 select-none">
      <div className="w-[94vw] max-w-6xl h-[88vh] bg-[#f8fafc] dark:bg-[#0c101b] rounded-2xl border border-slate-200 dark:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-white">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-7 py-4.5 border-b border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#080c14] shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold tracking-wide">
              {tableNodeId === "new" ? "Add Table: " : "Edit Table: "}
              <span className="text-[#2b79c9] dark:text-[#4A90D9]">{tableName || "Untitled"}</span>
            </h2>
            <div className="relative">
              <button
                onClick={() => setColorPickerOpen(!colorPickerOpen)}
                className="w-5 h-5 rounded-full border border-white/20 transition-transform hover:scale-110 shadow-sm"
                style={{ backgroundColor: tableColor }}
                title="Select header color"
              />
              {colorPickerOpen && (
                <div className="absolute left-0 top-full mt-2 bg-white dark:bg-[#0D1117] border border-slate-200 dark:border-white/[0.1] rounded-xl p-2 flex gap-2 z-50 shadow-2xl">
                  {THEME_COLORS.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => {
                        setTableColor(c.hex);
                        setColorPickerOpen(false);
                      }}
                      className="w-5 h-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c.hex }}
                      title={c.name}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-8 scrollbar-thin">
          
          {/* ─── TABLE NAME & GROUP ─── */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 dark:text-white/50 uppercase tracking-wider font-semibold">Table Name</label>
                <input
                  type="text"
                  value={tableName}
                  onChange={(e) => {
                    setTableName(e.target.value);
                    setNameError("");
                  }}
                  placeholder="e.g. orders"
                  className={`w-full bg-white dark:bg-white/[0.02] border rounded-xl px-4 py-2.5 text-xs outline-none focus:border-[#4A90D9] transition-all font-sans ${
                    nameError ? "border-red-500/50" : "border-slate-300 dark:border-white/[0.08]"
                  }`}
                />
                {nameError && <p className="text-[10px] text-red-500">{nameError}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 dark:text-white/50 uppercase tracking-wider font-semibold">Table Group (Schema Namespace)</label>
                <input
                  type="text"
                  value={tableGroup}
                  onChange={(e) => setTableGroup(e.target.value)}
                  placeholder="e.g. Auth, Public"
                  className="w-full bg-white dark:bg-white/[0.02] border border-slate-300 dark:border-white/[0.08] rounded-xl px-4 py-2.5 text-xs outline-none focus:border-[#4A90D9] transition-all font-sans"
                />
              </div>
            </div>
          </div>

          {/* ─── TABLE STRUCTURE (FIELDS) ─── */}
          <div className="pt-2">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/[0.06] pb-3 mb-4">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white/90 tracking-wide flex items-center gap-2">
                <Database size={15} className="text-[#4A90D9]" />
                Table Structure
              </h3>
              <button
                onClick={handleAddColumn}
                className="px-4 py-1.5 rounded-lg bg-[#2b79c9] hover:bg-[#1d68b8] text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus size={13} />
                ADD FIELD
              </button>
            </div>

            <div className="space-y-4">
              {columns.map((col, idx) => (
                <div
                  key={idx}
                  draggable
                  onDragStart={() => { dragFrom.current = idx; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragFrom.current !== null) handleReorder(dragFrom.current, idx);
                    dragFrom.current = null;
                  }}
                  className="bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 space-y-4 shadow-sm hover:border-[#4A90D9]/40 transition-all relative group"
                >
                  {/* Field Header */}
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.04] pb-2.5">
                    <div className="flex items-center gap-2">
                      <GripVertical size={14} className="text-slate-400 dark:text-white/30 cursor-grab active:cursor-grabbing" />
                      <span className="font-bold text-xs text-slate-800 dark:text-white">
                        {col.name || `field_${idx + 1}`}
                      </span>
                      {col.isPk && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 font-bold">PK</span>}
                      {col.isFk && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-bold">FK</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAddColumn()}
                        className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-white/[0.06] text-slate-400 dark:text-white/40 hover:text-slate-700 dark:hover:text-white transition-all"
                        title="Add Field"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={() => handleRemoveColumn(idx)}
                        disabled={columns.length === 1}
                        className="p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 dark:text-white/40 hover:text-red-500 transition-all disabled:opacity-20"
                        title="Delete field"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Field Input Controls */}
                  <div className="grid grid-cols-12 gap-4 items-end">
                    {/* Name */}
                    <div className="col-span-3 space-y-1">
                      <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">NAME</label>
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) => handleUpdateColumn(idx, "name", e.target.value)}
                        placeholder="field_name"
                        className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                      />
                    </div>

                    {/* Type */}
                    <div className="col-span-3 space-y-1">
                      <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">TYPE</label>
                      <select
                        value={col.type}
                        onChange={(e) => handleUpdateColumn(idx, "type", e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                      >
                        {SQL_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>

                    {/* Color */}
                    <div className="col-span-1 space-y-1 text-center">
                      <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider block">COLOR</label>
                      <select
                        value={col.color || ""}
                        onChange={(e) => handleUpdateColumn(idx, "color", e.target.value)}
                        className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-1 py-2 text-xs outline-none"
                      >
                        {COL_COLORS.map((hex) => (
                          <option key={hex || "none"} value={hex}>{hex ? "●" : "—"}</option>
                        ))}
                      </select>
                    </div>

                    {/* Size */}
                    <div className="col-span-2 space-y-1">
                      <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">SIZE</label>
                      <input
                        type="text"
                        value={col.size || ""}
                        onChange={(e) => handleUpdateColumn(idx, "size", e.target.value)}
                        placeholder="255"
                        className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none text-center focus:border-[#4A90D9]"
                      />
                    </div>

                    {/* Default */}
                    <div className="col-span-3 space-y-1">
                      <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">DEFAULT</label>
                      <input
                        type="text"
                        value={col.defaultVal || ""}
                        onChange={(e) => handleUpdateColumn(idx, "defaultVal", e.target.value)}
                        placeholder="NULL"
                        className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                      />
                    </div>
                  </div>

                  {/* Switches Row */}
                  <div className="flex items-center gap-6 pt-2 border-t border-slate-100 dark:border-white/[0.03] text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch checked={!!col.isPk} onChange={() => handleUpdateColumn(idx, "isPk", !col.isPk)} />
                      <span className="text-slate-700 dark:text-white/80 font-medium text-[11px]">Primary Key</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch
                        checked={col.allowNull !== undefined ? col.allowNull : !col.isPk}
                        onChange={() => handleUpdateColumn(idx, "allowNull", !(col.allowNull !== undefined ? col.allowNull : !col.isPk))}
                      />
                      <span className="text-slate-700 dark:text-white/80 font-medium text-[11px]">Allow nulls</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch checked={!!col.unique} onChange={() => handleUpdateColumn(idx, "unique", !col.unique)} />
                      <span className="text-slate-700 dark:text-white/80 font-medium text-[11px]">Unique</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch checked={!!col.autoIncrement} onChange={() => handleUpdateColumn(idx, "autoIncrement", !col.autoIncrement)} />
                      <span className="text-slate-700 dark:text-white/80 font-medium text-[11px]">Auto Increment</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <Switch checked={!!col.isFk} onChange={() => handleUpdateColumn(idx, "isFk", !col.isFk)} />
                      <span className="text-slate-700 dark:text-white/80 font-medium text-[11px]">Foreign Key</span>
                    </label>
                  </div>

                  {/* Foreign Key Settings (if active) */}
                  {col.isFk && (
                    <div className="grid grid-cols-3 gap-4 pt-3 bg-slate-50 dark:bg-white/[0.02] p-4 rounded-xl border border-slate-200 dark:border-white/[0.05]">
                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-semibold text-slate-400 dark:text-white/40">Ref Table</label>
                        <select
                          value={col.fkRefTable || ""}
                          onChange={(e) => {
                            const selectedTable = e.target.value;
                            const targetNode = nodes.find((n) => n.data.label === selectedTable);
                            const targetFields = targetNode ? ((targetNode.data.attributes as any[]) || []).map((a) => a.name) : [];
                            handleUpdateColumn(idx, "fkRefTable", selectedTable);
                            const defaultRefField = targetFields.find((f) => f === "id" || f === "uuid") || targetFields[0] || "";
                            handleUpdateColumn(idx, "fkRefField", defaultRefField);
                          }}
                          className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs"
                        >
                          <option value="">Select table...</option>
                          {otherTables.map((t) => (
                            <option key={t.id} value={t.data.label as string}>{t.data.label as string}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-semibold text-slate-400 dark:text-white/40">Ref Field</label>
                        <select
                          value={col.fkRefField || ""}
                          onChange={(e) => handleUpdateColumn(idx, "fkRefField", e.target.value)}
                          className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs"
                        >
                          <option value="">Select field...</option>
                          {col.fkRefTable && (() => {
                            const targetNode = nodes.find((n) => n.data.label === col.fkRefTable);
                            const targetFields = targetNode ? ((targetNode.data.attributes as any[]) || []).map((a) => a.name) : [];
                            return targetFields.map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ));
                          })()}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[9px] uppercase font-semibold text-slate-400 dark:text-white/40">Relation Type</label>
                        <select
                          value={col.fkRelationType || "Many to One"}
                          onChange={(e) => handleUpdateColumn(idx, "fkRelationType", e.target.value)}
                          className="w-full bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs"
                        >
                          {RELATION_TYPES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Comment Field */}
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase font-semibold text-slate-400 dark:text-white/40 tracking-wider">FIELD COMMENT</label>
                    <input
                      type="text"
                      value={col.comment || ""}
                      onChange={(e) => handleUpdateColumn(idx, "comment", e.target.value)}
                      placeholder="e.g. Primary key."
                      className="w-full bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#4A90D9]"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Add Field Bottom Text Button */}
            <button
              onClick={handleAddColumn}
              className="w-full mt-4 py-2.5 border-2 border-dashed border-slate-200 dark:border-white/[0.08] hover:border-[#4A90D9] rounded-xl flex items-center justify-center gap-1.5 text-xs font-bold text-[#4A90D9] hover:bg-[#4A90D9]/5 transition-all uppercase tracking-wider"
            >
              <Plus size={14} />
              ADD FIELD
            </button>
          </div>

          {/* ─── INDEXES SECTION ─── */}
          <div className="pt-6 border-t border-slate-200 dark:border-white/[0.06] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white/90 tracking-wide flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-[#4A90D9]" />
                Indexes
              </h3>
              <button
                onClick={handleAddIndex}
                className="px-4 py-1.5 rounded-lg bg-[#2b79c9] hover:bg-[#1d68b8] text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus size={13} />
                ADD INDEX
              </button>
            </div>

            {indexes.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-white/30 italic">No indexes defined for this table.</p>
            ) : (
              <div className="space-y-4">
                {indexes.map((idxItem, idxIndex) => (
                  <div
                    key={idxIndex}
                    className="bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 space-y-3 shadow-sm relative"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.04] pb-2">
                      <span className="font-bold text-xs text-slate-700 dark:text-white/80">
                        Index {idxIndex + 1}
                      </span>
                      <button
                        onClick={() => handleRemoveIndex(idxIndex)}
                        className="p-1 rounded-md text-slate-400 hover:text-red-500 transition-all"
                        title="Delete index"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Index Name */}
                      <div className="col-span-6 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">NAME</label>
                        <input
                          type="text"
                          value={idxItem.name}
                          onChange={(e) => handleUpdateIndex(idxIndex, "name", e.target.value)}
                          placeholder="e.g. idx_orders_customer_id"
                          className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                        />
                      </div>

                      {/* Target Columns */}
                      <div className="col-span-6 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">COLUMNS</label>
                        <input
                          type="text"
                          value={Array.isArray(idxItem.columns) ? idxItem.columns.join(", ") : idxItem.columns || ""}
                          onChange={(e) =>
                            handleUpdateIndex(
                              idxIndex,
                              "columns",
                              e.target.value.split(",").map((c) => c.trim())
                            )
                          }
                          placeholder="e.g. customer_id, order_date"
                          className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                        />
                      </div>

                      {/* Method / Type */}
                      <div className="col-span-6 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">METHOD</label>
                        <select
                          value={idxItem.type || "btree"}
                          onChange={(e) => handleUpdateIndex(idxIndex, "type", e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                        >
                          <option value="btree">btree</option>
                          <option value="hash">hash</option>
                          <option value="gist">gist</option>
                          <option value="gin">gin</option>
                        </select>
                      </div>

                      {/* Unique Switch */}
                      <div className="col-span-6 flex items-center gap-3 pt-3">
                        <Switch
                          checked={!!idxItem.isUnique}
                          onChange={() => handleUpdateIndex(idxIndex, "isUnique", !idxItem.isUnique)}
                        />
                        <span className="text-xs font-semibold text-slate-700 dark:text-white/80">Unique Index</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── CONSTRAINTS SECTION ─── */}
          <div className="pt-6 border-t border-slate-200 dark:border-white/[0.06] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white/90 tracking-wide flex items-center gap-2">
                <ShieldAlert size={15} className="text-[#4A90D9]" />
                Constraints
              </h3>
              <button
                onClick={handleAddConstraint}
                className="px-4 py-1.5 rounded-lg bg-[#2b79c9] hover:bg-[#1d68b8] text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
              >
                <Plus size={13} />
                ADD CONSTRAINT
              </button>
            </div>

            {constraints.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-white/30 italic">No constraints defined for this table.</p>
            ) : (
              <div className="space-y-4">
                {constraints.map((chk, idxChk) => (
                  <div
                    key={idxChk}
                    className="bg-white dark:bg-[#080d1a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 space-y-3 shadow-sm relative"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/[0.04] pb-2">
                      <span className="font-bold text-xs text-slate-700 dark:text-white/80">
                        Constraint {idxChk + 1}
                      </span>
                      <button
                        onClick={() => handleRemoveConstraint(idxChk)}
                        className="p-1 rounded-md text-slate-400 hover:text-red-500 transition-all"
                        title="Delete constraint"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="grid grid-cols-12 gap-4 items-center">
                      {/* Constraint Name */}
                      <div className="col-span-6 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">NAME</label>
                        <input
                          type="text"
                          value={chk.name}
                          onChange={(e) => handleUpdateConstraint(idxChk, "name", e.target.value)}
                          placeholder="e.g. chk_orders_amount"
                          className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                        />
                      </div>

                      {/* Constraint Type */}
                      <div className="col-span-6 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">TYPE</label>
                        <select
                          value={chk.type || "CHECK"}
                          onChange={(e) => handleUpdateConstraint(idxChk, "type", e.target.value)}
                          className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9]"
                        >
                          <option value="CHECK">CHECK</option>
                          <option value="UNIQUE">UNIQUE</option>
                          <option value="EXCLUSION">EXCLUSION</option>
                        </select>
                      </div>

                      {/* Expression / Definition */}
                      <div className="col-span-12 space-y-1">
                        <label className="text-[9px] font-semibold uppercase text-slate-400 dark:text-white/40 tracking-wider">DEFINITION / EXPRESSION</label>
                        <textarea
                          value={chk.expression || ""}
                          onChange={(e) => handleUpdateConstraint(idxChk, "expression", e.target.value)}
                          placeholder="e.g. amount > 0 AND quantity >= 1"
                          rows={2}
                          className="w-full bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-[#4A90D9] resize-none font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Table Comment */}
          <div className="pt-6 border-t border-slate-200 dark:border-white/[0.06] space-y-1.5">
            <label className="text-[10px] text-slate-500 dark:text-white/50 uppercase tracking-wider font-semibold">Table Comment</label>
            <textarea
              value={tableComment}
              onChange={(e) => setTableComment(e.target.value)}
              placeholder="e.g. Order header (belongs to a customer)."
              rows={2}
              className="w-full bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.08] rounded-xl p-3 text-xs outline-none focus:border-[#4A90D9] transition-all resize-none"
            />
          </div>
        </div>

        {/* Footer with SAVE and CANCEL on bottom left */}
        <div className="flex items-center justify-start gap-3 px-7 py-4 border-t border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#080c14] shrink-0">
          <button
            onClick={handleSave}
            className="px-7 py-2.5 rounded-xl bg-[#2b79c9] hover:bg-[#1d68b8] text-white text-xs font-bold shadow-md hover:shadow-lg transition-all"
          >
            SAVE
          </button>
          <button
            onClick={onClose}
            className="px-7 py-2.5 rounded-xl border border-slate-300 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.03] text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-xs font-semibold transition-all"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}
