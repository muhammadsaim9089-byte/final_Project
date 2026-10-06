"use client";

import React, { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Copy, Download, FileUp, RefreshCw, Wrench } from "lucide-react";
import { ModalShell, btnGhost, btnPrimary, inputCls, labelCls } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { useDiagramModel } from "./useDiagramModel";
import { importText, IMPORT_FORMATS, ImportFormat } from "@/lib/import";
import { modelToSql, modelToMongo } from "@/lib/sql/exporter";
import { modelToDbml } from "@/lib/dbml/serializer";
import { SQL_DIALECTS, SqlDialect, canonicalType, convertType, dialectLabel } from "@/lib/sql/dialects";
import { downloadText, safeFilename } from "@/lib/export/raster";

type Target = SqlDialect | "dbml" | "mongodb";

/** Database conversion: paste a schema from one database, get it back for another (MySQL → PostgreSQL, Oracle → BigQuery …). */
export function ConvertModal({ onClose }: { onClose: () => void }) {
  const layout = useLayout();
  const { model: current } = useDiagramModel();
  const fileRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [format, setFormat] = useState<ImportFormat>("auto");
  const [target, setTarget] = useState<Target>("postgres");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => (input.trim() ? importText(input, format) : null), [input, format]);
  const model = result && !result.errors.length ? result.model : null;
  const output = useMemo(() => {
    if (!model) return "";
    if (target === "dbml") return modelToDbml(model);
    if (target === "mongodb") return modelToMongo(model);
    return modelToSql(model, { dialect: target });
  }, [model, target]);

  const typeChanges = useMemo(() => {
    if (!model || target === "dbml" || target === "mongodb") return [];
    const rows: { where: string; from: string; to: string }[] = [];
    const enumNames = new Set(model.enums.map((e) => e.name));
    for (const t of model.tables) {
      for (const c of t.columns) {
        if (enumNames.has(c.type)) continue;
        const to = convertType(c.type, target);
        if (canonicalType(c.type).kind !== "other" && to.toLowerCase().replace(/\s/g, "") !== c.type.toLowerCase().replace(/\s/g, "")) rows.push({ where: `${t.name}.${c.name}`, from: c.type, to });
      }
    }
    return rows;
  }, [model, target]);

  const useCurrent = () => {
    const d = layout.getCanvasApi()?.getSqlDialect() as SqlDialect | undefined;
    setInput(modelToSql(current, { dialect: d || "postgres" }));
    setFormat("sql");
  };

  const onFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      setInput(String(r.result || ""));
      setFormat("auto");
    };
    r.readAsText(f);
  };

  const ext = target === "mongodb" ? "js" : target === "dbml" ? "dbml" : "sql";
  const detected = result?.dialect ? dialectLabel(result.dialect) : result?.format ? IMPORT_FORMATS.find((f) => f.id === result.format)?.label : "";

  return (
    <ModalShell title="Convert database" subtitle="Translate a schema between database systems — types, identity columns, defaults, enums and constraints" icon={<Wrench size={16} />} onClose={onClose} width="max-w-6xl" height="h-[84vh]">
      <div className="flex-1 min-h-0 grid md:grid-cols-[1fr_auto_1fr] gap-0">
        {/* source */}
        <div className="flex flex-col min-h-0 p-4 gap-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <span className={labelCls}>Source</span>
              <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)}>
                <option value="auto" className="bg-[#0a0f1c]">
                  Auto-detect
                </option>
                {IMPORT_FORMATS.map((f) => (
                  <option key={f.id} value={f.id} className="bg-[#0a0f1c]">
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <input ref={fileRef} type="file" className="hidden" accept=".sql,.ddl,.txt,.dbml,.prisma,.py,.rb,.json,.mmd" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <button className={btnGhost} onClick={() => fileRef.current?.click()}>
              <FileUp size={13} /> Open file
            </button>
            <button className={btnGhost} onClick={useCurrent} disabled={!current.tables.length} title="Fill the box with the current diagram as SQL">
              <RefreshCw size={13} /> Current diagram
            </button>
          </div>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder={"-- Paste a CREATE TABLE script (MySQL, PostgreSQL, SQL Server, Oracle, SQLite …)\n-- or DBML / Prisma / Django / Rails / Mermaid"} className="flex-1 min-h-[260px] resize-none rounded-xl bg-[#040810] border border-white/[0.08] p-3 text-[11.5px] font-mono text-white/85 outline-none focus:border-[#4A90D9]/50" />
          <div className="text-[11px] min-h-[18px]">
            {result?.errors.length ? (
              <span className="text-red-300">{result.errors[0]}</span>
            ) : model ? (
              <span className="text-emerald-300/90">
                Detected {detected} · {model.tables.length} tables · {model.refs.length} relationships{result!.warnings.length ? ` · ${result!.warnings.length} warning(s)` : ""}
              </span>
            ) : (
              <span className="text-white/30">Waiting for input…</span>
            )}
          </div>
        </div>

        <div className="hidden md:flex items-center px-1 text-white/25">
          <ArrowRight size={20} />
        </div>

        {/* target */}
        <div className="flex flex-col min-h-0 p-4 gap-3 border-l border-white/[0.06]">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[150px]">
              <span className={labelCls}>Convert to</span>
              <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value as Target)}>
                {SQL_DIALECTS.map((d) => (
                  <option key={d.id} value={d.id} className="bg-[#0a0f1c]">
                    {d.label}
                  </option>
                ))}
                <option value="mongodb" className="bg-[#0a0f1c]">
                  MongoDB (mongosh)
                </option>
                <option value="dbml" className="bg-[#0a0f1c]">
                  DBML
                </option>
              </select>
            </div>
            <button
              className={btnGhost}
              disabled={!output}
              onClick={() => {
                navigator.clipboard.writeText(output);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />} Copy
            </button>
            <button className={btnPrimary} disabled={!output} onClick={() => downloadText(output, safeFilename(`converted_${target}`, ext), "text/plain")}>
              <Download size={13} /> Download
            </button>
          </div>
          <pre className="flex-1 min-h-[260px] rounded-xl bg-[#040810] border border-white/[0.08] p-3 text-[11.5px] font-mono text-white/85 overflow-auto whitespace-pre">{output || "-- The converted schema appears here"}</pre>
          {typeChanges.length > 0 && (
            <details className="text-[11px] rounded-lg border border-white/[0.07] bg-white/[0.02]">
              <summary className="px-3 py-1.5 cursor-pointer text-white/60 hover:text-white">{typeChanges.length} data types were mapped</summary>
              <div className="max-h-32 overflow-y-auto px-3 pb-2 font-mono text-[10.5px] text-white/60 space-y-0.5">
                {typeChanges.slice(0, 80).map((c, i) => (
                  <div key={i}>
                    {c.where}: <span className="text-white/40">{c.from}</span> → <span className="text-[#7ec8ff]">{c.to}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
