"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Code2, Copy, Database, FileCode, FileSpreadsheet, Info, Plug, Upload, Wrench } from "lucide-react";
import { ModalShell, btnGhost, btnPrimary } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { IMPORT_SOURCES, ImportSource, analyzeImport, getImportSource, sourceForFormat } from "@/lib/import/sources";
import { parseDbml } from "@/lib/dbml/parser";
import { modelToDbml } from "@/lib/dbml/serializer";
import { tableKeyOf } from "@/lib/model/types";
import { csvTableName } from "@/lib/import/csv";

type Mode = "merge" | "replace" | "append";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "merge", label: "Merge", hint: "Adds the new tables and keeps what is already in the diagram. Tables with the same name are skipped." },
  { id: "replace", label: "Replace", hint: "Replaces the whole diagram with the imported schema. A restore point is saved first." },
  { id: "append", label: "Append DBML", hint: "Converts the schema to DBML and adds it to the end of the code. Fails if a table already exists." },
];

const DB_EXT = ["db", "sqlite", "sqlite3", "db3"];
const CSV_EXT = ["csv", "tsv"];
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() || "";
const MAX_FILE = 25 * 1024 * 1024;

/** Renders <placeholders> in a command highlighted, like dbdiagram.io. */
function CodeBlock({ code, shell }: { code: string; shell?: boolean }) {
  const [copied, setCopied] = useState(false);
  const parts = code.split(/(<[A-Za-z_]+>)/g);
  return (
    <div className="relative group rounded-xl bg-[#111a2e] border border-white/[0.07] px-4 py-3.5 pr-11">
      <pre className="text-[12.5px] leading-relaxed font-mono text-white/90 whitespace-pre-wrap break-words">
        {shell && <span className="text-white/35 select-none mr-2.5">$</span>}
        {parts.map((p, i) => (/^<[A-Za-z_]+>$/.test(p) ? <span key={i} className="text-amber-400">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>))}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
        className="absolute top-2.5 right-2.5 p-1.5 rounded-md text-white/35 hover:text-white hover:bg-white/10 transition-colors"
        title="Copy"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function SourceMenu({ value, onChange }: { value: ImportSource; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const groups: { title: string; items: ImportSource[] }[] = [
    { title: "", items: IMPORT_SOURCES.filter((s) => s.group === "auto") },
    { title: "Databases (SQL)", items: IMPORT_SOURCES.filter((s) => s.group === "database") },
    { title: "Schema files", items: IMPORT_SOURCES.filter((s) => s.group === "file") },
    { title: "Data files", items: IMPORT_SOURCES.filter((s) => s.group === "data") },
  ];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 pl-3.5 pr-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.09] text-[13.5px] font-semibold text-white transition-colors min-w-[250px] justify-between" aria-haspopup="listbox" aria-expanded={open}>
        <span className="flex items-center gap-2.5">
          <Upload size={15} className="text-[#4A90D9]" />
          {value.id === "auto" ? "Import — Auto-detect" : `Import from ${value.label}`}
        </span>
        <ChevronDown size={15} className={`text-white/50 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 w-[300px] max-h-[60vh] overflow-y-auto overscroll-contain scrollbar-hide rounded-xl bg-[#0a101f] border border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.6)] py-2" role="listbox">
          {groups.map((g) => (
            <div key={g.title || "auto"}>
              {g.title && <div className="px-4 pt-2.5 pb-1 text-[10.5px] font-bold uppercase tracking-widest text-white/35">{g.title}</div>}
              {g.items.map((s) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={s.id === value.id}
                  onClick={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-[13.5px] transition-colors ${s.id === value.id ? "bg-[#4A90D9]/15 text-white" : "text-white/80 hover:bg-white/[0.06] hover:text-white"}`}
                >
                  <span className="flex items-center gap-2.5">
                    {s.group === "database" ? <Database size={14} className="text-[#4A90D9]" /> : s.group === "file" ? <Code2 size={14} className="text-violet-300" /> : s.group === "data" ? <FileSpreadsheet size={14} className="text-emerald-300" /> : <FileCode size={14} className="text-emerald-300" />}
                    {s.label}
                  </span>
                  {s.id === value.id && <Check size={14} className="text-[#4A90D9]" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ImportModal({ onClose, initialSource }: { onClose: () => void; initialSource?: string }) {
  const layout = useLayout();
  const [sourceId, setSourceId] = useState(getImportSource(initialSource).id);
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [showInstructions, setShowInstructions] = useState(true);
  const [mode, setMode] = useState<Mode>("merge");
  const [error, setError] = useState("");
  const [showWarnings, setShowWarnings] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const source = getImportSource(sourceId);

  // parse a moment after typing stops — it drives the summary line and enables Submit
  const [debounced, setDebounced] = useState({ text: "", filename: "", sourceId });
  useEffect(() => {
    const id = setTimeout(() => setDebounced({ text, filename, sourceId }), text.length > 200_000 ? 600 : 250);
    return () => clearTimeout(id);
  }, [text, filename, sourceId]);
  const analysis = useMemo(() => analyzeImport(debounced.text, getImportSource(debounced.sourceId), debounced.filename), [debounced]);
  const settled = debounced.text === text && debounced.sourceId === sourceId;
  const result = analysis.result;
  const ok = settled && !analysis.empty && !!result && result.errors.length === 0;

  const loadFile = async (file: File) => {
    setError("");
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    // SQLite databases are opened by the reverse-engineering tool (read in the browser)
    if (DB_EXT.includes(ext)) {
      layout.openTool("reverse", { sqliteFile: file });
      return;
    }
    if (file.size > MAX_FILE) {
      setError("That file is larger than 25 MB — export a smaller (schema-only) dump.");
      return;
    }
    const content = await file.text();
    setText(content);
    setFilename(file.name);
    // a file that is not what the chosen source expects switches to the matching source
    const guess = analyzeImport(content, getImportSource("auto"), file.name);
    if (guess.detected && source.format !== "auto" && guess.detected !== source.format) setSourceId(sourceForFormat(guess.detected).id);
  };

  /** Several CSV files at once become one text, each file under a `-- table: <file name>` line (one table per file). */
  const loadFiles = async (list: FileList | File[] | null | undefined) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    const csvs = files.filter((f) => CSV_EXT.includes(extOf(f.name)));
    if (!csvs.length || csvs.length !== files.length) return loadFile(files[0]);
    setError("");
    if (csvs.some((f) => f.size > MAX_FILE)) return setError("A file is larger than 25 MB — import a smaller extract (only the first rows are kept as sample data anyway).");
    const parts = await Promise.all(csvs.map(async (f) => `-- table: ${csvTableName(f.name)}\n${(await f.text()).replace(/^\uFEFF/, "").trimEnd()}\n`));
    setText(parts.join("\n"));
    setFilename(csvs.length === 1 ? csvs[0].name : "");
    setSourceId("csv");
  };

  const submit = () => {
    setError("");
    const api = layout.getCanvasApi();
    if (!api) return setError("The canvas is not ready yet — try again in a moment.");
    if (!ok || !result) return;
    const { model } = result;
    if (mode === "append") {
      // DBML would accept the same table twice and silently keep one — stop that here
      const current = api.getModel();
      const haveTables = new Set(current.tables.map(tableKeyOf));
      const dupTables = model.tables.filter((t) => haveTables.has(tableKeyOf(t))).map((t) => t.name);
      const haveEnums = new Set(current.enums.map((e) => `${e.schema || ""}.${e.name}`));
      const dupEnums = model.enums.filter((e) => haveEnums.has(`${e.schema || ""}.${e.name}`)).map((e) => e.name);
      const dupes = [...dupTables, ...dupEnums];
      if (dupes.length) {
        return setError(`Already in the diagram: ${dupes.slice(0, 5).join(", ")}${dupes.length > 5 ? ` and ${dupes.length - 5} more` : ""}. Use Merge to skip them, or Replace to start over.`);
      }
      const existing = layout.dbmlText || "";
      const incoming = modelToDbml(model);
      const combined = existing.trim() ? `${existing.trimEnd()}\n\n${incoming}\n` : `${incoming}\n`;
      const check = parseDbml(combined);
      if (!check.ok) {
        const first = check.diagnostics.find((d) => d.severity === "error");
        return setError(`Appending would break the DBML${first ? ` (line ${first.line}: ${first.message})` : ""}. Use Merge to skip tables that already exist.`);
      }
      void api.saveVersion("restore-point", "Before import");
      layout.editDbml(combined);
      setTimeout(() => api.fitView(), 1100);
      showToast(`Appended ${model.tables.length} tables to the DBML`, "success");
    } else {
      api.applyModel(model, { mode, layout: "auto", fit: true, restorePoint: "Before import" });
      const n = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;
      showToast(`Imported ${n(model.tables.length, "table")} · ${n(model.refs.length, "relationship")} from ${analysis.label}${result.warnings.length ? ` — ${n(result.warnings.length, "warning")}` : ""}`, "success");
    }
    onClose();
  };

  const modeInfo = MODES.find((m) => m.id === mode)!;

  return (
    <ModalShell
      title="Import"
      subtitle="Bring an existing schema into your diagram"
      icon={<Upload size={16} />}
      onClose={onClose}
      width="max-w-6xl"
      height="h-[86vh]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex rounded-xl border border-white/[0.1] overflow-hidden shrink-0" role="radiogroup" aria-label="What to do with the imported schema">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  onClick={() => {
                    setMode(m.id);
                    setError("");
                  }}
                  title={m.hint}
                  className={`px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${mode === m.id ? "bg-[#4A90D9]/25 text-white" : "text-white/50 hover:text-white hover:bg-white/[0.05]"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="hidden md:block text-[11.5px] text-white/40 leading-snug max-w-md">{modeInfo.hint}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button className={`${btnGhost} !px-5 !py-2.5 !text-[13px]`} onClick={onClose}>
              Cancel
            </button>
            <button className={`${btnPrimary} !px-6 !py-2.5 !text-[13px]`} onClick={submit} disabled={!ok}>
              Submit
            </button>
          </div>
        </div>
      }
    >
      {/* top bar: source · instructions · upload */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <SourceMenu
            value={source}
            onChange={(id) => {
              setSourceId(id);
              setError("");
            }}
          />
          <button
            type="button"
            role="switch"
            aria-checked={showInstructions}
            onClick={() => setShowInstructions((v) => !v)}
            className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.09] text-[13px] font-semibold text-white/90 transition-colors"
          >
            <Info size={15} className="text-white/60" />
            Instructions
            <span className={`relative w-9 h-5 rounded-full transition-colors ${showInstructions ? "bg-[#4A90D9]" : "bg-white/15"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${showInstructions ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept={source.accept}
            multiple
            className="hidden"
            onChange={(e) => {
              void loadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.09] text-[13px] font-semibold text-white transition-colors">
            <Upload size={15} /> Upload file
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* instructions */}
        {showInstructions && (
          <aside className="w-[40%] max-w-[460px] min-w-[300px] shrink-0 border-r border-white/[0.06] bg-[#0d1424] overflow-y-auto overscroll-contain scrollbar-hide p-6 space-y-4">
            <h3 className="text-2xl font-bold text-white">{source.title}</h3>
            {source.blocks.map((b, i) =>
              b.kind === "code" ? (
                <CodeBlock key={i} code={b.code} shell={b.shell} />
              ) : (
                <p key={i} className={`leading-relaxed ${/^(Example|Option [AB])/.test(b.text) ? "text-[14px] font-semibold text-white pt-1" : "text-[13.5px] text-white/75"}`}>
                  {b.text}
                </p>
              )
            )}
            <div className="pt-4 mt-2 border-t border-white/[0.07] space-y-2">
              <p className="text-[10.5px] font-bold uppercase tracking-widest text-white/35">Other ways to import</p>
              <button onClick={() => layout.openTool("reverse")} className="w-full flex items-center gap-3 text-left px-3.5 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.06] transition-colors">
                <Plug size={16} className="text-emerald-400 shrink-0" />
                <span>
                  <span className="block text-[13px] font-semibold text-white/90">Connect to a live database</span>
                  <span className="block text-[11.5px] text-white/40">Read PostgreSQL / MySQL directly, or open a SQLite file</span>
                </span>
              </button>
              <button onClick={() => layout.openTool("convert")} className="w-full flex items-center gap-3 text-left px-3.5 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.06] transition-colors">
                <Wrench size={16} className="text-amber-300 shrink-0" />
                <span>
                  <span className="block text-[13px] font-semibold text-white/90">Convert between databases</span>
                  <span className="block text-[11.5px] text-white/40">MySQL → PostgreSQL → Oracle …</span>
                </span>
              </button>
            </div>
          </aside>
        )}

        {/* paste area + live summary */}
        <section className="flex-1 min-w-0 flex flex-col">
          <div
            className="relative flex-1 min-h-0"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void loadFiles(e.dataTransfer.files);
            }}
          >
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFilename("");
                setError("");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && ok) submit();
              }}
              placeholder={source.placeholder}
              spellCheck={false}
              wrap="off"
              autoFocus
              aria-label="Schema to import"
              className="absolute inset-0 w-full h-full resize-none bg-[#1e1e1e] text-[#e6e6e6] placeholder:text-[#6f8f8c] font-mono text-[13px] leading-6 p-5 outline-none overflow-auto whitespace-pre code-scroll"
            />
            {dragging && (
              <div className="absolute inset-3 rounded-xl border-2 border-dashed border-[#4A90D9] bg-[#4A90D9]/10 flex items-center justify-center pointer-events-none">
                <span className="flex items-center gap-2 text-[15px] font-semibold text-white">
                  <Upload size={18} /> Drop to import — several CSV files at once are fine
                </span>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/[0.07] bg-[#161616] px-5 py-3 min-h-[52px] text-[13px]" aria-live="polite">
            {analysis.empty || !settled ? (
              <span className="text-white/40">{text.trim() ? "Reading…" : "Paste your schema, drop a file here, or use Upload file."}</span>
            ) : result && result.errors.length === 0 ? (
              <div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-2 text-emerald-300 font-semibold">
                    <CheckCircle2 size={16} /> Detected {analysis.label}
                  </span>
                  <span className="text-white/70">
                    {result.model.tables.length} table{result.model.tables.length !== 1 ? "s" : ""} · {result.model.refs.length} relationship{result.model.refs.length !== 1 ? "s" : ""}
                    {result.model.enums.length ? ` · ${result.model.enums.length} enum${result.model.enums.length !== 1 ? "s" : ""}` : ""}
                    {result.model.groups.length ? ` · ${result.model.groups.length} group${result.model.groups.length !== 1 ? "s" : ""}` : ""}
                  </span>
                  {result.warnings.length > 0 && (
                    <button onClick={() => setShowWarnings((s) => !s)} className="flex items-center gap-1.5 text-amber-300 hover:text-amber-200 font-medium">
                      <AlertTriangle size={14} /> {result.warnings.length} warning{result.warnings.length !== 1 ? "s" : ""} {showWarnings ? "▴" : "▾"}
                    </button>
                  )}
                </div>
                {showWarnings && result.warnings.length > 0 && (
                  <ul className="mt-2 max-h-28 overflow-y-auto scrollbar-hide space-y-0.5 text-[12px] text-amber-200/80 font-mono">
                    {result.warnings.slice(0, 40).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="flex items-start gap-2 text-red-300">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" /> <span>{result?.errors[0] || "Could not read this input."}</span>
                </span>
                {analysis.mismatch && analysis.detected && (
                  <button
                    onClick={() => {
                      setSourceId(sourceForFormat(analysis.detected!).id);
                      setError("");
                    }} className="px-3 py-1 rounded-lg bg-[#4A90D9]/20 border border-[#4A90D9]/40 text-white text-[12px] font-semibold hover:bg-[#4A90D9]/30">
                    Looks like {sourceForFormat(analysis.detected).id === "auto" ? "SQL" : sourceForFormat(analysis.detected).label} — switch source
                  </button>
                )}
              </div>
            )}
            {error && (
              <p className="mt-1.5 flex items-start gap-2 text-red-300">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
              </p>
            )}
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
