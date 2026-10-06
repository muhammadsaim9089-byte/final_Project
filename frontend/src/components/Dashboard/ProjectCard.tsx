"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileCode, GitBranch, Layers, MoreHorizontal, Pencil, SquareArrowOutUpRight, Table2, Trash2 } from "lucide-react";
import { relativeTime, summarizeProject, thumbnailOf, type StoredProject, type Thumbnail } from "@/lib/projects";
import { IntentLink } from "./IntentLink";

export type ProjectAction = "rename" | "duplicate" | "export-sql" | "export-dbml" | "delete";

export interface ProjectCardProps {
  project: StoredProject;
  /** open in an editor tab right now */
  isOpen: boolean;
  /** what a content search matched, when it wasn't the name ("column orders.customer_id") */
  matchedIn?: string;
  renaming: boolean;
  onRename: (title: string | null) => void;
  onAction: (action: ProjectAction, anchor: Element) => void;
}

const ENGINE_TONE: Record<string, string> = {
  postgres: "text-sky-300 bg-sky-400/10 border-sky-400/25",
  mysql: "text-orange-300 bg-orange-400/10 border-orange-400/25",
  sqlite: "text-teal-300 bg-teal-400/10 border-teal-400/25",
  mssql: "text-rose-300 bg-rose-400/10 border-rose-400/25",
  oracle: "text-red-300 bg-red-400/10 border-red-400/25",
};

export function EngineBadge({ engine, dialect }: { engine: string | null; dialect: string | null }) {
  const tone = (dialect && ENGINE_TONE[dialect]) || "text-white/60 bg-white/[0.05] border-white/[0.1]";
  return <span className={`inline-flex items-center h-5 px-1.5 rounded-md border text-[10.5px] font-semibold whitespace-nowrap ${tone}`}>{engine || "Any SQL"}</span>;
}

/** The diagram in miniature: group frames, relationship lines, tables with their header colour, sticky notes. */
export const ProjectThumbnail = memo(function ProjectThumbnail({ thumb, className = "" }: { thumb: Thumbnail | null; className?: string }) {
  if (!thumb) {
    return (
      <div className={`flex flex-col items-center justify-center gap-1.5 text-white/25 ${className}`}>
        <Table2 size={22} />
        <span className="text-[11px]">Empty diagram</span>
      </div>
    );
  }
  return (
    <svg viewBox={thumb.viewBox} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      {thumb.groups.map((g, i) => (
        <rect key={`g${i}`} x={g.x} y={g.y} width={g.w} height={g.h} rx={18} fill={g.color || "#4A90D9"} fillOpacity={0.07} stroke={g.color || "#4A90D9"} strokeOpacity={0.45} strokeDasharray="6 5" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      ))}
      {thumb.links.map((l, i) => (
        <path key={`l${i}`} d={`M${l.x1},${l.y1} C${(l.x1 + l.x2) / 2},${l.y1} ${(l.x1 + l.x2) / 2},${l.y2} ${l.x2},${l.y2}`} fill="none" stroke={l.dep ? "#f59e0b" : "#8b83e6"} strokeOpacity={0.55} strokeWidth={1.1} strokeDasharray={l.dep ? "4 3" : undefined} vectorEffect="non-scaling-stroke" />
      ))}
      {thumb.tables.map((t, i) => {
        const head = Math.min(52, t.h);
        return (
          <g key={`t${i}`}>
            <rect x={t.x} y={t.y} width={t.w} height={t.h} rx={12} fill="#121b2e" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={`M${t.x},${t.y + head} v${-head + 12} q0,-12 12,-12 h${t.w - 24} q12,0 12,12 v${head - 12} z`} fill={t.color || "#4A90D9"} fillOpacity={0.85} />
            {Array.from({ length: Math.min(t.rows, 10) }, (_, r) => (
              <rect key={r} x={t.x + 18} y={t.y + head + 16 + r * 34} width={(t.w - 36) * (r % 3 === 0 ? 0.62 : r % 3 === 1 ? 0.8 : 0.5)} height={9} rx={4} fill="#ffffff" fillOpacity={0.13} />
            ))}
          </g>
        );
      })}
      {thumb.notes.map((n, i) => (
        <rect key={`n${i}`} x={n.x} y={n.y} width={n.w} height={n.h} rx={10} fill="#fcd34d" fillOpacity={0.75} />
      ))}
    </svg>
  );
});

function useProjectInfo(project: StoredProject) {
  // re-derived only when the saved project changes
  return useMemo(() => ({ summary: summarizeProject(project), thumb: thumbnailOf(project) }), [project]);
}

/** ••• — everything you can do to a diagram without opening it */
function ProjectMenu({ project, onAction, onClose, align = "right" }: { project: StoredProject; onAction: ProjectCardProps["onAction"]; onClose: () => void; align?: "right" | "left" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // closes this menu, not the dashboard
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  const item = "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-white/80 hover:text-white hover:bg-white/[0.07] focus-visible:bg-white/[0.07] outline-none rounded-lg transition-colors";
  const act = (a: ProjectAction) => (e: React.MouseEvent<HTMLElement>) => {
    const anchor = e.currentTarget.closest("[data-card]") ?? e.currentTarget;
    onClose();
    onAction(a, anchor);
  };
  return (
    <div ref={ref} role="menu" aria-label={`${project.title} actions`} className={`absolute top-11 ${align === "right" ? "right-2" : "left-2"} z-30 w-52 p-1.5 rounded-xl bg-[#0c1322] border border-white/[0.1] shadow-[0_18px_50px_rgba(0,0,0,0.6)]`}>
      <IntentLink role="menuitem" intent={{ project }} className={item}>
        <SquareArrowOutUpRight size={14} className="text-white/50" /> Open in editor
      </IntentLink>
      <button role="menuitem" onClick={act("rename")} className={item}>
        <Pencil size={14} className="text-white/50" /> Rename
      </button>
      <button role="menuitem" onClick={act("duplicate")} className={item}>
        <Copy size={14} className="text-white/50" /> Duplicate
      </button>
      <div className="h-px bg-white/[0.07] my-1" />
      <button role="menuitem" onClick={act("export-sql")} className={item}>
        <Download size={14} className="text-white/50" /> Export SQL
      </button>
      <button role="menuitem" onClick={act("export-dbml")} className={item}>
        <FileCode size={14} className="text-white/50" /> Export DBML
      </button>
      <div className="h-px bg-white/[0.07] my-1" />
      <button role="menuitem" onClick={act("delete")} className={`${item} !text-red-300 hover:!bg-red-500/10`}>
        <Trash2 size={14} /> Delete
      </button>
    </div>
  );
}

function TitleEditor({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <input
      autoFocus
      value={draft}
      aria-label="Diagram name"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") e.preventDefault(); // (Esc cancels the rename, not the dashboard)
        if (e.key === "Enter") finish(draft.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(draft.trim() && draft.trim() !== value ? draft.trim() : null)}
      className="relative z-20 w-full min-w-0 bg-[#070b14] border border-[#4A90D9]/60 rounded-md px-2 py-0.5 text-[14px] font-semibold text-white outline-none focus:ring-2 focus:ring-[#4A90D9]/30"
    />
  );
}

const Metric = ({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) => (
  <span className="inline-flex items-center gap-1 text-[11.5px] text-white/55 whitespace-nowrap" title={`${n} ${label}${n === 1 ? "" : "s"}`}>
    {icon}
    <b className="font-semibold text-white/75">{n}</b> {label}
    {n === 1 ? "" : "s"}
  </span>
);

/** Grid card: thumbnail, name, when it was edited, engine, what's in it, and its ••• menu. */
export const ProjectCard = memo(function ProjectCard({ project, isOpen, matchedIn, renaming, onRename, onAction }: ProjectCardProps) {
  const { summary, thumb } = useProjectInfo(project);
  const [menu, setMenu] = useState(false);
  return (
    <div data-card className="group relative flex flex-col rounded-2xl bg-[#0e1524] border border-white/[0.07] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_8px_24px_rgba(0,0,0,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#4A90D9]/45 hover:shadow-[0_16px_40px_rgba(0,0,0,0.45),0_0_0_1px_rgba(74,144,217,0.15)] focus-within:border-[#4A90D9]/60">
      {/* the whole card opens the diagram (a stretched link, so the ••• button can sit on top of it) */}
      <IntentLink intent={{ project }} className="absolute inset-0 z-10 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[#4A90D9]/70" aria-label={`Open ${project.title}`} />
      <div className="relative aspect-[16/10] rounded-t-2xl overflow-hidden border-b border-white/[0.06] bg-[#0a101c] bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:14px_14px]">
        <ProjectThumbnail thumb={thumb} className="absolute inset-3 w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)] transition-transform duration-300 group-hover:scale-[1.03]" />
        {isOpen && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-[#0e1524]/90 border border-white/[0.1] text-[10.5px] font-semibold text-white/80">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Open in editor
          </span>
        )}
      </div>
      <button
        onClick={() => setMenu((m) => !m)}
        aria-label={`${project.title} — more actions`}
        aria-haspopup="menu"
        aria-expanded={menu}
        className={`absolute right-2.5 top-2.5 z-20 w-8 h-8 rounded-lg flex items-center justify-center bg-[#0e1524]/90 border border-white/[0.1] text-white/70 hover:text-white hover:bg-[#1a2540] transition-opacity ${menu ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"}`}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && <ProjectMenu project={project} onAction={onAction} onClose={() => setMenu(false)} />}

      <div className="px-4 pt-3 pb-3.5 flex flex-col gap-1.5">
        {renaming ? (
          <TitleEditor value={project.title} onDone={onRename} />
        ) : (
          <h3 className="text-[14.5px] font-semibold text-white truncate" title={project.title}>
            {project.title}
          </h3>
        )}
        <div className="flex items-center gap-2 text-[12px] text-white/50 min-w-0">
          <span className="truncate">Edited {relativeTime(project.updatedAt)}</span>
          <span className="text-white/20">·</span>
          <EngineBadge engine={summary.engine} dialect={summary.dialect} />
        </div>
        {matchedIn && <p className="text-[11.5px] text-[#7fb3ee] truncate">Matches {matchedIn}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <Metric icon={<Table2 size={12} className="text-white/35" />} n={summary.tables} label="table" />
          <Metric icon={<GitBranch size={12} className="text-white/35" />} n={summary.relationships} label="relationship" />
          {summary.views > 0 && <Metric icon={<Layers size={12} className="text-white/35" />} n={summary.views} label="view" />}
        </div>
      </div>
    </div>
  );
});

/** List row: the same facts on one line, for scanning many diagrams. */
export const ProjectRow = memo(function ProjectRow({ project, isOpen, matchedIn, renaming, onRename, onAction }: ProjectCardProps) {
  const { summary, thumb } = useProjectInfo(project);
  const [menu, setMenu] = useState(false);
  return (
    <div data-card className="group relative grid grid-cols-[72px_1fr_auto] md:grid-cols-[72px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_40px] items-center gap-4 px-3 py-2.5 rounded-xl border border-transparent hover:bg-white/[0.03] hover:border-white/[0.07] transition-colors">
      <IntentLink intent={{ project }} className="absolute inset-0 z-10 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#4A90D9]/70" aria-label={`Open ${project.title}`} />
      <div className="w-[72px] h-[46px] rounded-lg overflow-hidden bg-[#0a101c] border border-white/[0.07]">
        <ProjectThumbnail thumb={thumb} className="w-full h-full p-1" />
      </div>
      <div className="min-w-0">
        {renaming ? (
          <TitleEditor value={project.title} onDone={onRename} />
        ) : (
          <p className="text-[14px] font-semibold text-white truncate flex items-center gap-2">
            <span className="truncate">{project.title}</span>
            {isOpen && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400" title="Open in the editor" />}
          </p>
        )}
        <p className="text-[11.5px] text-white/45 truncate md:hidden">
          Edited {relativeTime(project.updatedAt)} · {summary.tables} tables
        </p>
        {matchedIn && <p className="text-[11.5px] text-[#7fb3ee] truncate">Matches {matchedIn}</p>}
      </div>
      <div className="hidden md:block">
        <EngineBadge engine={summary.engine} dialect={summary.dialect} />
      </div>
      <div className="hidden md:flex items-center gap-3">
        <Metric icon={<Table2 size={12} className="text-white/35" />} n={summary.tables} label="table" />
        <Metric icon={<GitBranch size={12} className="text-white/35" />} n={summary.relationships} label="ref" />
      </div>
      <span className="hidden md:block text-[12px] text-white/50 truncate">{relativeTime(project.updatedAt)}</span>
      <div className="relative z-20 justify-self-end">
        <button
          onClick={() => setMenu((m) => !m)}
          aria-label={`${project.title} — more actions`}
          aria-haspopup="menu"
          aria-expanded={menu}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08]"
        >
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <div className="absolute right-0 top-0">
            <ProjectMenu project={project} onAction={onAction} onClose={() => setMenu(false)} />
          </div>
        )}
      </div>
    </div>
  );
});
