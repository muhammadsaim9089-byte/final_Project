"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Maximize2, Moon, Search, Sun, ZoomIn, ZoomOut } from "lucide-react";
import { parseDbml } from "@/lib/dbml/parser";
import { layoutModel, applyPositions } from "@/lib/model/autoLayout";
import { renderSvg, SvgDetail, SvgTheme } from "@/lib/export/svgRenderer";
import { LayoutMap, buildFragment } from "@/lib/share/codec";
import { downloadBlob, downloadText, safeFilename, svgToPngBlob } from "@/lib/export/raster";

interface Props {
  dbml: string;
  layout?: LayoutMap;
  title?: string;
  theme?: SvgTheme;
  /** compact = for iframes: smaller toolbar */
  compact?: boolean;
}

const cssStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** Interactive, read-only ER diagram. Works from a DBML string only — no editor state needed. */
export function DiagramViewer({ dbml, layout, title, theme: initialTheme = "light", compact }: Props) {
  const [theme, setTheme] = useState<SvgTheme>(initialTheme);
  const [detail, setDetail] = useState<SvgDetail>("all");
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const parsed = useMemo(() => {
    const r = parseDbml(dbml);
    applyPositions(r.model, layout);
    return { model: layoutModel(r.model), errors: r.diagnostics.filter((d) => d.severity === "error") };
  }, [dbml, layout]);
  const svg = useMemo(() => renderSvg(parsed.model, { theme, detail, title, interactive: true, padding: 40 }), [parsed, theme, detail, title]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const k = Math.min(1.2, Math.max(0.05, Math.min(el.clientWidth / svg.width, el.clientHeight / svg.height) * 0.96));
    setView({ k, x: (el.clientWidth - svg.width * k) / 2, y: (el.clientHeight - svg.height * k) / 2 });
  }, [svg.width, svg.height]);
  useEffect(() => {
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const zoomAt = (cx: number, cy: number, factor: number) =>
    setView((v) => {
      const k = Math.min(4, Math.max(0.05, v.k * factor));
      const f = k / v.k;
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f };
    });

  // wheel zoom (needs a non-passive listener to preventDefault)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = wrap.current!.getBoundingClientRect();
      const target = (pinch.current.k * d) / pinch.current.d;
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, target / view.k);
    } else if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  // hover → highlight a table's relationships
  const onOver = (e: React.MouseEvent) => {
    const t = (e.target as Element).closest?.(".tbl") as SVGGElement | null;
    setFocus(t?.getAttribute("data-t") || null);
  };

  const focusStyle = focus
    ? `.erd .rel{opacity:.14;transition:opacity .15s}.erd .rel[data-a="${cssStr(focus)}"],.erd .rel[data-b="${cssStr(focus)}"]{opacity:1}.erd .tbl{opacity:.55;transition:opacity .15s}.erd .tbl[data-t="${cssStr(focus)}"]{opacity:1}`
    : "";
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? parsed.model.tables.filter((t) => `${t.schema || ""}.${t.name}`.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))) : [];
  }, [query, parsed]);
  const searchStyle = matches.length && query.trim() ? `.erd .tbl{opacity:.25}` + matches.map((t) => `.erd .tbl[data-t="${cssStr(t.schema && t.schema !== "public" ? `${t.schema}.${t.name}` : t.name)}"]{opacity:1}`).join("") : "";

  const jumpTo = (t: (typeof matches)[number]) => {
    const el = wrap.current;
    if (!el || t.x === undefined || t.y === undefined) return;
    const k = Math.max(view.k, 0.9);
    // svg content is offset by padding − min x/y of the diagram; find the table's rendered position
    const node = el.querySelector(`.tbl[data-t="${cssStr(t.schema && t.schema !== "public" ? `${t.schema}.${t.name}` : t.name)}"]`) as SVGGraphicsElement | null;
    if (!node) return;
    const bb = node.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const cx = (bb.left + bb.width / 2 - r.left - view.x) / view.k;
    const cy = (bb.top + bb.height / 2 - r.top - view.y) / view.k;
    setView({ k, x: el.clientWidth / 2 - cx * k, y: el.clientHeight / 2 - cy * k });
  };

  const [openHref, setOpenHref] = useState("");
  useEffect(() => {
    buildFragment({ dbml, layout, title }, { compress: true }).then((f) => setOpenHref(`${window.location.origin}/canvas#${f}`)).catch(() => undefined);
  }, [dbml, layout, title]);

  const dark = theme === "dark";
  const chrome = dark ? "bg-[#0d1424]/95 border-white/[0.1] text-white" : "bg-white/95 border-slate-200 text-slate-800";
  const iconBtn = `w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${dark ? "hover:bg-white/10 text-white/70 hover:text-white" : "hover:bg-slate-100 text-slate-500 hover:text-slate-900"}`;

  return (
    <div className={`relative w-full h-full overflow-hidden select-none ${dark ? "bg-[#0b1120]" : "bg-white"}`}>
      <style>{focusStyle + searchStyle}</style>
      <div
        ref={wrap}
        className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onMouseOver={onOver}
        onMouseLeave={() => setFocus(null)}
        onDoubleClick={fit}
      >
        <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0", width: svg.width, height: svg.height }} dangerouslySetInnerHTML={{ __html: svg.svg }} />
      </div>

      {parsed.errors.length > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-red-500/90 text-white text-xs shadow-lg max-w-[90%] truncate">
          DBML error on line {parsed.errors[0].line}: {parsed.errors[0].message}
        </div>
      )}

      {/* toolbar */}
      <div className={`absolute top-3 left-3 right-3 flex items-center gap-2 pointer-events-none ${compact ? "flex-wrap" : ""}`}>
        <div className={`pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-xl border shadow-lg backdrop-blur ${chrome}`}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && matches[0] && jumpTo(matches[0])}
              placeholder="Search tables / columns"
              className={`pl-7 pr-2 py-1.5 w-40 sm:w-52 rounded-lg text-xs outline-none bg-transparent ${dark ? "placeholder:text-white/30" : "placeholder:text-slate-400"}`}
            />
          </div>
          {query && <span className="text-[10px] opacity-50 pr-1.5">{matches.length}</span>}
        </div>
        {title && !compact && <div className={`pointer-events-auto hidden md:block px-3 py-1.5 rounded-xl border shadow-lg backdrop-blur text-xs font-semibold ${chrome}`}>{title}</div>}
        <div className="flex-1" />
        <div className={`pointer-events-auto flex items-center gap-0.5 px-1 py-1 rounded-xl border shadow-lg backdrop-blur ${chrome}`}>
          <select value={detail} onChange={(e) => setDetail(e.target.value as SvgDetail)} className={`text-[11px] bg-transparent outline-none px-1 cursor-pointer ${dark ? "text-white/70" : "text-slate-600"}`} title="Detail level">
            <option value="all">All fields</option>
            <option value="keys">Keys</option>
            <option value="headers">Names</option>
          </select>
          <button className={iconBtn} onClick={() => setTheme(dark ? "light" : "dark")} title="Toggle theme">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button className={iconBtn} onClick={() => wrap.current && zoomAt(wrap.current.clientWidth / 2, wrap.current.clientHeight / 2, 1.25)} title="Zoom in">
            <ZoomIn size={14} />
          </button>
          <button className={iconBtn} onClick={() => wrap.current && zoomAt(wrap.current.clientWidth / 2, wrap.current.clientHeight / 2, 0.8)} title="Zoom out">
            <ZoomOut size={14} />
          </button>
          <button className={iconBtn} onClick={fit} title="Fit to screen (double-click)">
            <Maximize2 size={14} />
          </button>
          <button className={iconBtn} onClick={() => downloadText(svg.svg, safeFilename(title || "diagram", "svg"), "image/svg+xml")} title="Download SVG">
            <Download size={14} />
          </button>
          <button className={iconBtn} onClick={async () => downloadBlob(await svgToPngBlob(svg.svg, svg.width, svg.height, 2), safeFilename(title || "diagram", "png"))} title="Download PNG">
            <span className="text-[9px] font-bold">PNG</span>
          </button>
          {openHref && (
            <a className={`${iconBtn} !w-auto px-2 gap-1 text-[11px] font-semibold`} href={openHref} target="_top" title="Open an editable copy in DesignDB">
              <ExternalLink size={13} /> Edit
            </a>
          )}
        </div>
      </div>
      <div className={`absolute bottom-3 right-3 text-[10px] px-2 py-1 rounded-md ${dark ? "text-white/30" : "text-slate-400"}`}>Made with DesignDB · scroll to zoom · drag to pan</div>
    </div>
  );
}
