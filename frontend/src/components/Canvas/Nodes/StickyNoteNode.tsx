"use client";

import { useState, useRef, useEffect } from "react";
import { NodeProps, useReactFlow } from "@xyflow/react";
import { Trash2, GripVertical } from "lucide-react";

const NOTE_COLORS = [
  { name: "Yellow", bg: "bg-amber-300/90", border: "border-amber-400/60", text: "text-amber-950" },
  { name: "Blue", bg: "bg-sky-300/90", border: "border-sky-400/60", text: "text-sky-950" },
  { name: "Green", bg: "bg-emerald-300/90", border: "border-emerald-400/60", text: "text-emerald-950" },
  { name: "Pink", bg: "bg-pink-300/90", border: "border-pink-400/60", text: "text-pink-950" },
  { name: "Purple", bg: "bg-violet-300/90", border: "border-violet-400/60", text: "text-violet-950" },
];

export function StickyNoteNode(props: NodeProps) {
  const { data, id } = props;
  const { setNodes, deleteElements } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState((data.text as string) || "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const colorIndex = typeof data.colorIndex === "number" ? data.colorIndex : 0;
  const colorTheme = NOTE_COLORS[colorIndex % NOTE_COLORS.length];
  const noteText = (data.text as string) || "Double-click to edit...";

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const commitEdit = () => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, text: editText } } : n
      )
    );
    setIsEditing(false);
  };

  const cycleColor = () => {
    const nextIndex = (colorIndex + 1) % NOTE_COLORS.length;
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
      className={`relative group w-52 min-h-[80px] rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.25)] border ${colorTheme.bg} ${colorTheme.border} transition-all duration-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]`}
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Drag Handle & Actions */}
      <div className="absolute -top-0.5 left-0 right-0 flex items-center justify-between px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <GripVertical size={12} className={`${colorTheme.text} opacity-40 cursor-grab`} />
        <div className="flex items-center gap-1">
          {/* Color cycle */}
          <button
            onClick={cycleColor}
            className={`w-4 h-4 rounded-full border-2 border-white/50 shadow-sm transition-transform hover:scale-110`}
            style={{ backgroundColor: NOTE_COLORS[(colorIndex + 1) % NOTE_COLORS.length].bg.includes("amber") ? "#fbbf24" : NOTE_COLORS[(colorIndex + 1) % NOTE_COLORS.length].bg.includes("sky") ? "#38bdf8" : NOTE_COLORS[(colorIndex + 1) % NOTE_COLORS.length].bg.includes("emerald") ? "#34d399" : NOTE_COLORS[(colorIndex + 1) % NOTE_COLORS.length].bg.includes("pink") ? "#f472b6" : "#a78bfa" }}
            title="Change color"
          />
          {/* Delete */}
          <button
            onClick={handleDelete}
            className={`p-0.5 rounded hover:bg-black/10 ${colorTheme.text} opacity-60 hover:opacity-100 transition-all`}
            title="Delete note"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Note Content */}
      <div
        className="p-3.5 pt-4"
        onDoubleClick={() => {
          setEditText(noteText === "Double-click to edit..." ? "" : noteText);
          setIsEditing(true);
        }}
      >
        {isEditing ? (
          <textarea
            ref={textareaRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsEditing(false);
              }
              // Allow Enter for newlines, Ctrl+Enter to commit
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                commitEdit();
              }
            }}
            className={`w-full min-h-[60px] bg-transparent ${colorTheme.text} text-xs leading-relaxed resize-none outline-none placeholder:opacity-40`}
            placeholder="Type your note..."
          />
        ) : (
          <p className={`${colorTheme.text} text-xs leading-relaxed whitespace-pre-wrap break-words ${noteText === "Double-click to edit..." ? "opacity-50 italic" : ""}`}>
            {noteText}
          </p>
        )}
      </div>
    </div>
  );
}
