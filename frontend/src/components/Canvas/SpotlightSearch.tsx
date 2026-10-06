"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search, Hash, CornerDownLeft, X, Table2, Columns3, Boxes, StickyNote, Braces, Terminal } from "lucide-react";
import { Node } from "@xyflow/react";
import { useLayout, ToolId } from "@/components/Layout/LayoutContext";

interface SpotlightSearchProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: Node[];
  onSelectNode: (nodeId: string) => void;
}

type ResultKind = "table" | "column" | "group" | "note" | "enum" | "command";

interface Result {
  key: string;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  badge?: string;
  color?: string;
  run: () => void;
}

const COMMANDS: { id: ToolId; label: string; hint: string; words: string }[] = [
  { id: "export", label: "Export diagram", hint: "PNG, PDF, SVG, SQL, DBML, docs …", words: "export download png pdf svg sql dbml json mermaid" },
  { id: "share", label: "Share diagram", hint: "Link, embed, password, publish", words: "share link embed publish password" },
  { id: "versions", label: "Version history", hint: "Browse & restore snapshots", words: "version history restore snapshot diff" },
  { id: "templates", label: "Templates", hint: "Start from a ready-made schema", words: "template starter example" },
  { id: "import", label: "Import SQL / DBML / JSON", hint: "Paste or upload a schema", words: "import upload sql dbml json csv" },
  { id: "convert", label: "Convert between databases", hint: "MySQL ⇄ PostgreSQL ⇄ SQL Server …", words: "convert migrate translate dialect" },
  { id: "reverse", label: "Reverse engineer a database", hint: "SQLite file, live connection, DDL dump", words: "reverse engineer introspect connect database" },
  { id: "ai", label: "AI assistant", hint: "Describe changes in plain language", words: "ai assistant chat generate" },
  { id: "enums", label: "Manage enums", hint: "Create and edit enum types", words: "enum types" },
  { id: "groups", label: "Table groups", hint: "Create, colour and organise groups", words: "group groups tablegroup module frame organise" },
  { id: "lineage", label: "Data lineage", hint: "Dependencies between tables, traced", words: "lineage dependency dependencies dep flow upstream downstream" },
  { id: "colors", label: "Colours & visibility", hint: "Filter tables by header colour", words: "color colour hide show filter" },
];

const KIND_ICON: Record<ResultKind, React.ReactNode> = {
  table: <Table2 size={12} />,
  column: <Columns3 size={12} />,
  group: <Boxes size={12} />,
  note: <StickyNote size={12} />,
  enum: <Braces size={12} />,
  command: <Terminal size={12} />,
};

export function SpotlightSearch({ isOpen, onClose, nodes, onSelectNode }: SpotlightSearchProps) {
  const layout = useLayout();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const raw = searchQuery.trim();
    const commandMode = raw.startsWith(">");
    const q = (commandMode ? raw.slice(1) : raw).trim().toLowerCase();
    const out: Result[] = [];

    const commands = COMMANDS.filter((c) => !q || `${c.label} ${c.words}`.toLowerCase().includes(q)).map<Result>((c) => ({
      key: `cmd:${c.id}`,
      kind: "command",
      title: c.label,
      subtitle: c.hint,
      run: () => {
        onClose();
        layout.openTool(c.id);
      },
    }));
    if (commandMode) return commands;

    const tables = nodes.filter((n) => n.type === "tableMode");
    const tableLabel = (n: Node) => String((n.data as any)?.label || "Untitled Table");

    for (const n of tables) {
      const d = n.data as any;
      const label = tableLabel(n);
      if (!q || `${label} ${d.schema || ""} ${d.alias || ""}`.toLowerCase().includes(q)) {
        out.push({
          key: `t:${n.id}`,
          kind: "table",
          title: label,
          subtitle: [d.schema && d.schema !== "public" ? d.schema : "", d.group || ""].filter(Boolean).join(" · ") || undefined,
          badge: `${(d.attributes || []).length} cols`,
          color: d.color || "",
          run: () => onSelectNode(n.id),
        });
      }
    }

    if (q) {
      // columns: "orders.status", "status", type names …
      let columnHits = 0;
      for (const n of tables) {
        const label = tableLabel(n);
        for (const a of ((n.data as any).attributes || []) as any[]) {
          if (columnHits >= 25) break;
          if (`${label}.${a.name} ${a.type || ""} ${a.comment || ""}`.toLowerCase().includes(q)) {
            columnHits++;
            out.push({
              key: `c:${n.id}:${a.name}`,
              kind: "column",
              title: `${label}.${a.name}`,
              subtitle: [a.type, a.isPk ? "primary key" : "", a.isFk ? "foreign key" : "", a.unique && !a.isPk ? "unique" : ""].filter(Boolean).join(" · "),
              run: () => onSelectNode(n.id),
            });
          }
        }
      }

      const groups = new Set<string>([...Object.keys(layout.meta.groups), ...tables.map((n) => String((n.data as any).group || "")).filter(Boolean)]);
      for (const g of groups) {
        if (!g.toLowerCase().includes(q)) continue;
        const members = tables.filter((n) => (n.data as any).group === g);
        if (!members.length) continue;
        out.push({ key: `g:${g}`, kind: "group", title: g, subtitle: `${members.length} table${members.length > 1 ? "s" : ""}`, color: layout.meta.groups[g]?.color, run: () => onSelectNode(members[0].id) });
      }

      for (const n of nodes) {
        if (n.type !== "stickyNote") continue;
        const text = String((n.data as any)?.text || "");
        if (text.toLowerCase().includes(q)) out.push({ key: `n:${n.id}`, kind: "note", title: text.length > 60 ? `${text.slice(0, 60)}…` : text || "Sticky note", run: () => onSelectNode(n.id) });
      }

      for (const e of layout.meta.enums) {
        if (`${e.name} ${e.values.map((v) => v.name).join(" ")}`.toLowerCase().includes(q)) {
          out.push({ key: `e:${e.name}`, kind: "enum", title: e.name, subtitle: e.values.map((v) => v.name).join(", ").slice(0, 70), badge: `${e.values.length} values`, run: () => { onClose(); layout.openTool("enums"); } });
        }
      }

      out.push(...commands.slice(0, 3));
    }
    return out.slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, nodes, layout.meta]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Handle global keyboard nav inside the modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        results[selectedIndex]?.run();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const activeEl = listRef.current?.querySelector("[data-active='true']");
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 p-4 pointer-events-auto" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#080D1A]/95 border border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.85)] rounded-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Box */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06] bg-white/[0.01]">
          <Search size={18} className="text-white/40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-white placeholder-white/35 text-[13px] outline-none border-0 p-0 font-sans"
            placeholder="Search tables, columns, groups, enums… (type > for commands)"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <span className="text-[10px] bg-white/[0.06] border border-white/[0.08] px-1.5 py-0.5 rounded text-white/55 font-mono select-none">ESC</span>
          <button onClick={onClose} className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors" aria-label="Close search">
            <X size={14} />
          </button>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-2 flex flex-col gap-1 p-scrollbar">
          {results.length > 0 ? (
            results.map((r, i) => {
              const isSelected = i === selectedIndex;
              return (
                <button
                  key={r.key}
                  data-active={isSelected}
                  onClick={r.run}
                  onMouseMove={() => selectedIndex !== i && setSelectedIndex(i)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-all border ${
                    isSelected ? "bg-[#4A90D9]/15 border-[#4A90D9]/40 text-white shadow-[0_0_15px_rgba(74,144,217,0.15)]" : "bg-transparent border-transparent text-white/70 hover:bg-white/[0.03] hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {r.kind === "table" ? (
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" style={{ backgroundColor: r.color || "#C2EF4E" }} />
                    ) : (
                      <span className="shrink-0 text-white/45" style={r.color ? { color: r.color } : undefined}>
                        {KIND_ICON[r.kind]}
                      </span>
                    )}
                    <div className="min-w-0">
                      <span className={`font-semibold text-xs tracking-wide block truncate ${r.kind === "column" ? "font-mono" : "font-sans"}`}>{r.title}</span>
                      {r.subtitle && <span className="text-[10px] text-white/40 block truncate">{r.subtitle}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {r.badge && (
                      <span className="text-[10px] text-white/40 font-mono flex items-center gap-1">
                        <Hash size={10} />
                        {r.badge}
                      </span>
                    )}
                    <span className="text-[9px] uppercase tracking-wider text-white/25 font-mono">{r.kind}</span>
                    {isSelected && (
                      <span className="flex items-center gap-0.5 text-[9px] text-[#4A90D9] font-mono font-bold bg-[#4A90D9]/10 px-1.5 py-0.5 rounded border border-[#4A90D9]/20">
                        {r.kind === "command" || r.kind === "enum" ? "open" : "focus"}
                        <CornerDownLeft size={8} />
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="py-8 px-4 text-center text-white/35 text-xs font-sans">Nothing matches “{searchQuery}”.</div>
          )}
        </div>
      </div>
    </div>
  );
}
