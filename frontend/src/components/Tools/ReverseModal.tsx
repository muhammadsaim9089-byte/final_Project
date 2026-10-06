"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Database, FileUp, HardDrive, Loader2, Plug, ScrollText, ShieldCheck } from "lucide-react";
import { ModalShell, Tabs, btnPrimary, inputCls, labelCls } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { ImportTarget, importModel } from "./helpers";
import { DiagramModel } from "@/lib/model/types";
import { EXTRACTION_GUIDES } from "@/lib/reverse/catalog";
import { sqliteBytesToModel } from "@/lib/reverse/sqlite";
import { importText } from "@/lib/import";
import { apiErrorMessage } from "@/lib/apiError";

type TabId = "live" | "sqlite" | "dump";

function Preview({ model, label, warnings }: { model: DiagramModel | null; label: string; warnings?: string[] }) {
  const layout = useLayout();
  const [target, setTarget] = useState<ImportTarget>("new");
  if (!model) return null;
  const cols = model.tables.reduce((n, t) => n + t.columns.length, 0);
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4 space-y-3">
      <div className="flex items-center gap-2 text-emerald-300 text-[13px] font-semibold">
        <Check size={15} /> Found {model.tables.length} tables · {cols} columns · {model.refs.length} relationships{model.enums.length ? ` · ${model.enums.length} enums` : ""}
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {model.tables.slice(0, 60).map((t) => (
          <span key={t.name + (t.schema || "")} className="text-[10.5px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-white/70">
            {t.schema ? t.schema + "." : ""}
            {t.name}
          </span>
        ))}
        {model.tables.length > 60 && <span className="text-[10.5px] text-white/40">+{model.tables.length - 60} more</span>}
      </div>
      {warnings && warnings.length > 0 && (
        <details className="text-[11px] text-amber-200/80">
          <summary className="cursor-pointer">{warnings.length} warning(s)</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {warnings.slice(0, 20).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/[0.1] overflow-hidden text-[11px]">
          {(
            [
              ["new", "New diagram"],
              ["replace", "Replace current"],
              ["merge", "Add to current"],
            ] as const
          ).map(([id, name]) => (
            <button key={id} onClick={() => setTarget(id)} className={`px-3 py-1.5 font-semibold ${target === id ? "bg-[#4A90D9]/25 text-white" : "text-white/50 hover:text-white"}`}>
              {name}
            </button>
          ))}
        </div>
        <button
          className={btnPrimary}
          onClick={() => {
            importModel(layout, model, target, label, label);
            layout.closeTool();
          }}
        >
          <Database size={13} /> Import
        </button>
      </div>
    </div>
  );
}

export function ReverseModal({ onClose, sqliteFile }: { onClose: () => void; sqliteFile?: File }) {
  const [tab, setTab] = useState<TabId>(sqliteFile ? "sqlite" : "live");

  // ── live ──
  const [type, setType] = useState<"postgres" | "mysql">("postgres");
  const [url, setUrl] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [schemas, setSchemas] = useState("");
  const [ssl, setSsl] = useState(false);
  const [useUrl, setUseUrl] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [liveModel, setLiveModel] = useState<DiagramModel | null>(null);

  const connect = async () => {
    setBusy(true);
    setError("");
    setLiveModel(null);
    try {
      const body: Record<string, unknown> = useUrl ? { type, url } : { type, host, port: port ? Number(port) : undefined, user, password, database, ssl, schemas: schemas ? schemas.split(",").map((s) => s.trim()).filter(Boolean) : undefined };
      const res = await fetch("/api/reverse-engineer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Connection failed"));
      setLiveModel(data.model);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── sqlite ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [sampleRows, setSampleRows] = useState(0);
  const [sqliteModel, setSqliteModel] = useState<DiagramModel | null>(null);
  const [sqliteWarnings, setSqliteWarnings] = useState<string[]>([]);
  const [sqliteName, setSqliteName] = useState(sqliteFile?.name || "");
  const [sqliteBusy, setSqliteBusy] = useState(false);
  const [sqliteError, setSqliteError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const readSqlite = async (f: File, rows = sampleRows) => {
    setSqliteBusy(true);
    setSqliteError("");
    setSqliteModel(null);
    setSqliteName(f.name);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await sqliteBytesToModel(bytes, { sampleRows: rows });
      if (!r.tableCount) throw new Error("No tables found in this file");
      setSqliteModel(r.model);
      setSqliteWarnings(r.warnings);
    } catch (e: any) {
      setSqliteError(/file is not a database|malformed/i.test(e?.message || "") ? "That file is not a valid SQLite database." : e?.message || "Could not read the file");
    } finally {
      setSqliteBusy(false);
    }
  };
  useEffect(() => {
    if (sqliteFile) void readSqlite(sqliteFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── dump ──
  const [guideId, setGuideId] = useState("postgres");
  const guide = EXTRACTION_GUIDES.find((g) => g.id === guideId)!;
  const [dump, setDump] = useState("");
  const [copied, setCopied] = useState(false);
  const dumpResult = useMemo(() => (dump.trim() ? importText(dump, "sql") : null), [dump]);

  const canConnect = useUrl ? !!url.trim() : !!host.trim() && !!database.trim();

  return (
    <ModalShell title="Reverse engineer" subtitle="Turn an existing database into a diagram" icon={<Plug size={16} />} onClose={onClose} width="max-w-3xl" height="h-[82vh]">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "live", label: "Live database", icon: <Plug size={13} /> },
          { id: "sqlite", label: "SQLite file", icon: <HardDrive size={13} /> },
          { id: "dump", label: "DDL / dump", icon: <ScrollText size={13} /> },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        {tab === "live" && (
          <>
            <div className="flex items-start gap-2 text-[11.5px] text-white/50 bg-white/[0.03] border border-white/[0.07] rounded-lg p-3">
              <ShieldCheck size={14} className="mt-0.5 text-emerald-300 shrink-0" />
              <span>
                DesignDB&apos;s server opens a <b className="text-white/70">read-only</b> connection and only reads catalog metadata (tables, columns, keys, indexes) — no row data. Credentials are used for this request only and never stored. Intended for local / self-hosted use.
              </span>
            </div>
            <div className="flex gap-2">
              {(["postgres", "mysql"] as const).map((t) => (
                <button key={t} onClick={() => setType(t)} className={`px-4 py-2 rounded-lg border text-[12px] font-semibold transition-all ${type === t ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-white" : "border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.05]"}`}>
                  {t === "postgres" ? "PostgreSQL" : "MySQL / MariaDB"}
                </button>
              ))}
              <button className="ml-auto text-[11px] text-[#7ec8ff] hover:underline" onClick={() => setUseUrl((v) => !v)}>
                {useUrl ? "Use separate fields" : "Use connection URL"}
              </button>
            </div>
            {useUrl ? (
              <div>
                <span className={labelCls}>Connection URL</span>
                <input className={`${inputCls} font-mono`} placeholder={type === "postgres" ? "postgres://user:password@host:5432/database" : "mysql://user:password@host:3306/database"} value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Host</span>
                  <input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} />
                </div>
                <div>
                  <span className={labelCls}>Port</span>
                  <input className={inputCls} value={port} onChange={(e) => setPort(e.target.value)} placeholder={type === "postgres" ? "5432" : "3306"} />
                </div>
                <div>
                  <span className={labelCls}>User</span>
                  <input className={inputCls} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <span className={labelCls}>Password</span>
                  <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </div>
                <div>
                  <span className={labelCls}>Database</span>
                  <input className={inputCls} value={database} onChange={(e) => setDatabase(e.target.value)} />
                </div>
                {type === "postgres" && (
                  <div>
                    <span className={labelCls}>Schemas (optional, comma separated)</span>
                    <input className={inputCls} value={schemas} onChange={(e) => setSchemas(e.target.value)} placeholder="public, billing" />
                  </div>
                )}
                <label className="flex items-center gap-2 text-[12px] text-white/70 col-span-2 cursor-pointer">
                  <input type="checkbox" className="accent-[#4A90D9]" checked={ssl} onChange={(e) => setSsl(e.target.checked)} /> Require SSL
                </label>
              </div>
            )}
            <button className={btnPrimary} onClick={connect} disabled={busy || !canConnect}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Read schema
            </button>
            {error && (
              <p className="flex items-start gap-2 text-[12px] text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}
            <Preview model={liveModel} label={useUrl ? "database" : database || "database"} />
          </>
        )}

        {tab === "sqlite" && (
          <>
            <input ref={fileRef} type="file" accept=".db,.sqlite,.sqlite3,.db3" className="hidden" onChange={(e) => e.target.files?.[0] && readSqlite(e.target.files[0])} />
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files[0]) void readSqlite(e.dataTransfer.files[0]);
              }}
              className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${dragOver ? "border-[#4A90D9] bg-[#4A90D9]/10" : "border-white/[0.12] hover:border-white/[0.25] bg-white/[0.02]"}`}
            >
              {sqliteBusy ? <Loader2 className="mx-auto animate-spin text-[#4A90D9]" size={26} /> : <FileUp className="mx-auto text-white/35" size={26} />}
              <p className="text-[13px] font-semibold mt-3">{sqliteName || "Drop a .db / .sqlite file here, or click to choose"}</p>
              <p className="text-[11px] text-white/40 mt-1">The file is read entirely in your browser (WebAssembly) — it never leaves your computer.</p>
            </div>
            <div className="flex items-center gap-3 text-[12px] text-white/60">
              Include sample rows:
              {[0, 10, 50].map((n) => (
                <button key={n} onClick={() => setSampleRows(n)} className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold ${sampleRows === n ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-white" : "border-white/[0.08] text-white/45 hover:text-white"}`}>
                  {n === 0 ? "none" : `first ${n}`}
                </button>
              ))}
            </div>
            {sqliteError && (
              <p className="flex items-start gap-2 text-[12px] text-red-300">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {sqliteError}
              </p>
            )}
            <Preview model={sqliteModel} label={sqliteName.replace(/\.[^.]+$/, "") || "sqlite"} warnings={sqliteWarnings} />
          </>
        )}

        {tab === "dump" && (
          <>
            <p className="text-[12px] text-white/50">Export the structure with your database&apos;s own tool, then paste it here. Works with the output of pg_dump, mysqldump, SSMS “Generate Scripts”, Oracle DBMS_METADATA, Snowflake GET_DDL and more.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXTRACTION_GUIDES.map((g) => (
                <button key={g.id} onClick={() => setGuideId(g.id)} className={`px-3 py-1.5 rounded-full border text-[11.5px] font-semibold ${guideId === g.id ? "bg-[#4A90D9]/20 border-[#4A90D9]/40 text-white" : "border-white/[0.08] text-white/50 hover:text-white"}`}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#040810] p-3 space-y-2">
              <ol className="list-decimal pl-5 text-[11.5px] text-white/60 space-y-0.5">
                {guide.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <div className="relative">
                <pre className="text-[11px] font-mono text-[#9be7a6] bg-black/30 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{guide.script}</pre>
                <button
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-white/70"
                  onClick={() => {
                    navigator.clipboard.writeText(guide.script);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
              {guide.note && <p className="text-[10.5px] text-white/35">{guide.note}</p>}
            </div>
            <textarea value={dump} onChange={(e) => setDump(e.target.value)} spellCheck={false} placeholder="Paste the exported DDL here…" rows={9} className="w-full rounded-xl bg-[#040810] border border-white/[0.08] p-3 text-[11.5px] font-mono text-white/85 outline-none focus:border-[#4A90D9]/50 resize-none" />
            {dumpResult?.errors.length ? <p className="text-[12px] text-red-300">{dumpResult.errors[0]}</p> : <Preview model={dumpResult?.model || null} label="database dump" warnings={dumpResult?.warnings} />}
          </>
        )}
      </div>
    </ModalShell>
  );
}
