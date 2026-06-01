"use client";

import { useState } from "react";
import { X, Search, BookOpen } from "lucide-react";

const DATA_TYPES = [
  { type: "INT",          desc: "Whole numbers",       pg: "INTEGER",      mysql: "INT",         sqlite: "INTEGER" },
  { type: "VARCHAR(n)",   desc: "Variable-length text", pg: "VARCHAR(n)",   mysql: "VARCHAR(n)",  sqlite: "TEXT" },
  { type: "TEXT",         desc: "Long text content",   pg: "TEXT",         mysql: "TEXT",        sqlite: "TEXT" },
  { type: "BOOLEAN",      desc: "True / False",        pg: "BOOLEAN",      mysql: "TINYINT(1)",  sqlite: "INTEGER" },
  { type: "DATETIME",     desc: "Date & time",         pg: "TIMESTAMP",    mysql: "DATETIME",    sqlite: "TEXT" },
  { type: "DATE",         desc: "Date only",           pg: "DATE",         mysql: "DATE",        sqlite: "TEXT" },
  { type: "DECIMAL(p,s)", desc: "Precise decimals",    pg: "DECIMAL(p,s)", mysql: "DECIMAL(p,s)",sqlite: "REAL" },
  { type: "FLOAT",        desc: "Floating point",      pg: "FLOAT",        mysql: "FLOAT",       sqlite: "REAL" },
  { type: "UUID",         desc: "Unique identifier",   pg: "UUID",         mysql: "CHAR(36)",    sqlite: "TEXT" },
  { type: "SERIAL",       desc: "Auto-increment",      pg: "SERIAL",       mysql: "AUTO_INCREMENT", sqlite: "AUTOINCREMENT" },
];

interface DataTypesPanelProps {
  onClose: () => void;
}

export function DataTypesPanel({ onClose }: DataTypesPanelProps) {
  const [search, setSearch] = useState("");

  const filteredTypes = DATA_TYPES.filter(
    (dt) =>
      dt.type.toLowerCase().includes(search.toLowerCase()) ||
      dt.desc.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-[460px] max-h-[75vh] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#060B15]/95 backdrop-blur-xl shadow-[0_24px_64px_rgba(0,0,0,0.75)] flex flex-col animate-in fade-in slide-in-from-left-6 duration-300 pointer-events-auto">
      
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400">
            <BookOpen size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-tight">Data Type Reference</h3>
            <span className="text-[9px] text-white/30 font-mono tracking-[0.18em] uppercase">SQL Dialect Mapping</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <X size={15} />
        </button>
      </div>

      {/* Interactive Search Bar */}
      <div className="px-6 py-3 border-b border-white/[0.04] bg-white/[0.01] shrink-0">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-3 text-white/30" />
          <input
            type="text"
            placeholder="Search data types (e.g., INT, VARCHAR)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#0E1524]/60 border border-white/[0.06] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-white/20 focus:outline-none focus:border-purple-500/40 focus:bg-[#0E1524]/90 transition-all font-sans"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 text-[10px] text-white/40 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Grid Headers */}
      <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-4 px-6 py-2.5 border-b border-white/[0.04] text-[9px] font-mono text-white/25 tracking-[0.15em] uppercase bg-white/[0.005] shrink-0">
        <span>Type</span>
        <span className="text-purple-400/80 font-bold">PostgreSQL</span>
        <span className="text-orange-400/80 font-bold">MySQL</span>
        <span className="text-sky-400/80 font-bold">SQLite</span>
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto p-scrollbar divide-y divide-white/[0.02]">
        {filteredTypes.length > 0 ? (
          filteredTypes.map((dt, i) => (
            <div
              key={dt.type}
              className={`grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-4 px-6 py-3 text-xs transition-colors hover:bg-white/[0.03] ${
                i % 2 === 0 ? "bg-transparent" : "bg-white/[0.01]"
              }`}
            >
              {/* Type Name & Desc */}
              <div className="flex flex-col pr-2 justify-center">
                <span className="text-lime-green font-mono font-semibold text-[11px] tracking-wide">{dt.type}</span>
                <span className="text-white/40 text-[10px] mt-0.5 leading-snug">{dt.desc}</span>
              </div>
              
              {/* PG */}
              <div className="self-center">
                <span className="inline-block px-1.5 py-0.5 rounded font-mono text-[10px] bg-purple-950/20 border border-purple-500/10 text-purple-300/90 truncate max-w-full">
                  {dt.pg}
                </span>
              </div>

              {/* MySQL */}
              <div className="self-center">
                <span className="inline-block px-1.5 py-0.5 rounded font-mono text-[10px] bg-orange-950/20 border border-orange-500/10 text-orange-300/90 truncate max-w-full">
                  {dt.mysql}
                </span>
              </div>

              {/* SQLite */}
              <div className="self-center">
                <span className="inline-block px-1.5 py-0.5 rounded font-mono text-[10px] bg-sky-950/20 border border-sky-500/10 text-sky-300/90 truncate max-w-full">
                  {dt.sqlite}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
            <span className="text-white/20 text-xs font-mono mb-1">No matching types found</span>
            <span className="text-white/10 text-[10px]">Try typing another dialect keyword</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-white/[0.04] bg-[#040811]/90 flex justify-between items-center text-[10px] text-white/30 font-mono shrink-0">
        <span>Mapped schemas: 10 standard categories</span>
        <span>export_sql.ts</span>
      </div>
    </div>
  );
}

