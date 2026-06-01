"use client";

import { useState } from "react";
import { PlusSquare, X, Check } from "lucide-react";
import { Node } from "@xyflow/react";

const QUICK_FIELDS = ["name", "email", "phone", "password", "address", "is_active", "created_at", "updated_at"];

interface LeftSidebarProps {
  nodes: Node[];
  setNodes: (updater: Node[] | ((nodes: Node[]) => Node[])) => void;
  onAutoLayout: () => void;
  autoLayout: boolean;
  onClose: () => void;
}

interface NodeAttribute {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
}

export function LeftSidebar({ nodes, setNodes, onAutoLayout, autoLayout, onClose }: LeftSidebarProps) {
  const [creationMode, setCreationMode] = useState<"inputs" | "transform" | "database">("inputs");
  const [tableName, setTableName] = useState("");
  const [quickFields, setQuickFields] = useState<string[]>(["name", "email"]);
  const [viewName, setViewName] = useState("");
  const [sourceTable, setSourceTable] = useState("");
  const [expression, setExpression] = useState("");
  const [colCount, setColCount] = useState(3);

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
  };

  const handleCreateInputs = () => {
    const name = uniqueName(tableName.trim() || "new_form");
    const attrs: NodeAttribute[] = [{ name: `${name}_id`, type: "serial", isPk: true, isFk: false }];
    quickFields.forEach(f => {
      const type = f.includes("is_") ? "boolean" : f.includes("_at") ? "timestamp" : "varchar(255)";
      attrs.push({ name: f, type, isPk: false, isFk: false });
    });
    addNode(name, attrs);
    setTableName("");
  };

  const handleCreateTransform = () => {
    const name = uniqueName(viewName.trim() || "computed_view");
    const attrs: NodeAttribute[] = [
      { name: "view_id", type: "serial", isPk: true, isFk: false },
      { name: "source_table", type: "varchar(100)", isPk: false, isFk: false },
      { name: "expression", type: "text", isPk: false, isFk: false },
    ];
    addNode(name, attrs);
    setViewName("");
    setSourceTable("");
    setExpression("");
  };

  const handleCreateDatabase = () => {
    const name = uniqueName(tableName.trim() || "new_table");
    const attrs: NodeAttribute[] = [{ name: "id", type: "serial", isPk: true, isFk: false }];
    for (let i = 1; i <= colCount; i++) attrs.push({ name: `col_${i}`, type: "varchar(255)", isPk: false, isFk: false });
    addNode(name, attrs);
    setTableName("");
  };

  const toggleQuickField = (f: string) => {
    setQuickFields(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  };

  return (
    <div className="absolute left-6 top-24 bottom-6 w-[300px] z-40 bg-[#060B15]/90 backdrop-blur-xl border border-white/[0.08] flex flex-col pointer-events-auto rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] animate-in fade-in slide-in-from-left-4 duration-300">
      
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold flex items-center gap-2 tracking-tight">
            <PlusSquare size={16} className="text-lime-green drop-shadow-[0_0_8px_rgba(194,239,78,0.4)]" />
            <span className="text-white">Create Elements</span>
          </h2>
          <span className="text-[9px] text-white/40 font-mono tracking-[0.2em] uppercase mt-1 block">Node Library</span>
        </div>
        <button 
          onClick={onClose} 
          className="p-1.5 text-white/40 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
        >
          <X size={15} />
        </button>
      </div>
      
      <div className="mx-5 h-px bg-white/[0.06]" />

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 p-scrollbar">
        {/* Toggle tabs */}
        <div className="flex gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-xl">
          {(["inputs", "transform", "database"] as const).map(mode => (
            <button 
              key={mode} 
              onClick={() => setCreationMode(mode)}
              className={`flex-1 text-[11px] py-2 rounded-lg font-medium transition-all capitalize ${
                creationMode === mode 
                  ? "bg-lime-green text-[#050B14] shadow-[0_4px_12px_rgba(194,239,78,0.25)] font-bold" 
                  : "text-white/50 hover:text-white hover:bg-white/[0.04]"
              }`}
            >
              {mode === "inputs" ? "Inputs" : mode === "transform" ? "Transform" : "Database"}
            </button>
          ))}
        </div>

        {/* Dynamic creation form */}
        <div className="bg-white/[0.02] rounded-xl border border-white/[0.06] p-4 space-y-4">
          
          {creationMode === "inputs" && (<>
            <div className="space-y-1.5">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Table Name</label>
              <input 
                value={tableName} 
                onChange={e => setTableName(e.target.value)} 
                placeholder="e.g. users_form"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-lime-green/40 focus:bg-white/[0.06] transition-all" 
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Quick-add Fields</label>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_FIELDS.map(f => {
                  const isSelected = quickFields.includes(f);
                  return (
                    <button 
                      key={f} 
                      onClick={() => toggleQuickField(f)}
                      className={`text-[10px] px-2.5 py-1 rounded-full border transition-all flex items-center gap-1 ${
                        isSelected 
                          ? "bg-lime-green/10 text-lime-green border-lime-green/30 font-medium" 
                          : "text-white/45 border-white/[0.06] hover:text-white/70 hover:bg-white/[0.03]"
                      }`}
                    >
                      {isSelected && <Check size={8} />}
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>

            <button 
              onClick={handleCreateInputs} 
              className="w-full py-2.5 bg-lime-green text-[#050B14] hover:bg-lime-green/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(194,239,78,0.2)]"
            >
              Create Input Table
            </button>
          </>)}

          {creationMode === "transform" && (<>
            <div className="space-y-1.5">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">View Name</label>
              <input 
                value={viewName} 
                onChange={e => setViewName(e.target.value)} 
                placeholder="e.g. revenue_view"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-sentry-purple/50 focus:bg-white/[0.06] transition-all" 
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Source Table</label>
              <div className="relative">
                <select 
                  value={sourceTable} 
                  onChange={e => setSourceTable(e.target.value)}
                  className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white outline-none appearance-none cursor-pointer focus:border-sentry-purple/50"
                >
                  <option value="">Select source table...</option>
                  {nodes.map(n => (
                    <option key={n.id} value={n.data.label as string}>
                      {n.data.label as string}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-[10px]">▼</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Expression / Filter</label>
              <textarea 
                value={expression} 
                onChange={e => setExpression(e.target.value)} 
                placeholder="e.g. status = 'active'"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-sentry-purple/50 focus:bg-white/[0.06] transition-all resize-none h-16 p-scrollbar" 
              />
            </div>

            <button 
              onClick={handleCreateTransform} 
              className="w-full py-2.5 bg-sentry-purple text-white hover:bg-sentry-purple/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(106,95,193,0.2)]"
            >
              Create Computed View
            </button>
          </>)}

          {creationMode === "database" && (<>
            <div className="space-y-1.5">
              <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Table Name</label>
              <input 
                value={tableName} 
                onChange={e => setTableName(e.target.value)} 
                placeholder="e.g. order_items"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-white/30 focus:bg-white/[0.06] transition-all" 
              />
            </div>

            <div className="flex items-center justify-between bg-white/[0.02] border border-white/[0.04] rounded-lg p-2 px-3">
              <span className="text-[11px] text-white/50">Initial Columns:</span>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setColCount(Math.max(1, colCount - 1))} 
                  className="w-6 h-6 rounded bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] text-xs flex items-center justify-center transition-colors"
                >
                  -
                </button>
                <span className="text-[12px] text-white font-mono w-5 text-center font-bold">{colCount}</span>
                <button 
                  onClick={() => setColCount(Math.min(10, colCount + 1))} 
                  className="w-6 h-6 rounded bg-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.1] text-xs flex items-center justify-center transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <button 
              onClick={handleCreateDatabase} 
              className="w-full py-2.5 bg-white/10 text-white hover:bg-white/15 text-[11px] font-bold rounded-lg border border-white/[0.08] transition-all"
            >
              Create Table
            </button>
          </>)}

        </div>
      </div>
    </div>
  );
}

