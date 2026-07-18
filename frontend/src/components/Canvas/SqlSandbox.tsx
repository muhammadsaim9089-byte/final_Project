"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { Play, RotateCcw, AlertTriangle, CheckCircle, Database, Table, HelpCircle, Loader2, Sparkles } from "lucide-react";
import { Node } from "@xyflow/react";

interface SqlSandboxProps {
  nodes?: Node[];
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
}

interface ColumnInfo {
  name: string;
  type: string;
}

interface QueryResult {
  columns: string[];
  rows: any[][];
  affectedRows?: number;
}

export function SqlSandbox({ nodes, isOpen, onClose, embedded = false }: SqlSandboxProps) {
  const layout = useLayout();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [tablesList, setTablesList] = useState<Record<string, ColumnInfo[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [execTime, setExecTime] = useState<number | null>(null);

  // AI Query Generator state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Hold reference to the sql.js DB instance
  const dbRef = useRef<any>(null);
  const sqlRef = useRef<any>(null);

  // Load sql.js from the public directory
  const loadSqlJs = useCallback(async () => {
    if (sqlRef.current) return; // already loaded

    try {
      // Dynamically import sql.js from public dir via script tag approach
      await new Promise<void>((resolve, reject) => {
        if ((window as any).initSqlJs) {
          resolve();
          return;
        }
        const script = document.createElement("script");
        script.src = "/sql-wasm.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load sql-wasm.js"));
        document.head.appendChild(script);
      });

      const SQL = await (window as any).initSqlJs({
        locateFile: () => "/sql-wasm.wasm",
      });

      sqlRef.current = SQL;
    } catch (err: any) {
      setErrorMessage(`Failed to load SQLite engine: ${err.message}`);
    }
  }, []);

  // Build SQL DDL and seed data from canvas nodes, then create an in-memory SQLite DB
  const buildDatabase = useCallback(async () => {
    if (!sqlRef.current) return;

    setIsLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    setResults(null);

    try {
      // Create fresh in-memory database
      const db = new sqlRef.current.Database();
      dbRef.current = db;

      const schemaMap: Record<string, ColumnInfo[]> = {};

      // Determine which nodes to use: prefer prop, otherwise read from layout's RF instance
      const nodesToUse: Node[] = nodes && nodes.length > 0 ? nodes : (layout?.getRfNodes ? layout.getRfNodes() : []);

      // 1. CREATE TABLE for each node
      for (const node of nodesToUse) {
        const tableName = (node.data.label as string).replace(/\s+/g, "_");
        const attrs = (node.data.attributes as any[]) || [];
        if (attrs.length === 0) continue;

        schemaMap[tableName] = attrs.map((a: any) => ({ name: a.name, type: a.type }));

        const colDefs = attrs.map((a: any) => {
          let colDef = `${a.name} ${mapType(a.type)}`;
          if (a.isPk) colDef += " PRIMARY KEY";
          return colDef;
        }).join(", ");

        db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs});`);
      }

      // 2. Seed sample data
      for (const node of nodesToUse) {
        const tableName = (node.data.label as string).replace(/\s+/g, "_");
        const attrs = (node.data.attributes as any[]) || [];
        if (attrs.length === 0) continue;

        for (let i = 1; i <= 5; i++) {
          const cols = attrs.map((a: any) => a.name).join(", ");
          const vals = attrs.map((a: any) => generateSeedValue(a, i, tableName)).join(", ");
          try {
            db.run(`INSERT INTO ${tableName} (${cols}) VALUES (${vals});`);
          } catch {
            // Silently skip seed errors (e.g. PK conflicts)
          }
        }
      }

      setTablesList(schemaMap);

      // Set default query to first table
      const firstTable = Object.keys(schemaMap)[0];
      if (firstTable) {
        setQuery(`-- Full SQLite engine — all SQL is supported!\nSELECT * FROM ${firstTable} LIMIT 10;`);
      } else {
        setQuery("-- Add tables on the canvas first, then Re-Sync Schema.");
      }

      setDbReady(true);
      setStatusMessage(`SQLite database initialized with ${Object.keys(schemaMap).length} table(s) and sample data.`);
    } catch (err: any) {
      setErrorMessage(`Database init error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [nodes]);
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Map DesignDB attribute types to SQLite affinity types
  function mapType(type: string): string {
    const t = type.toLowerCase();
    if (t.includes("int") || t.includes("serial")) return "INTEGER";
    if (t.includes("float") || t.includes("decimal") || t.includes("numeric")) return "REAL";
    if (t.includes("bool")) return "INTEGER"; // SQLite has no BOOLEAN
    if (t.includes("date") || t.includes("timestamp")) return "TEXT";
    return "TEXT";
  }

  // Generate realistic seed values per column
  function generateSeedValue(attr: any, i: number, tableName: string): string {
    const colName = attr.name.toLowerCase();
    const type = (attr.type || "").toLowerCase();

    if (attr.isPk && (type.includes("int") || type.includes("serial"))) {
      return String(i);
    }
    if (colName.includes("id") && type.includes("int")) return String(i);

    if (colName === "name" || colName.includes("_name") || colName === "full_name") {
      const names = ["Alice Smith", "Bob Johnson", "Carol White", "David Lee", "Eva Martinez"];
      return `'${names[i - 1]}'`;
    }
    if (colName.includes("first_name")) {
      const names = ["Alice", "Bob", "Carol", "David", "Eva"];
      return `'${names[i - 1]}'`;
    }
    if (colName.includes("last_name")) {
      const names = ["Smith", "Johnson", "White", "Lee", "Martinez"];
      return `'${names[i - 1]}'`;
    }
    if (colName.includes("email")) {
      const users = ["alice", "bob", "carol", "david", "eva"];
      return `'${users[i - 1]}@example.com'`;
    }
    if (colName.includes("phone")) return `'555-000${i}'`;
    if (colName.includes("address")) return `'${i * 100} Main St, City'`;
    if (colName.includes("title") || colName.includes("product_name")) {
      return `'${tableName} Item ${i}'`;
    }
    if (colName.includes("price") || colName.includes("amount") || colName.includes("cost")) {
      return String((i * 19.99).toFixed(2));
    }
    if (colName.includes("quantity") || colName.includes("qty") || colName.includes("stock")) {
      return String(i * 10);
    }
    if (colName.includes("status")) {
      return `'${["active", "inactive", "pending", "active", "active"][i - 1]}'`;
    }
    if (colName.includes("country")) {
      return `'${["USA", "UK", "Canada", "Germany", "France"][i - 1]}'`;
    }
    if (colName.includes("description")) return `'Description for ${tableName} ${i}'`;
    if (colName.includes("lifetime_value") || colName.includes("revenue")) return String(i * 250.0);
    if (type.includes("bool")) return i % 2 === 0 ? "1" : "0";
    if (type.includes("date") || type.includes("timestamp")) {
      const d = new Date(Date.now() - i * 24 * 3600 * 1000);
      return `'${d.toISOString().split("T")[0]}'`;
    }
    if (type.includes("int") || type.includes("serial")) return String(i);
    if (type.includes("float") || type.includes("decimal")) return String((i * 1.5).toFixed(2));

    return `'Sample ${i}'`;
  }

  // Initialize sql.js when the sandbox opens
  useEffect(() => {
    if (!isOpen) return;
    const init = async () => {
      await loadSqlJs();
      await buildDatabase();
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Execute query against real SQLite
  const executeQuery = useCallback(() => {
    if (!dbRef.current) {
      setErrorMessage("SQLite engine not ready. Please wait or Re-Sync Schema.");
      return;
    }

    setStatusMessage("");
    setErrorMessage("");
    setResults(null);
    setExecTime(null);

    const cleanQuery = query.replace(/--.*$/gm, "").trim();
    if (!cleanQuery) {
      setErrorMessage("Please enter an SQL query.");
      return;
    }

    const start = performance.now();
    try {
      const stmts = dbRef.current.exec(cleanQuery);
      const elapsed = performance.now() - start;
      setExecTime(Math.round(elapsed * 100) / 100);

      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        setResults({ columns: last.columns, rows: last.values });
        setStatusMessage(`Query OK — ${last.values.length} row(s) returned in ${elapsed.toFixed(1)}ms`);
      } else {
        // DML statement (INSERT, UPDATE, DELETE, CREATE, etc.)
        const changes = dbRef.current.getRowsModified();
        setStatusMessage(`Query OK — ${changes} row(s) affected in ${elapsed.toFixed(1)}ms`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "An error occurred executing query.");
    }
  }, [query]);

  // Handle keyboard shortcut Ctrl+Enter to run query
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
  };

  // AI Query Generator
  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, tables: tablesList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI generation failed");
      if (data.query) {
        setQuery(data.query);
        setAiPrompt("");
      }
    } catch (err: any) {
      setAiError(err.message || "Failed to generate query");
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAiGenerate();
    }
  };

  if (!isOpen) return null;

  const containerClass = embedded
    ? "flex-1 overflow-hidden bg-transparent"
    : "absolute bottom-6 z-40 bg-[#060B15]/97 backdrop-blur-xl border border-white/[0.08] flex flex-col rounded-2xl shadow-[0_16px_64px_rgba(0,0,0,0.85)] h-[360px] animate-in slide-in-from-bottom-6 duration-300 pointer-events-auto";

  // Offset the popup to avoid being overlapped by the permanent left sidebar (w-16 / 64px).
  // Keep original small gap of 24px from the sidebar and right edge.
  const SIDEBAR_WIDTH_PX = 64; // matches NavigationSidebar w-16
  const SANDBOX_GAP_LEFT_PX = 24; // equivalent to previous left-6 (24px)
  const SANDBOX_GAP_RIGHT_PX = 24; // equivalent to previous right-6 (24px)
  const containerStyle: React.CSSProperties | undefined = embedded
    ? undefined
    : { left: `${SIDEBAR_WIDTH_PX + SANDBOX_GAP_LEFT_PX}px`, right: `${SANDBOX_GAP_RIGHT_PX}px` };

  return (
    <div className={containerClass} style={containerStyle}>
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.06] flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1 rounded bg-[#4A90D9]/10 text-[#4A90D9]">
            <Database size={14} />
          </div>
          <div>
            <h3 className="font-semibold text-xs text-white uppercase tracking-wider font-sans">Live SQLite Playground Sandbox</h3>
            <span className="text-[10px] text-white/50 block font-medium">
              Full SQLite engine — GROUP BY, HAVING, CASE, aggregates &amp; more &nbsp;·&nbsp;
              <kbd className="bg-white/[0.06] border border-white/[0.08] rounded px-1 py-0.5 text-[9px] font-mono">Ctrl+Enter</kbd> to run
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={async () => { setDbReady(false); await buildDatabase(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08] text-[11px] font-semibold transition-all"
            title="Re-initialize database from canvas schema"
          >
            <RotateCcw size={12} />
            Re-Sync Schema
          </button>
          <button
            onClick={onClose}
            className="text-white/65 hover:text-white hover:bg-white/[0.06] rounded-md text-xs p-1 px-1.5 transition-all"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Schema + Query Input */}
        <div className="flex-[1.2] flex flex-col border-r border-white/[0.06] p-4 gap-3">
          <div className="flex justify-between items-center shrink-0">
            <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">SQL Console</span>
            <button
              onClick={executeQuery}
              disabled={!dbReady || isLoading}
              className="flex items-center gap-1 px-3 py-1 bg-[#4A90D9] text-white hover:bg-[#4A90D9]/90 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(74,144,217,0.25)]"
            >
              {isLoading ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} fill="currentColor" />}
              Run Query
            </button>
          </div>

          <div className="flex-1 flex gap-3 min-h-0">
            {/* Schema index */}
            <div className="w-40 overflow-y-auto bg-white/[0.01] border border-white/[0.04] rounded-xl p-2.5 flex flex-col gap-2 p-scrollbar select-none shrink-0">
              <span className="text-[9px] text-white/65 font-mono uppercase tracking-wider block border-b border-white/[0.04] pb-1 mb-1">Tables</span>
              {Object.keys(tablesList).length === 0 ? (
                <div className="text-[10px] text-white/30 italic">No tables yet.</div>
              ) : (
                Object.entries(tablesList).map(([tName, cols]) => (
                  <div key={tName} className="flex flex-col gap-0.5">
                    <button
                      className="text-xs text-[#C9C8C7] font-semibold flex items-center gap-1 hover:text-[#4A90D9] transition-colors text-left"
                      onClick={() => setQuery(`SELECT * FROM ${tName} LIMIT 10;`)}
                      title={`Click to SELECT from ${tName}`}
                    >
                      <Table size={10} className="text-[#4A90D9]/60 shrink-0" />
                      {tName}
                    </button>
                    <div className="pl-3.5 flex flex-col">
                      {cols.map(c => (
                        <span key={c.name} className="text-[9px] text-white/50 font-mono leading-relaxed">
                          {c.name} <span className="text-white/20">({c.type})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* AI Query Generator */}
            <div className="shrink-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <div className="flex-1 relative">
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#b38fff]/60 pointer-events-none">
                    <Sparkles size={11} />
                  </div>
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={handleAiKeyDown}
                    placeholder='Ask AI: "show top 5 customers by total orders"'
                    className="w-full bg-[#0A0E1A] border border-[#b38fff]/20 rounded-lg pl-8 pr-2.5 py-1.5 text-[11px] text-white/80 placeholder-white/25 font-mono outline-none focus:border-[#b38fff]/50 transition-colors"
                    disabled={aiLoading || !dbReady}
                  />
                </div>
                <button
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiPrompt.trim() || !dbReady}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-gradient-to-r from-[#b38fff]/20 to-[#4A90D9]/20 border border-[#b38fff]/30 text-[#b38fff] hover:from-[#b38fff]/30 hover:to-[#4A90D9]/30 transition-all disabled:opacity-30 whitespace-nowrap"
                >
                  {aiLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                  Generate
                </button>
              </div>
              {aiError && (
                <span className="text-[9px] text-red-400/80 font-mono pl-1">{aiError}</span>
              )}
            </div>

            {/* Query editor */}
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-[#040810] border border-white/[0.08] rounded-xl p-3 text-xs text-white/95 font-mono outline-none focus:border-[#4A90D9]/40 resize-none leading-relaxed p-scrollbar"
              spellCheck="false"
              placeholder="Write any SQL here..."
            />
          </div>
        </div>

        {/* Right: Results */}
        <div className="flex-1 flex flex-col p-4 bg-white/[0.005] overflow-hidden min-h-0">
          <div className="flex items-center justify-between mb-2 shrink-0">
            <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Query Output</span>
            {execTime !== null && (
              <span className="text-[9px] text-white/30 font-mono">{execTime}ms</span>
            )}
          </div>

          <div className="flex-1 overflow-auto bg-[#040810]/40 border border-white/[0.04] rounded-xl p-3 p-scrollbar flex flex-col gap-2 min-h-0">
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-white/50 py-8 justify-center">
                <Loader2 size={14} className="animate-spin text-[#4A90D9]" />
                Initializing SQLite engine...
              </div>
            )}

            {errorMessage && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-lg leading-relaxed shrink-0">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {statusMessage && !errorMessage && (
              <div className="flex items-center gap-2 text-[11px] text-lime-green font-mono bg-lime-500/5 border border-lime-500/10 px-3 py-2 rounded-lg shrink-0">
                <CheckCircle size={12} className="shrink-0 text-lime-green" />
                <span>{statusMessage}</span>
              </div>
            )}

            {!results && !errorMessage && !isLoading && (
              <div className="flex flex-col items-center justify-center text-white/35 py-10 gap-1.5 flex-1 select-none">
                <HelpCircle size={26} className="text-white/20" />
                <span className="text-xs">Run a query to see results here.</span>
                <span className="text-[10px] text-white/20">Full SQL supported: GROUP BY, HAVING, CASE, JOINs, aggregates...</span>
              </div>
            )}

            {results && results.rows.length > 0 && (
              <div className="overflow-auto border border-white/[0.06] rounded-xl bg-[#04070e]/80">
                <table className="w-full text-left text-xs border-collapse min-w-max">
                  <thead>
                    <tr className="bg-white/[0.03] border-b border-white/[0.06]">
                      {results.columns.map(col => (
                        <th key={col} className="p-2.5 font-bold text-white/70 font-mono tracking-wide whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row, rIdx) => (
                      <tr key={rIdx} className="border-b border-white/[0.03] last:border-none hover:bg-white/[0.015] transition-colors">
                        {row.map((cell: any, cIdx: number) => (
                          <td key={cIdx} className="p-2.5 font-mono text-slate-300 whitespace-nowrap">
                            {cell === null ? <span className="text-white/20 italic">NULL</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {results && results.rows.length === 0 && !errorMessage && (
              <div className="text-xs text-white/50 italic p-3 text-center">Empty set — no rows match the query.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
