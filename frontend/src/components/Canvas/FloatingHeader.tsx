"use client";

import { useRouter } from "next/navigation";
import { RefObject, useState } from "react";
import { Play, Share2, Grid, Home, Edit3, Download, FileCode2, FileText, Image, Check, Loader2 } from "lucide-react";
import { Magnetic } from "./Magnetic";
import { toPng } from "html-to-image";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FloatingHeaderProps {
  generatedSql?: string;
  rawSchema?: any;
  reactFlowWrapperRef?: RefObject<HTMLDivElement>;
}

// ─── Mermaid generator (client-side, mirrors execution/generate_mermaid.ts) ──

function buildMermaid(schema: any): string {
  if (!schema?.entities) return "erDiagram\n  %% No schema loaded";
  let out = "erDiagram\n";
  for (const entity of schema.entities) {
    out += `    ${entity.name} {\n`;
    for (const attr of entity.attributes) {
      const pk = attr.isPrimaryKey ? " PK" : "";
      const fk = schema.relationships?.some(
        (r: any) => r.fromEntity === entity.name && r.foreignKey === attr.name
      ) ? " FK" : "";
      const safeType = (attr.dataType || "VARCHAR").replace(/\s+/g, "_");
      out += `        ${safeType} ${attr.name}${pk}${fk}\n`;
    }
    out += `    }\n\n`;
  }
  for (const rel of schema.relationships ?? []) {
    const cardMap: Record<string, string> = {
      "one-to-one": "||--||",
      "one-to-many": "||--o{",
      "many-to-one": "}o--||",
      "many-to-many": "}o--o{",
    };
    const card = cardMap[rel.type] ?? "||--o{";
    out += `    ${rel.fromEntity} ${card} ${rel.toEntity} : "${rel.foreignKey} -> ${rel.referencedKey}"\n`;
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function triggerDownload(content: string, filename: string) {
  // Use a data URI — unlike blob: URLs, data: URIs always respect
  // the a.download filename attribute regardless of revoke timing.
  const dataUri = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
  const a = document.createElement("a");
  a.href = dataUri;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Download Button Sub-component ───────────────────────────────────────────

type BtnState = "idle" | "loading" | "done";

interface DownloadBtnProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => Promise<void>;
  accent?: string; // tailwind colour token used for done flash
}

function DownloadBtn({ icon, label, title, onClick, accent = "lime" }: DownloadBtnProps) {
  const [state, setState] = useState<BtnState>("idle");

  const handle = async () => {
    if (state !== "idle") return;
    setState("loading");
    try {
      await onClick();
      setState("done");
      setTimeout(() => setState("idle"), 1800);
    } catch (e) {
      console.error(e);
      setState("idle");
    }
  };

  return (
    <button
      title={title}
      onClick={handle}
      disabled={state === "loading"}
      className={`
        relative group flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium
        border transition-all duration-200 select-none
        ${state === "done"
          ? "border-lime-500/60 bg-lime-500/10 text-lime-400"
          : "border-white/10 bg-white/5 text-muted-foreground hover:text-white hover:bg-white/10 hover:border-white/20"
        }
      `}
    >
      {/* icon slot */}
      <span className="flex-shrink-0">
        {state === "loading" ? (
          <Loader2 size={13} className="animate-spin text-sentry-purple" />
        ) : state === "done" ? (
          <Check size={13} className="text-lime-400" />
        ) : (
          icon
        )}
      </span>
      <span className="hidden sm:inline leading-none">{label}</span>

      {/* tooltip on hover */}
      <span className="
        absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap
        text-[10px] bg-black/80 text-white/70 px-2 py-0.5 rounded
        opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50
      ">
        {title}
      </span>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FloatingHeader({
  generatedSql = "",
  rawSchema = null,
  reactFlowWrapperRef,
}: FloatingHeaderProps) {
  const router = useRouter();

  // ── Download: .mmd ──────────────────────────────────────────────────────────
  const downloadMmd = async () => {
    const mmd = buildMermaid(rawSchema);
    triggerDownload(mmd, "erd_designdb.mmd");
  };

  // ── Download: .sql ──────────────────────────────────────────────────────────
  const downloadSql = async () => {
    const content = generatedSql || "-- No SQL generated yet. Generate a schema first.";
    triggerDownload(content, "schema_designdb.sql");
  };

  // ── Download: .png ──────────────────────────────────────────────────────────
  const downloadPng = async () => {
    const el = reactFlowWrapperRef?.current;
    if (!el) throw new Error("Canvas not ready");

    // toPng returns a data URI — always uses a.download as the filename
    const dataUrl = await toPng(el, {
      quality: 1,
      pixelRatio: 2,
      backgroundColor: "#090C15",
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (node.classList.contains("react-flow__panel")) return false;
          if (node.classList.contains("react-flow__attribution")) return false;
        }
        return true;
      },
    });

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "erd_designdb.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const hasSchema = !!rawSchema;
  const noSchemaTitle = (base: string) =>
    hasSchema ? base : `${base} — Generate a schema first`;

  return (
    <div className="absolute top-0 w-full z-50 flex items-center justify-between px-6 py-4 border-b border-white/5 bg-background/40 backdrop-blur-md">

      {/* ── Left: Logo + Tool Icons ─────────────────────────────────────────── */}
      <div className="flex items-center gap-8">
        <h1
          className="text-xl text-white tracking-wide"
          style={{ fontFamily: "Vagnola, sans-serif" }}
        >
          DesignDB
        </h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          <button
            onClick={() => router.push("/")}
            title="Back to Home"
            className="p-2 hover:text-white hover:bg-white/5 rounded-md transition-all"
          >
            <Home size={18} />
          </button>
          <button className="p-2 hover:text-white hover:bg-white/5 rounded-md transition-all">
            <Grid size={18} />
          </button>
          <div className="relative border-b-2 border-lime-green text-lime-green pb-[2px]">
            <button className="p-2 rounded-md transition-all">
              <Edit3 size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Downloads + Actions ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">

        {/* Progress badge */}
        <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-md mr-1">
          <span
            className="text-white text-xs font-bold"
            style={{ fontFamily: "Vagnola, sans-serif" }}
          >
            ERD Generation
          </span>
          <span className="text-lime-green text-xs font-mono">
            {hasSchema ? "100%" : "—"}
          </span>
        </div>

        {/* ── Download Group ── */}
        <div className="flex items-center gap-1.5 pl-3 border-l border-white/10">
          <span className="text-[10px] text-white/30 uppercase tracking-widest mr-1 hidden lg:block">
            Export
          </span>

          <DownloadBtn
            icon={<FileText size={13} />}
            label=".mmd"
            title={noSchemaTitle("Download Mermaid ERD (.mmd)")}
            onClick={downloadMmd}
          />

          <DownloadBtn
            icon={<FileCode2 size={13} />}
            label=".sql"
            title={noSchemaTitle("Download SQL DDL (.sql)")}
            onClick={downloadSql}
          />

          <DownloadBtn
            icon={<Image size={13} />}
            label=".png"
            title={noSchemaTitle("Download ERD as PNG image")}
            onClick={downloadPng}
          />
        </div>

        {/* ── Existing Actions ── */}
        <div className="flex items-center gap-2 pl-3 border-l border-white/10">
          <Magnetic>
            <button
              title="Run / Refresh"
              className="p-2.5 flex items-center justify-center text-lime-green bg-white/5 hover:bg-lime-green/20 rounded-md transition-all border border-lime-green/30"
            >
              <Play size={16} className="fill-current" />
            </button>
          </Magnetic>

          <button
            title="Share"
            className="p-2.5 flex items-center justify-center text-muted-foreground hover:text-white hover:bg-white/5 rounded-md transition-all"
          >
            <Share2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
