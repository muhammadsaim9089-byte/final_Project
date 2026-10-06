"use client";

import { memo, useMemo, useState } from "react";
import { ChevronRight, Crosshair, KeyRound, Link2, Play, Search, Table2, X } from "lucide-react";
import { sqlIdent, type PlaygroundColumn, type PlaygroundTable } from "@/lib/sandbox/engine";

interface Props {
  tables: PlaygroundTable[];
  /** Table keys and "key.column" pairs in the database as last built — anything else was added since and needs a re-sync. */
  built: Set<string> | null;
  onInsert: (text: string) => void;
  /** Runs `SELECT * … LIMIT 100` without touching the editor. */
  onPreview: (table: PlaygroundTable) => void;
  /** Pans the canvas to the table (hidden for junction tables, which aren't drawn). */
  onLocate: (table: PlaygroundTable) => void;
}

const NotSynced = () => <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Not in the playground database yet — Re-sync schema" />;

function ColumnRow({ table, col, isNew, onInsert }: { table: PlaygroundTable; col: PlaygroundColumn; isNew: boolean; onInsert: (text: string) => void }) {
  const text = sqlIdent(col.name);
  const qualified = `${table.sqlName}.${text}`;
  const flags = [col.pk && "primary key", col.ref && `references ${col.ref.table}.${col.ref.column}`, col.notNull && !col.pk && "not null", col.unique && !col.pk && "unique", col.increment && "auto-increment", col.enumValues && `enum: ${col.enumValues.join(", ")}`].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", text)}
      onClick={(e) => onInsert(e.shiftKey || e.altKey ? qualified : text)}
      title={`Insert ${text} at the cursor — Shift+click inserts ${qualified}${flags ? `\n${flags}` : ""}`}
      className="group/col w-full flex items-center gap-1.5 pl-7 pr-2.5 h-[26px] text-left hover:bg-white/[0.05] rounded-md"
    >
      <span className="w-3 shrink-0 flex justify-center">
        {col.pk ? <KeyRound size={11} className="text-amber-400" /> : col.ref ? <Link2 size={11} className="text-sky-400" /> : <span className="w-1 h-1 rounded-full bg-white/20" />}
      </span>
      <span className="font-mono text-[12px] text-white/80 group-hover/col:text-white truncate">{col.name}</span>
      {isNew && <NotSynced />}
      <span className="ml-auto pl-2 flex items-center gap-1 shrink-0">
        {col.notNull && !col.pk && <span className="text-[9px] font-bold text-white/30">NN</span>}
        {col.unique && !col.pk && <span className="text-[9px] font-bold text-white/30">UQ</span>}
        <span className="font-mono text-[10.5px] text-white/35 max-w-[92px] truncate">{col.type}</span>
      </span>
    </button>
  );
}

/**
 * The playground's schema inspector: every table in the playground database with its columns, types and keys, live from
 * the canvas. Clicking (or dragging) a name inserts it at the editor's cursor.
 */
export const SchemaTree = memo(function SchemaTree({ tables, built, onInsert, onPreview, onLocate }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(tables.length <= 4 ? tables.map((t) => t.key) : []));
  const q = query.trim().toLowerCase();

  const visible = useMemo(() => {
    if (!q) return tables.map((t) => ({ t, cols: t.columns, forced: false }));
    const out: { t: PlaygroundTable; cols: PlaygroundColumn[]; forced: boolean }[] = [];
    for (const t of tables) {
      if (t.label.toLowerCase().includes(q)) out.push({ t, cols: t.columns, forced: false });
      else {
        const cols = t.columns.filter((c) => c.name.toLowerCase().includes(q));
        if (cols.length) out.push({ t, cols, forced: true }); // a column matched — show it without making the user expand
      }
    }
    return out;
  }, [tables, q]);

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Schema</span>
          <span className="text-[10px] text-white/30 tabular-nums">{tables.length} table{tables.length === 1 ? "" : "s"}</span>
        </div>
        <label className="flex items-center gap-1.5 h-7 px-2 rounded-md bg-white/[0.04] border border-white/[0.07] focus-within:border-[#4A90D9]/50">
          <Search size={12} className="text-white/35 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.preventDefault(); // clear the filter first; the next Escape reaches the playground
                setQuery("");
              }
            }}
            placeholder="Filter tables & columns"
            aria-label="Filter tables and columns"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-white placeholder:text-white/30"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-white/40 hover:text-white" aria-label="Clear filter">
              <X size={12} />
            </button>
          )}
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-scrollbar px-1.5 pb-3" role="tree" aria-label="Tables">
        {tables.length === 0 ? (
          <p className="px-3 py-4 text-[11.5px] leading-relaxed text-white/40">No tables yet — add tables on the canvas, then Re-sync schema.</p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-4 text-[11.5px] text-white/40">Nothing matches “{query}”.</p>
        ) : (
          visible.map(({ t, cols, forced }) => {
            const expanded = forced || open.has(t.key);
            const isNew = !!built && !built.has(t.key);
            return (
              <div key={t.key} role="treeitem" aria-expanded={expanded} aria-selected={false}>
                <div className="group/tbl flex items-center h-7 rounded-md hover:bg-white/[0.05]">
                  <button type="button" onClick={() => toggle(t.key)} className="w-6 h-7 flex items-center justify-center text-white/40 hover:text-white shrink-0" aria-label={expanded ? `Collapse ${t.label}` : `Expand ${t.label}`}>
                    <ChevronRight size={13} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                  </button>
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", t.sqlName)}
                    onClick={() => onInsert(t.sqlName)}
                    title={`Insert ${t.sqlName} at the cursor${t.label !== t.sqlName ? ` (the diagram's ${t.label})` : ""}${t.junction ? "\nJunction table the export creates for a many-to-many relationship" : ""}`}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                  >
                    <Table2 size={12} className={t.junction ? "text-violet-300/70 shrink-0" : "text-[#4A90D9] shrink-0"} />
                    <span className="font-mono text-[12px] font-semibold text-white/90 truncate">{t.label}</span>
                    {t.junction && <span className="text-[9px] font-bold uppercase tracking-wide text-violet-300/60 shrink-0">N:M</span>}
                    {isNew && <NotSynced />}
                  </button>
                  <span className="text-[10px] text-white/25 tabular-nums px-1.5 group-hover/tbl:hidden">{t.columns.length}</span>
                  <span className="hidden group-hover/tbl:flex items-center pr-1">
                    <button type="button" onClick={() => onPreview(t)} title={`Preview rows — SELECT * FROM ${t.sqlName} LIMIT 100`} className="p-1 rounded text-white/45 hover:text-lime-300 hover:bg-white/[0.06]">
                      <Play size={11} />
                    </button>
                    {!t.junction && (
                      <button type="button" onClick={() => onLocate(t)} title="Show on the canvas" className="p-1 rounded text-white/45 hover:text-white hover:bg-white/[0.06]">
                        <Crosshair size={11} />
                      </button>
                    )}
                  </span>
                </div>
                {expanded && (
                  <div role="group">
                    {cols.map((c) => (
                      <ColumnRow key={c.name} table={t} col={c} isNew={!!built && !isNew && !built.has(`${t.key}.${c.name}`)} onInsert={onInsert} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
