"use client";

import React, { useMemo, useState } from "react";
import { LayoutTemplate, Plus, Search, Wand2 } from "lucide-react";
import { btnGhost, btnPrimary, inputCls } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { DiagramTemplate, TEMPLATE_CATEGORIES, searchTemplates } from "@/lib/templates";
import { parseDbml } from "@/lib/dbml/parser";
import { layoutModel } from "@/lib/model/autoLayout";
import { renderSvg } from "@/lib/export/svgRenderer";
import { applyTemplate } from "./applyTemplate";

const cache = new Map<string, { svg: string; tables: number; refs: number; columns: number }>();
function info(t: DiagramTemplate) {
  let c = cache.get(t.id);
  if (!c) {
    const { model } = parseDbml(t.dbml);
    const laid = layoutModel(model);
    c = { svg: renderSvg(laid, { theme: "dark", detail: "headers", padding: 16, showNotes: false }).svg, tables: model.tables.length, refs: model.refs.length, columns: model.tables.reduce((n, x) => n + x.columns.length, 0) };
    cache.set(t.id, c);
  }
  return c;
}

/** Puts a template on the canvas: as a new diagram tab, or merged into the current diagram. */
export function useApplyTemplate() {
  const layout = useLayout();
  return (t: DiagramTemplate, mode: "new" | "merge") => applyTemplate(layout, t, mode);
}

/**
 * The template browser: search, category chips, preview cards and a detail pane.
 * Shared by the Templates tool and the “New schema” dialog so both look and behave the same.
 */
export function TemplateGallery({ onUse, allowMerge = true }: { onUse: (t: DiagramTemplate, mode: "new" | "merge") => void; allowMerge?: boolean }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [selected, setSelected] = useState<DiagramTemplate | null>(null);
  const list = useMemo(() => searchTemplates(q, cat), [q, cat]);
  const sel = selected ? info(selected) : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col text-white">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-white/[0.06] shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input className={`${inputCls} pl-8`} placeholder="Search e-commerce, hospital, auth…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {["All", ...TEMPLATE_CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`px-3 py-1.5 text-[11.5px] font-semibold rounded-full border transition-all ${cat === c ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-white" : "border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.05]"}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_340px]">
        <div className="overflow-y-auto overscroll-contain scrollbar-hide p-5 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 content-start">
          {list.length === 0 && <p className="col-span-full text-center text-white/40 py-16 text-sm">No template matches “{q}”.</p>}
          {list.map((t) => {
            const i = info(t);
            const isSel = selected?.id === t.id;
            return (
              <button key={t.id} onClick={() => setSelected(t)} onDoubleClick={() => onUse(t, "new")} className={`group text-left rounded-xl border transition-all ${isSel ? "border-[#4A90D9]/60 ring-1 ring-[#4A90D9]/40 bg-[#4A90D9]/[0.06]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.18] hover:bg-white/[0.04]"}`}>
                <div className="h-[120px] bg-[#070b15] border-b border-white/[0.06] flex items-center justify-center overflow-hidden rounded-t-xl p-2">
                  <div className="[&>svg]:max-h-[104px] [&>svg]:w-auto [&>svg]:max-w-full opacity-90 group-hover:opacity-100 transition-opacity" dangerouslySetInnerHTML={{ __html: i.svg }} />
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-bold truncate">{t.name}</h3>
                    <span className="text-[9px] uppercase tracking-wider text-white/35 shrink-0">{t.category.split(" ")[0]}</span>
                  </div>
                  <p className="text-[11px] text-white/45 mt-1 line-clamp-2 min-h-[30px]">{t.description}</p>
                  <p className="text-[10px] font-mono text-[#4A90D9]/80 mt-2">
                    {i.tables} tables · {i.columns} columns · {i.refs} relations
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <aside className="hidden lg:flex flex-col border-l border-white/[0.06] bg-[#070b15] min-h-0">
          {selected && sel ? (
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide p-5 space-y-4">
              <div>
                <h3 className="text-base font-bold">{selected.name}</h3>
                <p className="text-[12px] text-white/50 mt-1">{selected.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selected.tags.map((tg) => (
                    <span key={tg} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] text-white/50">
                      #{tg}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#040810] p-2 overflow-hidden">
                <div className="[&>svg]:w-full [&>svg]:h-auto" dangerouslySetInnerHTML={{ __html: renderSvg(layoutModel(parseDbml(selected.dbml).model), { theme: "dark", detail: "keys", padding: 16, showNotes: false }).svg }} />
              </div>
              <div className="flex flex-col gap-2">
                <button className={btnPrimary} onClick={() => onUse(selected, "new")}>
                  <Wand2 size={14} /> Use template (new diagram)
                </button>
                {allowMerge && (
                  <button className={btnGhost} onClick={() => onUse(selected, "merge")}>
                    <Plus size={13} /> Add to current diagram
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="m-auto text-center text-white/35 text-sm px-8">
              <LayoutTemplate size={30} className="mx-auto mb-3 text-white/15" />
              Select a template to preview it. Double-click to use it right away.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
