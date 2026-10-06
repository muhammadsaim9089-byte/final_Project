"use client";

import React, { useMemo } from "react";
import { Eye, EyeOff, Paintbrush, Wand2 } from "lucide-react";
import { ModalShell, btnGhost, btnPrimary } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { NO_COLOR_TOKEN } from "@/lib/model/displayGraph";

/** Object colour coding: see which colours are used and show / hide tables by colour (ERDLab). */
export function ColorsModal({ onClose }: { onClose: () => void }) {
  const layout = useLayout();
  const api = layout.getCanvasApi();
  const hidden = new Set(layout.meta.hiddenColors.map((c) => c.toLowerCase()));

  const colors = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of api?.getState().nodes || []) {
      if (n.type !== "tableMode") continue;
      const c = String((n.data as any).color || "").trim().toLowerCase() || NO_COLOR_TOKEN;
      map.set(c, [...(map.get(c) || []), String((n.data as any).label)]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (c: string) => layout.setMeta((m) => ({ ...m, hiddenColors: hidden.has(c) ? m.hiddenColors.filter((x) => x.toLowerCase() !== c) : [...m.hiddenColors, c] }));

  const colorByGroup = () => {
    if (!api) return;
    const { nodes, edges, meta } = api.getState();
    let n = 0;
    const next = nodes.map((node) => {
      const g = (node.data as any).group;
      const gc = g && meta.groups[g]?.color;
      if (node.type === "tableMode" && gc && (node.data as any).color !== gc) {
        n++;
        return { ...node, data: { ...node.data, color: gc } };
      }
      return node;
    });
    api.setGraph({ nodes: next, edges, meta });
    showToast(n ? `Coloured ${n} table(s) by their group` : "No grouped tables with a colour", n ? "success" : "validate");
    onClose();
  };

  return (
    <ModalShell title="Colours" subtitle="Show or hide tables by header colour" icon={<Paintbrush size={16} />} onClose={onClose} width="max-w-lg" height="h-[62vh]">
      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {colors.length === 0 && <p className="text-center text-white/35 text-sm py-10">No tables yet.</p>}
        {colors.map(([c, tables]) => {
          const isHidden = hidden.has(c);
          return (
            <div key={c} className={`flex items-center gap-3 p-3 rounded-xl border ${isHidden ? "border-white/[0.05] bg-white/[0.01] opacity-60" : "border-white/[0.08] bg-white/[0.03]"}`}>
              <span className="w-6 h-6 rounded-full border border-white/20 shrink-0" style={{ background: c === NO_COLOR_TOKEN ? "transparent" : c }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold">{c === NO_COLOR_TOKEN ? "No colour" : c}</div>
                <div className="text-[10.5px] text-white/40 truncate">
                  {tables.length} table{tables.length > 1 ? "s" : ""}: {tables.slice(0, 5).join(", ")}
                  {tables.length > 5 ? "…" : ""}
                </div>
              </div>
              <button className={btnGhost} onClick={() => toggle(c)} title={isHidden ? "Show these tables" : "Hide these tables"}>
                {isHidden ? <EyeOff size={14} /> : <Eye size={14} className="text-[#4A90D9]" />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="p-4 border-t border-white/[0.07] flex gap-2 shrink-0">
        <button className={btnGhost} onClick={colorByGroup}>
          <Wand2 size={13} /> Colour tables by group
        </button>
        {hidden.size > 0 && (
          <button className={btnPrimary} onClick={() => layout.setMeta((m) => ({ ...m, hiddenColors: [] }))}>
            <Eye size={13} /> Show all
          </button>
        )}
      </div>
    </ModalShell>
  );
}
