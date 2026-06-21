"use client";

import { useState } from "react";
import { PlusSquare, X } from "lucide-react";
import { Node } from "@xyflow/react";

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
  const [tableName, setTableName] = useState("");
  const [templateType, setTemplateType] = useState<"blank" | "users" | "products" | "view">("blank");
  const [colCount, setColCount] = useState(3);
  
  // View specific fields
  const [sourceTable, setSourceTable] = useState("");
  const [expression, setExpression] = useState("");

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

  const handleCreateTable = () => {
    let name = uniqueName(tableName.trim() || "new_table");
    let attrs: NodeAttribute[] = [];

    if (templateType === "blank") {
      attrs.push({ name: "id", type: "serial", isPk: true, isFk: false });
      for (let i = 1; i <= colCount; i++) {
        attrs.push({ name: `col_${i}`, type: "varchar(255)", isPk: false, isFk: false });
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
    if (templateType === "view") {
      setSourceTable("");
      setExpression("");
    }
  };

  return (
    <div className="absolute right-6 top-24 bottom-6 w-[300px] z-40 bg-[#060B15]/90 backdrop-blur-xl border border-white/[0.08] flex flex-col pointer-events-auto rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] animate-in fade-in slide-in-from-right-4 duration-300">
      
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold flex items-center gap-2 tracking-tight">
            <PlusSquare size={16} className="text-[#4A90D9] drop-shadow-[0_0_8px_rgba(74,144,217,0.4)]" />
            <span className="text-white">Add Table</span>
          </h2>
          <span className="text-[9px] text-white/40 font-mono tracking-[0.2em] uppercase mt-1 block">Schema Designer</span>
        </div>
        <button 
          onClick={onClose} 
          className="p-1.5 text-white/40 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
        >
          <X size={15} />
        </button>
      </div>
      
      <div className="mx-5 h-px bg-white/[0.06]" />

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 p-scrollbar">
        
        {/* Dynamic creation form */}
        <div className="space-y-5">
          
          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Table Name</label>
            <input 
              value={tableName} 
              onChange={e => setTableName(e.target.value)} 
              placeholder="e.g. order_items"
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all" 
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Template</label>
            <div className="relative">
              <select 
                value={templateType} 
                onChange={e => setTemplateType(e.target.value as any)}
                className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50 transition-all"
              >
                <option value="blank">Blank Table</option>
                <option value="users">Users Template</option>
                <option value="products">Products Template</option>
                <option value="view">SQL View (Computed)</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-[10px]">▼</div>
            </div>
          </div>

          {templateType === "blank" && (
            <div className="flex items-center justify-between bg-white/[0.01] border border-white/[0.04] rounded-lg p-2.5 px-3">
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
          )}

          {templateType === "view" && (
            <>
              <div className="space-y-1.5">
                <label className="text-[10px] text-white/40 uppercase font-mono tracking-wider">Source Table</label>
                <div className="relative">
                  <select 
                    value={sourceTable} 
                    onChange={e => setSourceTable(e.target.value)}
                    className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
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
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all resize-none h-16 p-scrollbar" 
                />
              </div>
            </>
          )}

          <div className="pt-2">
            <button 
              onClick={handleCreateTable} 
              className="w-full py-2.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(74,144,217,0.2)]"
            >
              {templateType === "view" ? "Create View" : "Create Table"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
