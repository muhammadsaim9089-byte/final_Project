"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLayout } from "./LayoutContext";
import { parseSqlDdl, ParsedSchema } from "@/lib/sqlParser";
// Lightweight in-repo SQL editor (line numbers + basic syntax highlighting)

// Lightweight wrapper that uses a textarea fallback when Monaco not available in SSR.
// For production-grade, use dynamic import of Monaco or CodeMirror. Here we implement a simple monaco loader.

export function SQLCodePanel() {
  const layout = useLayout();
  const [sqlText, setSqlText] = useState("");
  const [importText, setImportText] = useState("");
  const [activeTab, setActiveTab] = useState<"editor" | "import">("editor");
  const [compileError, setCompileError] = useState<string | null>(null);
  const [isValidSql, setIsValidSql] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // When layout's generatedSql updates, keep editor text in sync
  useEffect(() => {
    setSqlText(layout.generatedSql || "");
  }, [layout.generatedSql]);

  // Keep local activeTab in sync with layout context when changed externally
  // no external activeTab sync after reverting sandbox embedding

  // No Monaco import to avoid bundling errors. Use simple textarea editor fallback for now.
  useEffect(() => {
    layout.setGeneratedSql(sqlText);
  }, [sqlText]);

  // Validation & compile checks
  const runValidation = () => {
    setCompileError(null);
    setIsValidSql(true);
    try {
      // Use the existing SQL parser to check AST consistency
      const parsed = parseSqlDdl(sqlText || importText || "");
      // If parse yields no entities, treat as error when trying to Apply
      if (parsed.entities.length === 0) {
        throw new Error('No CREATE TABLE statements detected.');
      }
      // On success, apply parsed schema
      layout.applyParsedSchema(parsed as ParsedSchema);
    } catch (err: any) {
      setCompileError(err.message || 'SQL parse error');
      setIsValidSql(false);
    }
  };

  const handleApplyChanges = () => {
    setCompileError(null);
    try {
      const parsed = parseSqlDdl(sqlText || "");
      if (parsed.entities.length === 0) {
        setCompileError('No CREATE TABLE statements found.');
        setIsValidSql(false);
        return;
      }
      layout.applyParsedSchema(parsed);
    } catch (err: any) {
      setCompileError(err.message || 'Failed to compile SQL');
      setIsValidSql(false);
    }
  };

  const handleGenerateFromImport = () => {
    setCompileError(null);
    try {
      const parsed = parseSqlDdl(importText || "");
      if (parsed.entities.length === 0) {
        setCompileError('No CREATE TABLE statements found in import.');
        setIsValidSql(false);
        return;
      }
      layout.applyParsedSchema(parsed);
      setImportText("");
      setActiveTab('editor');
    } catch (err: any) {
      setCompileError(err.message || 'Import failed to parse');
      setIsValidSql(false);
    }
  };

  // Panel slide-in animation class
  const panelClasses = useMemo(() => {
    return `fixed top-0 left-16 h-screen z-40 bg-[#060b12]/95 backdrop-blur-xl border-r border-white/[0.06] shadow-[0_20px_60px_rgba(0,0,0,0.8)] transition-all duration-300 overflow-hidden ${layout.isSqlOpen ? 'w-[35vw] translate-x-0' : 'w-0 -translate-x-0'} `;
  }, [layout.isSqlOpen]);

  // Basic SQL highlighter (returns HTML) — lightweight, no external deps
  const escapeHtml = (str: string) =>
    str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m as '&' | '<' | '>' | '"' | "'"]));

  const highlightSql = (code: string) => {
    if (!code) return '';
    const keywords = [
      'SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','PRIMARY','KEY','FOREIGN','REFERENCES','NOT','NULL','DEFAULT','INT','VARCHAR','TEXT','JOIN','LEFT','RIGHT','INNER','OUTER','ON','GROUP','BY','ORDER','HAVING','AS','AND','OR','LIMIT','OFFSET','ALTER','ADD','COLUMN','DROP','INDEX','UNIQUE'
    ];
    const esc = escapeHtml(code);
    const kwRegex = new RegExp('\\b(' + keywords.join('|') + ')\\b', 'gi');
    let result = esc.replace(kwRegex, (m) => `<span class="text-[#b38fff] font-semibold">${m}</span>`);
    // strings
    result = result.replace(/'[^']*'/g, (m) => `<span class="text-[#9be7a6]">${m}</span>`);
    // numbers
    result = result.replace(/\b(\d+)\b/g, (m) => `<span class="text-[#f6c85f]">${m}</span>`);
    return result;
  };

  return (
    <div aria-hidden={!layout.isSqlOpen} className={panelClasses} style={{ minWidth: layout.isSqlOpen ? '420px' : '0' }}>
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col p-4 gap-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">SQL Code Workspace</h4>
            <div className="flex items-center gap-2">
                <button onClick={() => { setActiveTab('editor'); }} className={`text-xs px-2 py-1 rounded ${activeTab === 'editor' ? 'bg-white/[0.04]' : ''}`}>Read & Modify</button>
                <button onClick={() => { setActiveTab('import'); }} className={`text-xs px-2 py-1 rounded ${activeTab === 'import' ? 'bg-white/[0.04]' : ''}`}>Import</button>
              </div>
          </div>

          {/* Editor Section */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col gap-2">
              <div className={`relative flex-1 rounded-xl overflow-hidden border ${isValidSql ? 'border-white/[0.06]' : 'border-red-500/60'} p-0 bg-[#040810]`}> 
                {/* Simple editor: left gutter with line numbers + highlighted pre behind a transparent textarea */}
                <div className="h-full flex">
                  <div className="w-12 pt-3 pr-3 text-right text-xs text-white/60 select-none overflow-auto">
                    {sqlText.split('\n').map((_, i) => (
                      <div key={i} className="leading-6">{i + 1}</div>
                    ))}
                  </div>

                  <div className="relative flex-1">
                    <pre className="pointer-events-none whitespace-pre-wrap break-words p-3 text-sm leading-6 font-mono text-white" dangerouslySetInnerHTML={{ __html: highlightSql(sqlText || '') }} />
                    <textarea
                      value={sqlText}
                      onChange={(e) => setSqlText(e.target.value)}
                      className="absolute inset-0 p-3 bg-transparent text-transparent caret-white resize-none outline-none text-sm font-mono leading-6"
                    />
                    {!isValidSql && (
                      <div className="absolute top-3 right-3 text-xs text-red-400 bg-red-500/5 px-2 py-1 rounded">Compilation error</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-white/60">
                  <span>SQL Dialect:</span>
                  <select className="bg-transparent border border-white/[0.06] p-1 rounded text-xs" defaultValue={"postgres"}>
                    <option value="postgres">Postgres</option>
                    <option value="mysql">MySQL</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={runValidation} className="px-3 py-1 text-xs rounded bg-white/[0.03] hover:bg-white/[0.06]">Validate</button>
                  <button onClick={handleApplyChanges} className="px-3 py-1 rounded bg-gradient-to-br from-[#d8b9ff] to-[#1a0f2e] text-[#030712] font-semibold">Apply Changes</button>
                </div>
              </div>

              {compileError && (
                <div className="mt-2 text-xs text-red-300 bg-red-500/5 border border-red-500/20 p-2 rounded">{compileError}</div>
              )}
            </div>
          )}
          {/* Sandbox moved back to Canvas as a bottom popup; removed embedded sandbox tab */}
          {/* Import Section */}
          {activeTab === 'import' && (
            <div className="flex-1 flex flex-col gap-3">
              <div className="flex-1 rounded-xl bg-[#040810] border border-white/[0.06] p-3">
                <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste your CREATE TABLE SQL here..." className="w-full h-full bg-transparent text-white font-mono resize-none outline-none" />
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-white/60">Paste raw SQL and click to generate canvas entities.</div>
                <button onClick={handleGenerateFromImport} className="px-3 py-1.5 rounded bg-gradient-to-br from-[#d8b9ff] to-[#1a0f2e] text-[#030712] font-semibold">Generate Canvas from SQL</button>
              </div>

              {compileError && (
                <div className="mt-2 text-xs text-red-300 bg-red-500/5 border border-red-500/20 p-2 rounded">{compileError}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
