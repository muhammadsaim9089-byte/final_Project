"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AI_DOCK_WIDTH, useLayout } from "./LayoutContext";
import { DbmlWorkspace } from "./DbmlWorkspace";
import { importText } from "@/lib/import";
import { SQL_DIALECTS } from "@/lib/sql/dialects";
import { showToast } from "@/components/ui/toast";
import {
  FileCode2,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  ChevronLeft,
  Database,
  Table2,
  Keyboard,
  Code2,
} from "lucide-react";

// ─── SQL KEYWORD LIST ────────────────────────────────────────────────────────
const SQL_KEYWORDS = [
  'SELECT','FROM','WHERE','INSERT','INTO','VALUES','UPDATE','SET','DELETE',
  'CREATE','TABLE','PRIMARY','KEY','FOREIGN','REFERENCES','NOT','NULL',
  'DEFAULT','INT','INTEGER','VARCHAR','TEXT','JOIN','LEFT','RIGHT','INNER',
  'OUTER','ON','GROUP','BY','ORDER','HAVING','AS','AND','OR','LIMIT','OFFSET',
  'ALTER','ADD','COLUMN','DROP','INDEX','UNIQUE','SERIAL','BOOLEAN','TIMESTAMP',
  'DATE','FLOAT','DECIMAL','UUID','CHAR','CASCADE','RESTRICT','NO','ACTION',
  'CONSTRAINT','IF','EXISTS','CHECK','BETWEEN','IN','LIKE','DISTINCT','COUNT',
  'SUM','AVG','MAX','MIN','COALESCE','CASE','WHEN','THEN','ELSE','END',
  'BIGINT','SMALLINT','NUMERIC','REAL','DOUBLE','PRECISION',
];

// ─── SQL AUTOCOMPLETE ────────────────────────────────────────────────────────
const SQL_AUTOCOMPLETE_ITEMS = SQL_KEYWORDS.map(k => k.toUpperCase());

// ─── TABLE COUNT PARSER ──────────────────────────────────────────────────────
function countTables(sql: string): number {
  const matches = sql.match(/CREATE\s+TABLE/gi);
  return matches ? matches.length : 0;
}

// ─── ERROR LINE DETECTION ────────────────────────────────────────────────────
function findErrorLines(sql: string): number[] {
  const errorLines: number[] = [];
  const lines = sql.split('\n');
  let parenDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('--')) continue;
    // Check mismatched parens
    for (const ch of line) {
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
    }
    if (parenDepth < 0) {
      errorLines.push(i);
      parenDepth = 0;
    }
    // Check for common SQL errors
    if (line.match(/,,/) || line.match(/\(\s*\)/) || line.match(/CREATE\s+TABLE\s*;/i)) {
      errorLines.push(i);
    }
  }
  return errorLines;
}

type CodeMode = "collapsed" | "split" | "fullscreen";

/**
 * The tab that rides the editor's right edge (like dbdiagram.io's). One click moves the editor one step:
 * closed → open → full screen → closed (only this tab stays). The tooltip names the next step.
 */
function EditorEdgeHandle({ mode, onClick, className = "", style }: { mode: CodeMode; onClick: () => void; className?: string; style?: React.CSSProperties }) {
  const label = mode === "collapsed" ? "Open editor" : mode === "split" ? "Expand editor" : "Close editor";
  const shortcut = mode === "split" ? "" : "Ctrl + \\";
  const onRightEdge = mode === "fullscreen";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={style}
      className={`group z-50 w-7 h-14 bg-[#0d1117] border border-white/[0.14] flex items-center justify-center cursor-pointer text-white/80 hover:text-white hover:bg-[#161c26] shadow-[0_4px_16px_rgba(0,0,0,0.6)] transition-colors ${onRightEdge ? "rounded-l-lg border-r-0" : "rounded-r-lg border-l-0"} ${className}`}
    >
      {onRightEdge ? <ChevronLeft size={16} className="text-[#4A90D9]" /> : <ChevronRight size={16} className="text-[#4A90D9]" />}
      <span
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${onRightEdge ? "right-full mr-2" : "left-full ml-2"} whitespace-nowrap rounded-lg bg-black px-3.5 py-2 text-center text-[13px] font-medium leading-tight text-white shadow-xl opacity-0 transition-opacity duration-150 group-hover:opacity-100`}
      >
        {label}
        {shortcut && <span className="block text-[12px] text-white/80">{shortcut}</span>}
      </span>
    </button>
  );
}

interface SqlEditorProps {
  value: string;
  onChange: (val: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  isValidSql: boolean;
  errorLines: Set<number>;
  cursorLine: number;
  cursorCol: number;
  showAutocomplete: boolean;
  autocompleteItems: string[];
  autocompleteIdx: number;
  handleCursorChange: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  handleEditorKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  highlightSql: (code: string, errorLineSet?: Set<number>) => string;
  editorTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setGeneratedSql: (val: string) => void;
  setShowAutocomplete: (show: boolean) => void;
}

function SqlEditor({
  value,
  onChange,
  textareaRef,
  placeholder,
  isValidSql,
  errorLines,
  cursorLine,
  cursorCol,
  showAutocomplete,
  autocompleteItems,
  autocompleteIdx,
  handleCursorChange,
  handleEditorKeyDown,
  highlightSql,
  editorTextareaRef,
  setGeneratedSql,
  setShowAutocomplete,
}: SqlEditorProps) {
  const lines = value.split('\n');
  const gutterRef = useRef<HTMLDivElement>(null);
  const preContainerRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = target.scrollTop;
    }
    if (preContainerRef.current) {
      preContainerRef.current.scrollTop = target.scrollTop;
      preContainerRef.current.scrollLeft = target.scrollLeft;
    }
  };

  // Sync scroll positions when content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      if (gutterRef.current) {
        gutterRef.current.scrollTop = textarea.scrollTop;
      }
      if (preContainerRef.current) {
        preContainerRef.current.scrollTop = textarea.scrollTop;
        preContainerRef.current.scrollLeft = textarea.scrollLeft;
      }
    }
  }, [value, textareaRef]);

  return (
    <div className={`relative flex-1 rounded-xl overflow-hidden border ${
      isValidSql && errorLines.size === 0 ? 'border-white/[0.06]' : 'border-red-500/40'
    } bg-[#1e1e1e] flex h-full min-h-0`}>
      
      {/* Line numbers gutter (fixed left column, does not scroll horizontally) */}
      <div 
        ref={gutterRef}
        className="sql-ide-gutter w-12 h-full overflow-hidden select-none bg-[#1e1e1e] pt-3 shrink-0"
      >
        <div className="text-right text-[12px] text-[#b4b4b4] font-mono pr-3 pb-12">
          {lines.map((_, i) => (
            <div 
              key={i} 
              className={`leading-6 px-1 h-6 ${
                errorLines.has(i) ? 'text-red-400 bg-red-500/10' : cursorLine === i ? 'text-white/60 bg-white/[0.03]' : ''
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Code area viewport */}
      <div className="flex-1 h-full relative overflow-hidden bg-[#1e1e1e]">
        
        {/* Preformatted highlighted code (underneath) */}
        <div 
          ref={preContainerRef}
          className="absolute inset-0 overflow-hidden pointer-events-none"
        >
          <pre
            className="whitespace-pre p-3 text-[13px] leading-6 font-mono text-white/90 m-0 border-0 bg-transparent min-w-max pb-12 pr-12"
            dangerouslySetInnerHTML={{
              __html: highlightSql(value || '', errorLines)
            }}
          />
        </div>

        {/* Textarea for typing/selection/scrolling (on top) */}
        <textarea
          ref={textareaRef as any}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onClick={(e) => {
            e.stopPropagation();
            handleCursorChange(e);
          }}
          onKeyUp={handleCursorChange}
          onKeyDown={handleEditorKeyDown}
          className="absolute inset-0 p-3 bg-transparent text-transparent caret-[#4A90D9] resize-none outline-none text-[13px] font-mono leading-6 m-0 border-0 overflow-auto whitespace-pre w-full h-full z-10 code-scroll pb-12 pr-12"
          spellCheck="false"
          placeholder={placeholder}
          style={{
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
          }}
        />

        {/* Autocomplete popup */}
        {showAutocomplete && (
          <div 
            className="absolute z-50 bg-[#0C1520]/98 border border-white/[0.1] rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden"
            style={{ 
              top: `${(cursorLine + 1) * 24 + 12 - (preContainerRef.current?.scrollTop || 0)}px`, 
              left: `${cursorCol * 7.8 + 12 - (preContainerRef.current?.scrollLeft || 0)}px` 
            }}
          >
            {autocompleteItems.map((item, i) => (
              <button
                key={item}
                className={`w-full text-left px-3 py-1.5 text-[12px] font-mono flex items-center gap-2 transition-colors ${
                  i === autocompleteIdx ? 'bg-[#4A90D9]/20 text-white' : 'text-white/70 hover:bg-white/[0.04]'
                }`}
                onMouseDown={(e) => { e.preventDefault(); }}
                onClick={() => {
                  const textarea = editorTextareaRef.current;
                  if (textarea) {
                    const text = textarea.value;
                    const pos = textarea.selectionStart;
                    const before = text.substring(0, pos);
                    const wordMatch = before.match(/(\w+)$/);
                    if (wordMatch) {
                      const start = pos - wordMatch[1].length;
                      setGeneratedSql(text.substring(0, start) + item + ' ' + text.substring(pos));
                    }
                  }
                  setShowAutocomplete(false);
                }}
              >
                <span className="text-[#b38fff] text-[10px]">SQL</span>
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export function SQLCodePanel() {
  const layout = useLayout();
  const activeTab = layout.sqlActiveTab;
  const setActiveTab = layout.setSqlActiveTab;
  const canvasDialect = layout.getCanvasApi()?.getSqlDialect() || "postgres";

  const [compileError, setCompileError] = useState<string | null>(null);
  const [isValidSql, setIsValidSql] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);

  // Autocomplete state
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<string[]>([]);
  const [autocompleteIdx, setAutocompleteIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(35);
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load persisted tab on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('designdb_sql_tab');
      if (saved === 'dbml' || saved === 'editor') {
        layout.setSqlActiveTab(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist active tab to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('designdb_sql_tab', activeTab);
    }
  }, [activeTab]);

  // An AI proposal's diff only renders on the DBML tab (see DbmlWorkspace) — surface it regardless of which
  // tab or panel state you had open, the same way accepting it will change the DBML, not the read-only SQL view.
  const hadAiProposal = useRef(false);
  useEffect(() => {
    if (layout.aiProposal && !hadAiProposal.current) {
      setActiveTab('dbml');
      if (layout.codeWindowMode === 'collapsed') layout.setCodeWindowMode('split');
    }
    hadAiProposal.current = !!layout.aiProposal;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.aiProposal]);

  // ─── RESIZE DRAG LOGIC ───────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = layout.panelWidth;
  }, [layout.panelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const vwDelta = (delta / window.innerWidth) * 100;
      const newWidth = Math.max(22, Math.min(60, dragStartWidth.current + vwDelta));
      layout.setPanelWidth(newWidth);
    };
    const onUp = () => setIsDragging(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging]);

  // ─── VALIDATION ──────────────────────────────────────────────────────────
  const runValidation = () => {
    setCompileError(null);
    setIsValidSql(true);
    const r = importText(layout.generatedSql || "", 'sql');
    if (r.errors.length) {
      setCompileError(r.errors[0]);
      setIsValidSql(false);
      return;
    }
    showToast(`Valid SQL — ${r.model.tables.length} tables, ${r.model.refs.length} relationships${r.warnings.length ? `, ${r.warnings.length} warning(s)` : ''}`, 'validate');
  };

  /** SQL editor → diagram */
  const handleApplyChanges = () => {
    setCompileError(null);
    const api = layout.getCanvasApi();
    const r = importText(layout.generatedSql || "", 'sql');
    if (r.errors.length) {
      setCompileError(r.errors[0]);
      setIsValidSql(false);
      return;
    }
    if (!api) {
      setCompileError('Canvas is not ready yet.');
      return;
    }
    api.applyModel(r.model, { mode: 'replace', layout: 'keep', restorePoint: 'Before applying SQL' });
    setIsValidSql(true);
    showToast(`Applied ${r.model.tables.length} tables from SQL`, 'success');
  };

  // ─── AUTOCOMPLETE ────────────────────────────────────────────────────────
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Space = autocomplete
    if ((e.ctrlKey || e.metaKey) && e.key === ' ') {
      e.preventDefault();
      const textarea = e.target as HTMLTextAreaElement;
      const text = textarea.value;
      const pos = textarea.selectionStart;
      // Get current word
      const before = text.substring(0, pos);
      const wordMatch = before.match(/(\w+)$/);
      if (wordMatch) {
        const prefix = wordMatch[1].toUpperCase();
        const items = SQL_AUTOCOMPLETE_ITEMS.filter(k => k.startsWith(prefix) && k !== prefix);
        if (items.length > 0) {
          setAutocompleteItems(items.slice(0, 8));
          setAutocompleteIdx(0);
          setShowAutocomplete(true);
        }
      }
      return;
    }
    if (showAutocomplete) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIdx(i => Math.min(i + 1, autocompleteItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const item = autocompleteItems[autocompleteIdx];
        const textarea = editorTextareaRef.current;
        if (textarea && item) {
          const text = textarea.value;
          const pos = textarea.selectionStart;
          const before = text.substring(0, pos);
          const wordMatch = before.match(/(\w+)$/);
          if (wordMatch) {
            const start = pos - wordMatch[1].length;
            layout.setGeneratedSql(text.substring(0, start) + item + ' ' + text.substring(pos));
          }
        }
        setShowAutocomplete(false);
        return;
      }
      if (e.key === 'Escape') {
        setShowAutocomplete(false);
        return;
      }
    }
  };

  // ─── CURSOR TRACKING ─────────────────────────────────────────────────────
  const handleCursorChange = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.target as HTMLTextAreaElement;
    const pos = textarea.selectionStart;
    const text = textarea.value.substring(0, pos);
    const lines = text.split('\n');
    setCursorLine(lines.length - 1);
    setCursorCol(lines[lines.length - 1].length);
    setShowAutocomplete(false);
  };

  // ─── SYNTAX HIGHLIGHTING ─────────────────────────────────────────────────
  const escapeHtml = (str: string) =>
    str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m as '&' | '<' | '>' | '"' | "'"]));

  const highlightSql = (code: string, errorLineSet?: Set<number>) => {
    if (!code) return '';
    const lines = code.split('\n');
    return lines.map((line, idx) => {
      let esc = escapeHtml(line);
      // Keywords
      const kwRegex = new RegExp('\\b(' + SQL_KEYWORDS.join('|') + ')\\b', 'gi');
      esc = esc.replace(kwRegex, (m) => `<span class="text-[#569cd6]">${m}</span>`);
      // Strings
      esc = esc.replace(/'[^']*'/g, (m) => `<span class="text-[#ce9178]">${m}</span>`);
      // Numbers
      esc = esc.replace(/\b(\d+)\b/g, (m) => `<span class="text-[#e6e6e6]">${m}</span>`);
      // Comments
      esc = esc.replace(/(--.*)/g, (m) => `<span class="text-white/30 italic">${m}</span>`);
      // Error line underline
      if (errorLineSet?.has(idx)) {
        return `<span class="border-b-2 border-red-500/60 border-dashed">${esc}</span>`;
      }
      return esc;
    }).join('\n');
  };

  // ─── COMPUTED VALUES ──────────────────────────────────────────────────────
  const currentText = activeTab === 'editor' ? layout.generatedSql : layout.dbmlText;
  const tableCount = countTables(currentText);
  const lineCount = currentText.split('\n').length;
  // The SQL heuristics only make sense for SQL text — DBML has its own diagnostics (see DbmlWorkspace)
  const errorLines = useMemo(() => (activeTab === 'dbml' ? new Set<number>() : new Set(findErrorLines(currentText))), [currentText, activeTab]);

  // Panel positioning
  const mode = layout.codeWindowMode;
  const isVisible = mode !== "collapsed";

  // The AI chat docks to the left of the editor; anything positioned against the viewport must start after it
  const aiOffset = layout.aiOpen ? AI_DOCK_WIDTH : "0px";

  // closed → open → full screen → closed
  const cycleEditor = () => layout.setCodeWindowMode(mode === "collapsed" ? "split" : mode === "split" ? "fullscreen" : "collapsed");

  // Collapsed shows only the edge tab — but the editor stays mounted (hidden, below), so its text, cursor, selection,
  // scroll position and undo history survive being folded away (by the user or by the SQL playground).
  const collapsed = mode === "collapsed";
  const everCollapsed = useRef(false);
  if (collapsed) everCollapsed.current = true;


  // Shared panel body content (used in both fullscreen and split modes)
  const panelBody = (
    <>
      {/* ─── TAB BAR ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-2 shrink-0">
        <button
          onClick={() => setActiveTab('dbml')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all relative ${
            activeTab === 'dbml'
              ? 'bg-white/[0.06] text-white border border-white/[0.08]'
              : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03] border border-transparent'
          }`}
        >
          <Code2 size={11} />
          DBML
          {activeTab === 'dbml' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-[#4A90D9] to-[#b38fff]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all relative ${
            activeTab === 'editor'
              ? 'bg-white/[0.06] text-white border border-white/[0.08]'
              : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03] border border-transparent'
          }`}
        >
          <FileCode2 size={11} />
          SQL
          {activeTab === 'editor' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-[#4A90D9] to-[#b38fff]" />
          )}
        </button>

        {/* Keyboard shortcut hints */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[9px] text-white/20 font-mono flex items-center gap-1">
            <Keyboard size={9} />
            {activeTab === 'dbml' ? 'Ctrl+/ comment · Ctrl+click go to table' : 'Ctrl+\ hide panel'}
          </span>
        </div>
      </div>

      {/* ─── EDITOR AREA ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-4 gap-2 min-h-0 overflow-hidden">

        {/* ── DBML TAB ─────────────────────────────────────────────────── */}
        {activeTab === 'dbml' && <DbmlWorkspace />}

        {/* ── SQL TAB (read & modify) ──────────────────────────────────── */}
        {activeTab === 'editor' && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <SqlEditor
              value={layout.generatedSql}
              onChange={layout.setGeneratedSql}
              textareaRef={editorTextareaRef}
              placeholder="-- Generated SQL will appear here after ERD generation..."
              isValidSql={isValidSql}
              errorLines={errorLines}
              cursorLine={cursorLine}
              cursorCol={cursorCol}
              showAutocomplete={showAutocomplete}
              autocompleteItems={autocompleteItems}
              autocompleteIdx={autocompleteIdx}
              handleCursorChange={handleCursorChange}
              handleEditorKeyDown={handleEditorKeyDown}
              highlightSql={highlightSql}
              editorTextareaRef={editorTextareaRef}
              setGeneratedSql={layout.setGeneratedSql}
              setShowAutocomplete={setShowAutocomplete}
            />

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={runValidation} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all">
                  <CheckCircle size={11} />
                  Validate
                </button>
                <button
                  onClick={handleApplyChanges}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#4A90D9] to-[#2d6db5] text-white text-[11px] font-bold shadow-[0_4px_16px_rgba(74,144,217,0.25)] hover:shadow-[0_6px_20px_rgba(74,144,217,0.35)] transition-all"
                >
                  Apply Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPILE ERROR ────────────────────────────────────────────── */}
        {compileError && (
          <div className="flex items-start gap-2 text-[11px] text-red-300 bg-red-500/8 border border-red-500/20 p-2.5 rounded-lg shrink-0">
            <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
            <span className="font-mono">{compileError}</span>
          </div>
        )}
      </div>

      {/* ─── STATUS BAR (the DBML tab renders its own) ─────────────────── */}
      {activeTab !== 'dbml' && (
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] bg-[#1e1e1e] shrink-0">
        <div className="flex items-center gap-3">
          {/* Validation indicator */}
          <div className="flex items-center gap-1.5">
            <div className={`w-[6px] h-[6px] rounded-full ${
              isValidSql && errorLines.size === 0
                ? 'bg-[#9be7a6] shadow-[0_0_6px_rgba(155,231,166,0.4)]'
                : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)]'
            }`} />
            <span className="text-[10px] text-white/30 font-mono">
              {isValidSql && errorLines.size === 0 ? 'Valid' : 'Errors'}
            </span>
          </div>

          {/* Dialect badge */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.04]">
            <Database size={9} className="text-[#4A90D9]/60" />
            <span className="text-[9px] text-white/40 font-mono font-bold uppercase">{SQL_DIALECTS.find((d) => d.id === canvasDialect)?.label || canvasDialect}</span>
          </div>

          {/* Table count */}
          <div className="flex items-center gap-1">
            <Table2 size={9} className="text-white/20" />
            <span className="text-[10px] text-white/30 font-mono">{tableCount} table{tableCount !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Line count */}
          <span className="text-[10px] text-white/25 font-mono">{lineCount} lines</span>

          {/* Cursor position */}
          <span className="text-[10px] text-white/25 font-mono">
            Ln {cursorLine + 1}, Col {cursorCol + 1}
          </span>
        </div>
      </div>
      )}
    </>
  );

  // ─── FULLSCREEN MODE: fixed overlay covering everything ──────────────────
  if (mode === "fullscreen") {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 top-[var(--app-header-h)] z-40 bg-[#1e1e1e] border-r border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col"
        style={{ left: aiOffset }}
      >
        <EditorEdgeHandle mode="fullscreen" onClick={cycleEditor} className="fixed top-[calc(var(--app-header-h)+16px)] right-0" />
        {panelBody}
      </div>
    );
  }

  // ─── SPLIT MODE: flex-based panel that pushes the canvas (the same tree, hidden, when collapsed) ────
  return (
    <>
    {collapsed && <EditorEdgeHandle mode="collapsed" onClick={cycleEditor} className="fixed top-[calc(var(--app-header-h)+16px)]" style={{ left: aiOffset }} />}
    <div
      className={collapsed ? "hidden" : `relative h-full shrink-0 ${everCollapsed.current ? "animate-in slide-in-from-left-4 fade-in duration-200" : ""}`}
      style={{ width: `${layout.panelWidth}vw`, minWidth: '360px', maxWidth: '60vw' }}
    >
      <div
        ref={containerRef}
        className="relative h-full w-full bg-[#1e1e1e] border-r border-white/[0.08] shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden"
      >
      {/* ─── RESIZE HANDLE (right edge) ─────────────────────────────────── */}
      <div
        className="resize-handle-h absolute top-0 right-0 w-[6px] h-full z-50 cursor-col-resize group"
        onMouseDown={handleResizeStart}
      >
        <div className={`absolute inset-y-0 right-0 w-[2px] transition-all duration-200 ${
          isDragging ? 'bg-[#4A90D9] shadow-[0_0_8px_rgba(74,144,217,0.5)]' : 'bg-white/[0.06] group-hover:bg-[#4A90D9]/50'
        }`} />
        {/* Grip dots */}
        <div className="absolute top-1/2 -translate-y-1/2 right-0 w-[6px] flex flex-col items-center gap-[3px] opacity-0 group-hover:opacity-60 transition-opacity">
          <div className="w-[3px] h-[3px] rounded-full bg-white/40" />
          <div className="w-[3px] h-[3px] rounded-full bg-white/40" />
          <div className="w-[3px] h-[3px] rounded-full bg-white/40" />
        </div>
      </div>

      {panelBody}
      </div>

      {/* sits on the panel's right edge, over the canvas (outside the clipped panel) */}
      <EditorEdgeHandle mode="split" onClick={cycleEditor} className="absolute top-4 left-full" />
    </div>
    </>
  );
}
