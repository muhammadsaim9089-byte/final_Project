"use client";

import { useEffect, useMemo, useState } from "react";
import { Table2 } from "lucide-react";
import { thumbnailOf, type Thumbnail } from "@/lib/projects";
import { ProjectThumbnail } from "./ProjectCard";
import { IntentLink } from "./IntentLink";

interface TemplateCard {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  tables: number;
  thumb: Thumbnail | null;
}

let cache: { cards: TemplateCard[]; categories: string[] } | null = null;

/** Templates with laid-out previews — loaded (with the parser and layout engine) only when first needed. */
export function useTemplates() {
  const [data, setData] = useState(cache);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    (async () => {
      const [{ TEMPLATES, TEMPLATE_CATEGORIES }, { parseDbml }, { modelToCanvas }, { layoutNodes, DEFAULT_LAYOUT }] = await Promise.all([
        import("@/lib/templates"),
        import("@/lib/dbml/parser"),
        import("@/lib/model/canvasAdapter"),
        import("@/lib/layout"),
      ]);
      const cards = TEMPLATES.map((t) => {
        const res = modelToCanvas(parseDbml(t.dbml).model);
        const nodes = layoutNodes(res.nodes, res.edges, DEFAULT_LAYOUT);
        return {
          id: t.id,
          name: t.name,
          category: t.category,
          description: t.description,
          tags: t.tags,
          tables: nodes.filter((n) => n.type === "tableMode").length,
          thumb: thumbnailOf({ nodesJson: nodes, edgesJson: res.edges, meta: res.meta }),
        };
      });
      cache = { cards, categories: [...TEMPLATE_CATEGORIES] };
      if (alive) setData(cache);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

function Card({ t, compact = false }: { t: TemplateCard; compact?: boolean }) {
  return (
    <IntentLink
      intent={{ template: t.id }}
      className="group flex flex-col rounded-2xl bg-[#0e1524] border border-white/[0.07] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-[#4A90D9]/45 hover:shadow-[0_16px_40px_rgba(0,0,0,0.45)] outline-none focus-visible:ring-2 focus-visible:ring-[#4A90D9]/70 text-left"
      title={`Open “${t.name}” as a new diagram`}
    >
      <div className={`relative ${compact ? "aspect-[16/9]" : "aspect-[16/10]"} border-b border-white/[0.06] bg-[#0a101c] bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:14px_14px]`}>
        <ProjectThumbnail thumb={t.thumb} className="absolute inset-3 w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)] transition-transform duration-300 group-hover:scale-[1.03]" />
      </div>
      <div className={compact ? "px-3 py-2.5" : "px-4 pt-3 pb-3.5"}>
        <p className={`${compact ? "text-[13px]" : "text-[14.5px]"} font-semibold text-white truncate`}>{t.name}</p>
        {!compact && <p className="mt-1 text-[12.5px] text-white/50 leading-snug line-clamp-2 min-h-[2.5em]">{t.description}</p>}
        <p className="mt-1.5 flex items-center gap-2 text-[11.5px] text-white/45">
          <span>{t.category}</span>
          <span className="text-white/20">·</span>
          <span className="inline-flex items-center gap-1">
            <Table2 size={12} className="text-white/35" /> {t.tables} tables
          </span>
        </p>
      </div>
    </IntentLink>
  );
}

const Skeleton = ({ n, compact }: { n: number; compact?: boolean }) => (
  <>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="rounded-2xl bg-[#0e1524] border border-white/[0.05] overflow-hidden" aria-hidden>
        <div className={`${compact ? "aspect-[16/9]" : "aspect-[16/10]"} bg-white/[0.025] animate-pulse`} />
        <div className="p-3 space-y-2">
          <div className="h-3 w-2/3 rounded bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    ))}
  </>
);

/** Four popular samples, for the empty dashboard. */
export function SampleStrip() {
  const data = useTemplates();
  const picks = useMemo(() => {
    if (!data) return null;
    const want = ["ecommerce", "blog-cms", "saas-multitenant", "crm"];
    const chosen = want.map((id) => data.cards.find((c) => c.id === id)).filter((c): c is TemplateCard => !!c);
    return [...chosen, ...data.cards.filter((c) => !chosen.includes(c))].slice(0, 4);
  }, [data]);
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{picks ? picks.map((t) => <Card key={t.id} t={t} compact />) : <Skeleton n={4} compact />}</div>;
}

export function TemplatesView({ query }: { query: string }) {
  const data = useTemplates();
  const [category, setCategory] = useState<string>("All");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (data?.cards ?? []).filter(
        (t) => (category === "All" || t.category === category) && (!q || [t.name, t.description, t.category, ...t.tags].some((s) => s.toLowerCase().includes(q)))
      ),
    [data, category, q]
  );
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5" role="tablist" aria-label="Template categories">
        {["All", ...(data?.categories ?? [])].map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`h-8 px-3 rounded-full text-[12.5px] font-semibold border transition-colors ${category === c ? "bg-[#4A90D9]/20 border-[#4A90D9]/50 text-white" : "bg-white/[0.03] border-white/[0.08] text-white/60 hover:text-white hover:border-white/[0.16]"}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
        {!data ? <Skeleton n={8} /> : shown.map((t) => <Card key={t.id} t={t} />)}
      </div>
      {data && !shown.length && <p className="py-16 text-center text-[14px] text-white/50">No templates match “{query}”.</p>}
    </div>
  );
}
