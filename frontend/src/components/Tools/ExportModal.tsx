"use client";

import React, { useMemo, useState } from "react";
import { Check, Copy, Database, Download, FileCode, FileText, Image as ImageIcon, Loader2, Printer, Table2, FileSpreadsheet } from "lucide-react";
import { ModalShell, Tabs, btnGhost, btnPrimary, inputCls, labelCls } from "./ModalShell";
import { useDiagramModel } from "./useDiagramModel";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { renderSvg, SvgDetail, SvgTheme } from "@/lib/export/svgRenderer";
import { downloadBlob, downloadText, safeFilename, svgToPdfBlob, svgToPngBlob } from "@/lib/export/raster";
import { modelToDbml } from "@/lib/dbml/serializer";
import { modelToMongo, modelToSql } from "@/lib/sql/exporter";
import { SQL_DIALECTS, SqlDialect } from "@/lib/sql/dialects";
import { modelToMermaid } from "@/lib/export/mermaid";
import { generateHtmlDocs, generateMarkdownDocs } from "@/lib/docs/generator";
import { layoutModel } from "@/lib/model/autoLayout";
import { csvEscape, makeZip } from "@/lib/export/zip";

/** Thin scrollbars for the documentation preview — the page's own --line colour, so they suit its light and dark themes. */
const PREVIEW_SCROLLBARS =
  "::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-button{display:none}::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}::-webkit-scrollbar-thumb:hover{background:var(--muted)}";

type TabId = "image" | "sql" | "code" | "docs" | "data";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={btnGhost}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />} {done ? "Copied" : label}
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex rounded-lg border border-white/[0.09] overflow-hidden text-[11px]">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`px-3 py-1.5 font-semibold transition-colors ${value === o.id ? "bg-[#4A90D9]/25 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check2({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[12px] text-white/70 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[#4A90D9] w-3.5 h-3.5" />
      {label}
    </label>
  );
}

export function ExportModal({ onClose, initialTab }: { onClose: () => void; initialTab?: TabId }) {
  const layout = useLayout();
  const { model: rawModel, visibleKeys } = useDiagramModel();
  const model = useMemo(() => layoutModel(rawModel), [rawModel]);
  const title = layout.projectTitle || "diagram";
  const [tab, setTab] = useState<TabId>(initialTab || "image");
  const [busy, setBusy] = useState(false);

  // ── image ──
  const apiOpts = layout.getCanvasApi()?.getSvgOptions();
  const [fmt, setFmt] = useState<"png" | "svg" | "pdf">("png");
  const [theme, setTheme] = useState<SvgTheme>("dark");
  const [detail, setDetail] = useState<SvgDetail>(apiOpts?.detail || "all");
  const [rels, setRels] = useState(apiOpts?.showRelationships !== false);
  const [transparent, setTransparent] = useState(false);
  const [withTitle, setWithTitle] = useState(true);
  const [scale, setScale] = useState(2);
  const svg = useMemo(() => renderSvg(model, { theme, detail, showRelationships: rels, transparent: transparent && fmt !== "pdf", title: withTitle ? title : undefined, visibleKeys }), [model, theme, detail, rels, transparent, withTitle, title, visibleKeys, fmt]);

  const downloadImage = async () => {
    setBusy(true);
    try {
      if (fmt === "svg") downloadText(svg.svg, safeFilename(title, "svg"), "image/svg+xml");
      else if (fmt === "png") downloadBlob(await svgToPngBlob(svg.svg, svg.width, svg.height, scale), safeFilename(title, "png"));
      else downloadBlob(await svgToPdfBlob(renderSvg(model, { theme: "light", detail, showRelationships: rels, title: withTitle ? title : undefined, visibleKeys }).svg, svg.width, svg.height, title), safeFilename(title, "pdf"));
      showToast(`${fmt.toUpperCase()} exported`, "download");
    } catch (e: any) {
      showToast(e?.message || "Export failed", "error");
    } finally {
      setBusy(false);
    }
  };
  const copyPng = async () => {
    try {
      const blob = await svgToPngBlob(svg.svg, svg.width, svg.height, scale);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Image copied to clipboard", "success");
    } catch {
      showToast("Your browser blocked image copying — use Download instead", "error");
    }
  };

  // ── sql ──
  const [dialect, setDialect] = useState<SqlDialect>(() => {
    const d = layout.getCanvasApi()?.getSqlDialect();
    return (SQL_DIALECTS.find((x) => x.id === d)?.id || "postgres") as SqlDialect;
  });
  const [drop, setDrop] = useState(false);
  const [alter, setAlter] = useState(false);
  const [idx, setIdx] = useState(true);
  const [fkIdx, setFkIdx] = useState(false);
  const [comments, setComments] = useState(true);
  const [seed, setSeed] = useState(true);
  const [ifNot, setIfNot] = useState(false);
  const sql = useMemo(() => modelToSql(rawModel, { dialect, includeDrop: drop, useAlterTable: alter, includeIndexes: idx, fkIndexes: fkIdx, includeComments: comments, includeSeedData: seed, ifNotExists: ifNot }), [rawModel, dialect, drop, alter, idx, fkIdx, comments, seed, ifNot]);

  // ── code formats ──
  const [codeFmt, setCodeFmt] = useState<"dbml" | "json" | "mongodb" | "mermaid">("dbml");
  const code = useMemo(() => {
    switch (codeFmt) {
      case "dbml":
        return modelToDbml(rawModel);
      case "json":
        return JSON.stringify(rawModel, null, 2);
      case "mongodb":
        return modelToMongo(rawModel);
      default:
        return modelToMermaid(rawModel);
    }
  }, [rawModel, codeFmt]);
  const codeExt = { dbml: "dbml", json: "json", mongodb: "js", mermaid: "mmd" }[codeFmt];

  // ── docs ──
  const [docsTitle, setDocsTitle] = useState(title === "diagram" ? "Database documentation" : title);
  const [docsDiagram, setDocsDiagram] = useState(true);
  const [docsFmt, setDocsFmt] = useState<"html" | "md">("html");
  const docsHtml = useMemo(() => generateHtmlDocs(rawModel, { title: docsTitle, svg: docsDiagram ? renderSvg(model, { theme: "light", transparent: true, visibleKeys }).svg : undefined }), [rawModel, model, docsTitle, docsDiagram, visibleKeys]);
  const docsMd = useMemo(() => generateMarkdownDocs(rawModel, { title: docsTitle }), [rawModel, docsTitle]);
  // the preview (only — not the downloaded file) gets the app's thin scrollbars, in the document's own line colour
  const docsPreview = useMemo(() => docsHtml.replace("</head>", `<style>${PREVIEW_SCROLLBARS}</style></head>`), [docsHtml]);
  const printDocs = () => {
    const w = window.open("", "_blank");
    if (!w) return showToast("Allow pop-ups to print the documentation", "error");
    w.document.open();
    w.document.write(docsHtml);
    w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);
  };

  // ── data ──
  const withData = rawModel.tables.filter((t) => t.records && t.records.rows.length);
  const [dataTable, setDataTable] = useState(withData[0] ? withData[0].name : "");
  const csvFor = (t: (typeof withData)[number]) => [t.records!.columns.map(csvEscape).join(","), ...t.records!.rows.map((r) => r.map((v) => csvEscape(v === null ? "" : typeof v === "string" && v.startsWith("`") ? v.slice(1, -1) : v)).join(","))].join("\n") + "\n";
  const selected = withData.find((t) => t.name === dataTable);

  return (
    <ModalShell title="Export" subtitle={`${rawModel.tables.length} tables · ${rawModel.refs.length} relationships${visibleKeys ? " · current view only for images" : ""}`} icon={<Download size={16} />} onClose={onClose}>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "image", label: "Image · PDF", icon: <ImageIcon size={13} /> },
          { id: "sql", label: "SQL", icon: <Database size={13} /> },
          { id: "code", label: "DBML · JSON · Mongo", icon: <FileCode size={13} /> },
          { id: "docs", label: "Documentation", icon: <FileText size={13} /> },
          { id: "data", label: "Sample data", icon: <FileSpreadsheet size={13} /> },
        ]}
      />

      <div className="flex-1 min-h-0 overflow-y-auto p-scrollbar p-5">
        {tab === "image" && (
          <div className="grid md:grid-cols-[260px_1fr] gap-5 h-full">
            <div className="space-y-4">
              <div>
                <span className={labelCls}>Format</span>
                <Segmented value={fmt} onChange={setFmt} options={[{ id: "png", label: "PNG" }, { id: "svg", label: "SVG" }, { id: "pdf", label: "PDF" }]} />
              </div>
              <div>
                <span className={labelCls}>Theme</span>
                <Segmented value={fmt === "pdf" ? "light" : theme} onChange={setTheme} options={[{ id: "dark", label: "Dark" }, { id: "light", label: "Light" }]} />
                {fmt === "pdf" && <p className="text-[10px] text-white/35 mt-1">PDF always uses the light theme for printing.</p>}
              </div>
              <div>
                <span className={labelCls}>Detail level</span>
                <Segmented value={detail} onChange={setDetail} options={[{ id: "all", label: "All fields" }, { id: "keys", label: "Keys" }, { id: "headers", label: "Names" }]} />
              </div>
              {fmt === "png" && (
                <div>
                  <span className={labelCls}>Resolution</span>
                  <Segmented value={String(scale) as "1" | "2" | "3"} onChange={(v) => setScale(Number(v))} options={[{ id: "1", label: "1×" }, { id: "2", label: "2×" }, { id: "3", label: "3×" }]} />
                </div>
              )}
              <div className="space-y-2">
                <Check2 checked={rels} onChange={setRels} label="Show relationships" />
                <Check2 checked={withTitle} onChange={setWithTitle} label="Add title" />
                {fmt !== "pdf" && <Check2 checked={transparent} onChange={setTransparent} label="Transparent background" />}
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button className={btnPrimary} onClick={downloadImage} disabled={busy}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download {fmt.toUpperCase()}
                </button>
                {fmt === "png" && (
                  <button className={btnGhost} onClick={copyPng}>
                    <Copy size={13} /> Copy image
                  </button>
                )}
                <p className="text-[10px] text-white/35">
                  {svg.width} × {svg.height}px{fmt === "png" ? ` → ${Math.round(svg.width * scale)} × ${Math.round(svg.height * scale)}px` : ""}
                </p>
              </div>
            </div>
            <div className={`rounded-xl border border-white/[0.08] overflow-auto p-scrollbar ${fmt === "pdf" || (theme === "light" && !transparent) ? "p-scrollbar-onlight " : ""}min-h-[280px] max-h-full p-3`} style={{ background: transparent && fmt !== "pdf" ? "repeating-conic-gradient(#1a2233 0% 25%, #131a28 0% 50%) 50% / 18px 18px" : fmt === "pdf" ? "#fff" : theme === "dark" ? "#0b1120" : "#fff" }}>
              <div className="[&>svg]:max-w-full [&>svg]:h-auto [&>svg]:mx-auto" dangerouslySetInnerHTML={{ __html: fmt === "pdf" ? renderSvg(model, { theme: "light", detail, showRelationships: rels, title: withTitle ? title : undefined, visibleKeys }).svg : svg.svg }} />
            </div>
          </div>
        )}

        {tab === "sql" && (
          <div className="grid md:grid-cols-[240px_1fr] gap-5 h-full">
            <div className="space-y-4">
              <div>
                <span className={labelCls}>Database</span>
                <select value={dialect} onChange={(e) => setDialect(e.target.value as SqlDialect)} className={inputCls}>
                  {SQL_DIALECTS.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#0a0f1c]">
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Check2 checked={idx} onChange={setIdx} label="Indexes" />
                <Check2 checked={fkIdx} onChange={setFkIdx} label="Index every foreign key" />
                <Check2 checked={alter} onChange={setAlter} label="Foreign keys as ALTER TABLE" />
                <Check2 checked={drop} onChange={setDrop} label="DROP TABLE statements" />
                <Check2 checked={ifNot} onChange={setIfNot} label="IF NOT EXISTS" />
                <Check2 checked={comments} onChange={setComments} label="Comments (notes)" />
                <Check2 checked={seed} onChange={setSeed} label="Sample data (INSERT)" />
              </div>
              <div className="flex flex-col gap-2">
                <button className={btnPrimary} onClick={() => downloadText(sql, safeFilename(`${title}_${dialect}`, "sql"), "application/sql")}>
                  <Download size={14} /> Download .sql
                </button>
                <CopyButton text={sql} label="Copy SQL" />
              </div>
            </div>
            <pre className="rounded-xl border border-white/[0.08] bg-[#040810] p-4 text-[11.5px] leading-relaxed font-mono text-white/80 overflow-auto p-scrollbar min-h-[280px] whitespace-pre">{sql}</pre>
          </div>
        )}

        {tab === "code" && (
          <div className="grid md:grid-cols-[240px_1fr] gap-5 h-full">
            <div className="space-y-4">
              <div>
                <span className={labelCls}>Format</span>
                <div className="flex flex-col gap-1.5">
                  {(
                    [
                      ["dbml", "DBML", "dbdiagram.io / dbdocs"],
                      ["json", "JSON model", "DesignDB data model"],
                      ["mongodb", "MongoDB", "mongosh $jsonSchema script"],
                      ["mermaid", "Mermaid ER", "GitHub / Notion / mermaid.live"],
                    ] as const
                  ).map(([id, name, hint]) => (
                    <button key={id} onClick={() => setCodeFmt(id)} className={`text-left px-3 py-2 rounded-lg border transition-all ${codeFmt === id ? "bg-[#4A90D9]/15 border-[#4A90D9]/35" : "bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.05]"}`}>
                      <span className="block text-[12px] font-semibold">{name}</span>
                      <span className="block text-[10px] text-white/40">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button className={btnPrimary} onClick={() => downloadText(code, safeFilename(title, codeExt), "text/plain")}>
                  <Download size={14} /> Download .{codeExt}
                </button>
                <CopyButton text={code} />
              </div>
            </div>
            <pre className="rounded-xl border border-white/[0.08] bg-[#040810] p-4 text-[11.5px] leading-relaxed font-mono text-white/80 overflow-auto p-scrollbar min-h-[280px] whitespace-pre">{code}</pre>
          </div>
        )}

        {tab === "docs" && (
          <div className="flex flex-col gap-4 h-full min-h-[420px]">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <span className={labelCls}>Title</span>
                <input className={inputCls} value={docsTitle} onChange={(e) => setDocsTitle(e.target.value)} />
              </div>
              <Segmented value={docsFmt} onChange={setDocsFmt} options={[{ id: "html", label: "HTML" }, { id: "md", label: "Markdown" }]} />
              {docsFmt === "html" && <Check2 checked={docsDiagram} onChange={setDocsDiagram} label="Include ER diagram" />}
              <div className="flex gap-2 ml-auto">
                <button className={btnPrimary} onClick={() => (docsFmt === "html" ? downloadText(docsHtml, safeFilename(docsTitle, "html"), "text/html") : downloadText(docsMd, safeFilename(docsTitle, "md"), "text/markdown"))}>
                  <Download size={14} /> Download .{docsFmt === "html" ? "html" : "md"}
                </button>
                <button className={btnGhost} onClick={printDocs} title="Opens the print dialog — choose “Save as PDF”">
                  <Printer size={13} /> Print / PDF
                </button>
              </div>
            </div>
            {docsFmt === "html" ? (
              <iframe title="Documentation preview" srcDoc={docsPreview} className="flex-1 min-h-[360px] rounded-xl border border-white/[0.08] bg-white" sandbox="" />
            ) : (
              <pre className="flex-1 rounded-xl border border-white/[0.08] bg-[#040810] p-4 text-[11.5px] leading-relaxed font-mono text-white/80 overflow-auto p-scrollbar whitespace-pre-wrap min-h-[300px]">{docsMd}</pre>
            )}
          </div>
        )}

        {tab === "data" && (
          <div className="space-y-4">
            {withData.length === 0 ? (
              <div className="text-center py-16 text-white/40 text-sm">
                <Table2 size={30} className="mx-auto mb-3 text-white/15" />
                No sample data yet. Add rows from a table&apos;s <b className="text-white/60">Sample data</b> button or a DBML <code className="text-[#4A90D9]">records</code> block.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[220px]">
                    <span className={labelCls}>Table</span>
                    <select value={dataTable} onChange={(e) => setDataTable(e.target.value)} className={inputCls}>
                      {withData.map((t) => (
                        <option key={t.name} value={t.name} className="bg-[#0a0f1c]">
                          {t.name} ({t.records!.rows.length} rows)
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className={btnPrimary} disabled={!selected} onClick={() => selected && downloadText(csvFor(selected), safeFilename(selected.name, "csv"), "text/csv")}>
                    <Download size={14} /> Download CSV
                  </button>
                  <button
                    className={btnGhost}
                    onClick={() => {
                      const zip = makeZip(withData.map((t) => ({ name: `${t.name}.csv`, content: csvFor(t) })));
                      downloadBlob(new Blob([zip as BlobPart], { type: "application/zip" }), safeFilename(`${title}_data`, "zip"));
                    }}
                  >
                    <Download size={13} /> All tables (.zip)
                  </button>
                </div>
                {selected && <pre className="rounded-xl border border-white/[0.08] bg-[#040810] p-4 text-[11.5px] font-mono text-white/80 overflow-auto p-scrollbar max-h-[46vh] whitespace-pre">{csvFor(selected)}</pre>}
              </>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
