"use client";

import { useState, useRef, useEffect } from "react";
import { NodeProps, NodeResizer, useReactFlow } from "@xyflow/react";
import { Trash2, Edit2 } from "lucide-react";

const GROUP_COLORS = [
  { name: "Blue", bg: "bg-[#0c1e3a]/40", border: "border-[#4A90D9]/40", text: "text-[#4A90D9]", labelBg: "bg-[#4A90D9]/10" },
  { name: "Purple", bg: "bg-[#25133c]/40", border: "border-[#8B5CF6]/40", text: "text-[#8B5CF6]", labelBg: "bg-[#8B5CF6]/10" },
  { name: "Emerald", bg: "bg-[#062c1e]/40", border: "border-[#10B981]/40", text: "text-[#10B981]", labelBg: "bg-[#10B981]/10" },
  { name: "Coral", bg: "bg-[#331111]/40", border: "border-[#F87171]/40", text: "text-[#F87171]", labelBg: "bg-[#F87171]/10" },
  { name: "Amber", bg: "bg-[#2c1d05]/40", border: "border-[#F59E0B]/40", text: "text-[#F59E0B]", labelBg: "bg-[#F59E0B]/10" },
];

export function TableGroupNode({ id, data, selected }: NodeProps) {
  const { setNodes, deleteElements } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState((data.label as string) || "New Group");
  const inputRef = useRef<HTMLInputElement>(null);

  const colorIndex = typeof data.colorIndex === "number" ? data.colorIndex : 0;
  const colorTheme = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
  const groupLabel = (data.label as string) || "Table Group";

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const commitEdit = () => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, label: editText } } : n
      )
    );
    setIsEditing(false);
  };

  const cycleColor = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextIndex = (colorIndex + 1) % GROUP_COLORS.length;
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, colorIndex: nextIndex } } : n
      )
    );
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteElements({ nodes: [{ id }] });
  };

  return (
    <div
      className={`w-full h-full min-w-[200px] min-h-[150px] rounded-2xl border-2 border-dashed ${colorTheme.bg} ${colorTheme.border} transition-all duration-300 relative group flex flex-col`}
    >
      {/* React Flow Resizer handles resizing */}
      <NodeResizer
        color="#4A90D9"
        minWidth={200}
        minHeight={150}
        isVisible={!!selected}
        lineClassName="border-blue-400"
        handleClassName="w-3 h-3 bg-blue-500 border-2 border-white rounded-full"
      />

      {/* Group Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/[0.04] bg-white/[0.01] rounded-t-2xl drag-handle shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                ref={inputRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsEditing(false);
                  if (e.key === "Enter") commitEdit();
                }}
                className="bg-white/[0.06] border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-white font-semibold outline-none w-full font-sans"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className={`text-[10px] font-sans font-bold tracking-wider uppercase px-2 py-0.5 rounded ${colorTheme.labelBg} ${colorTheme.text} truncate`}>
                {groupLabel}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/5 text-white/40 hover:text-white transition-all shrink-0"
                title="Edit Group Name"
              >
                <Edit2 size={10} />
              </button>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Color Switcher */}
          <button
            onClick={cycleColor}
            className={`w-3.5 h-3.5 rounded-full border border-white/20 transition-transform hover:scale-115`}
            style={{
              backgroundColor:
                GROUP_COLORS[(colorIndex + 1) % GROUP_COLORS.length].border.includes("4A90D9")
                  ? "#3b82f6"
                  : GROUP_COLORS[(colorIndex + 1) % GROUP_COLORS.length].border.includes("8B5CF6")
                  ? "#8b5cf6"
                  : GROUP_COLORS[(colorIndex + 1) % GROUP_COLORS.length].border.includes("10B981")
                  ? "#10b981"
                  : GROUP_COLORS[(colorIndex + 1) % GROUP_COLORS.length].border.includes("F87171")
                  ? "#f87171"
                  : "#f59e0b",
            }}
            title="Change Group Color"
          />
          {/* Delete Group */}
          <button
            onClick={handleDelete}
            className="p-1 rounded hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors"
            title="Delete Group Outline"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Background/Inside area */}
      <div className="flex-1 pointer-events-none" />
    </div>
  );
}
