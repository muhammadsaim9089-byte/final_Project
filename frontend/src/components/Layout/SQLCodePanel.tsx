"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLayout } from "./LayoutContext";
import { parseSqlDdl, ParsedSchema } from "@/lib/sqlParser";
import { parsePrisma, parseDjango, parseRails } from "@/lib/frameworkParsers";
import {
  FileCode2,
  Download,
  Copy,
  Check,
  Upload,
  AlertTriangle,
  CheckCircle,
  Braces,
  FileUp,
  X,
  ChevronRight,
  Database,
  Table2,
  Keyboard,
  Link2,
  ChevronDown,
  Server,
  ClipboardCopy,
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

// ─── SIMPLE SQL FORMATTER ────────────────────────────────────────────────────
function formatSql(sql: string): string {
  if (!sql.trim()) return sql;
  // Normalize whitespace
  let formatted = sql.replace(/\s+/g, ' ').trim();
  // Add newlines before major clauses
  const breakBefore = [
    'SELECT','FROM','WHERE','JOIN','LEFT JOIN','RIGHT JOIN','INNER JOIN',
    'OUTER JOIN','GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET','INSERT INTO',
    'VALUES','UPDATE','SET','DELETE','CREATE TABLE','ALTER TABLE','DROP TABLE',
    'PRIMARY KEY','FOREIGN KEY','REFERENCES','CONSTRAINT','ON DELETE','ON UPDATE',
    'NOT NULL','DEFAULT','UNIQUE','CHECK','IF EXISTS','IF NOT EXISTS',
  ];
  for (const clause of breakBefore) {
    const regex = new RegExp(`\\b(${clause.replace(/ /g, '\\s+')})\\b`, 'gi');
    formatted = formatted.replace(regex, '\n$1');
  }
  // Indent sub-clauses
  const lines = formatted.split('\n').map(l => l.trim()).filter(Boolean);
  const result: string[] = [];
  let indent = 0;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('CREATE TABLE') || upper.startsWith('INSERT INTO')) {
      indent = 0;
      result.push(line);
      indent = 1;
    } else if (upper.startsWith(')')) {
      indent = Math.max(0, indent - 1);
      result.push('  '.repeat(indent) + line);
    } else if (upper.startsWith('SELECT') || upper.startsWith('FROM') || upper.startsWith('WHERE') || upper.startsWith('GROUP BY') || upper.startsWith('ORDER BY') || upper.startsWith('HAVING') || upper.startsWith('LIMIT')) {
      indent = 0;
      result.push(line);
      indent = 1;
    } else {
      result.push('  '.repeat(indent) + line);
    }
  }
  // Add semicolons where missing
  let finalSql = result.join('\n');
  // Separate multiple statements
  finalSql = finalSql.replace(/;\s*/g, ';\n\n');
  return finalSql.trim();
}

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

// ─── BREADCRUMB PARSER ───────────────────────────────────────────────────────
function getBreadcrumb(sql: string, cursorLine: number): string[] {
  const lines = sql.split('\n');
  const crumbs: string[] = ['Schema'];
  let currentTable = '';
  for (let i = 0; i <= cursorLine && i < lines.length; i++) {
    const match = lines[i].match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);
    if (match) currentTable = match[1];
    if (lines[i].includes(')') && currentTable) {
      // Check if we're past the closing paren
      if (i < cursorLine) currentTable = '';
    }
  }
  if (currentTable) {
    crumbs.push('tables', currentTable);
  }
  return crumbs;
}

interface SqlEditorProps {
  value: string;
  onChange: (val: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  isImport?: boolean;
  isValidSql: boolean;
  errorLines: Set<number>;
  cursorLine: number;
  cursorCol: number;
  showAutocomplete: boolean;
  autocompleteItems: string[];
  autocompleteIdx: number;
  handleCursorChange: (e: React.SyntheticEvent<HTMLTextAreaElement>) => void;
  handleEditorKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, isImport?: boolean) => void;
  highlightSql: (code: string, errorLineSet?: Set<number>) => string;
  importTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  editorTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setImportText: (val: string) => void;
  setGeneratedSql: (val: string) => void;
  setShowAutocomplete: (show: boolean) => void;
}

function SqlEditor({
  value,
  onChange,
  textareaRef,
  placeholder,
  isImport = false,
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
  importTextareaRef,
  editorTextareaRef,
  setImportText,
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
    } bg-[#040810] flex h-full min-h-0`}>
      
      {/* Line numbers gutter (fixed left column, does not scroll horizontally) */}
      <div 
        ref={gutterRef}
        className="sql-ide-gutter w-12 h-full overflow-hidden select-none bg-[#030710] border-r border-white/[0.04] pt-3 shrink-0"
      >
        <div className="text-right text-[11px] text-white/30 font-mono pr-2 pb-12">
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
      <div className="flex-1 h-full relative overflow-hidden bg-[#040810]">
        
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
          onKeyDown={(e) => handleEditorKeyDown(e, isImport)}
          className="absolute inset-0 p-3 bg-transparent text-transparent caret-[#4A90D9] resize-none outline-none text-[13px] font-mono leading-6 m-0 border-0 overflow-auto whitespace-pre w-full h-full z-10 p-scrollbar pb-12 pr-12"
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
                  const textarea = (isImport ? importTextareaRef : editorTextareaRef).current;
                  if (textarea) {
                    const text = textarea.value;
                    const pos = textarea.selectionStart;
                    const before = text.substring(0, pos);
                    const wordMatch = before.match(/(\w+)$/);
                    if (wordMatch) {
                      const start = pos - wordMatch[1].length;
                      const newText = text.substring(0, start) + item + ' ' + text.substring(pos);
                      if (isImport) setImportText(newText);
                      else setGeneratedSql(newText);
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
  const [importText, setImportText] = useState("");
  const [importDialect, setImportDialect] = useState<"sql" | "prisma" | "django" | "rails">("sql");
  const activeTab = layout.sqlActiveTab;
  const setActiveTab = layout.setSqlActiveTab;

  const [compileError, setCompileError] = useState<string | null>(null);
  const [isValidSql, setIsValidSql] = useState(true);
  const [copiedSql, setCopiedSql] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [panelWidth, setPanelWidth] = useState(35); // vw units
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
  const importTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Reverse Engineering Wizard State ──
  const [showReverseWizard, setShowReverseWizard] = useState(false);
  const [connString, setConnString] = useState("");
  const [parsedConn, setParsedConn] = useState<{
    protocol: string; host: string; port: string; user: string; password: string; database: string;
  } | null>(null);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [copiedQuery, setCopiedQuery] = useState(false);

  // Parse connection string (postgres:// or mysql://)
  const parseConnectionString = (str: string) => {
    try {
      const match = str.trim().match(/^(postgres(?:ql)?|mysql):\/\/([^:]+):([^@]+)@([^:/]+)(?::([0-9]+))?\/(.+?)(?:\?.*)?$/);
      if (!match) return null;
      return {
        protocol: match[1].startsWith('postgres') ? 'PostgreSQL' : 'MySQL',
        user: decodeURIComponent(match[2]),
        password: match[3],
        host: match[4],
        port: match[5] || (match[1].startsWith('postgres') ? '5432' : '3306'),
        database: decodeURIComponent(match[6]),
      };
    } catch { return null; }
  };

  const getExtractionQuery = (parsed: NonNullable<typeof parsedConn>) => {
    if (parsed.protocol === 'PostgreSQL') {
      return `-- Run this on your PostgreSQL database:\nSELECT\n  'CREATE TABLE ' || table_name || ' (' ||\n  string_agg(\n    column_name || ' ' || data_type ||\n    CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||\n    CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||\n    CASE WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default ELSE '' END,\n    ', '\n  ) || ');'\nFROM information_schema.columns\nWHERE table_schema = 'public'\nGROUP BY table_name\nORDER BY table_name;`;
    }
    return `-- Run this on your MySQL database:\nSELECT\n  CONCAT('CREATE TABLE ', TABLE_NAME, ' (',\n  GROUP_CONCAT(\n    CONCAT(COLUMN_NAME, ' ', COLUMN_TYPE,\n    IF(IS_NULLABLE = 'NO', ' NOT NULL', ''),\n    IF(COLUMN_DEFAULT IS NOT NULL, CONCAT(' DEFAULT ', QUOTE(COLUMN_DEFAULT)), ''))\n    SEPARATOR ', '\n  ), ');')\nFROM INFORMATION_SCHEMA.COLUMNS\nWHERE TABLE_SCHEMA = '${parsed.database}'\nGROUP BY TABLE_NAME\nORDER BY TABLE_NAME;`;
  };

  // Load persisted tab on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('designdb_sql_tab') as "editor" | "import";
      if (saved) {
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

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
  useEffect(() => {
    if (!layout.isSqlOpen) return;
    const handler = (e: KeyboardEvent) => {
      // Ctrl+S = Copy SQL
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        navigator.clipboard.writeText(layout.generatedSql);
        setCopiedSql(true);
        setTimeout(() => setCopiedSql(false), 2000);
      }
      // Ctrl+I = Switch to Import tab
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        setActiveTab('import');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.isSqlOpen, layout.generatedSql]);

  // ─── RESIZE DRAG LOGIC ───────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current;
      const vwDelta = (delta / window.innerWidth) * 100;
      const newWidth = Math.max(22, Math.min(60, dragStartWidth.current + vwDelta));
      setPanelWidth(newWidth);
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

  // ─── FILE UPLOAD HANDLER ─────────────────────────────────────────────────
  const handleFileUpload = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const validExts = ['sql', 'txt', 'ddl', 'prisma', 'py', 'rb'];
    if (!validExts.includes(ext)) {
      setCompileError('Please upload a .sql, .txt, .ddl, .prisma, .py, or .rb file.');
      return;
    }
    // Auto-detect dialect from file extension
    if (ext === 'prisma') setImportDialect('prisma');
    else if (ext === 'py') setImportDialect('django');
    else if (ext === 'rb') setImportDialect('rails');
    else setImportDialect('sql');

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setImportText(text);
      setActiveTab('import');
      setCompileError(null);
    };
    reader.readAsText(file);
  };

  // ─── DRAG AND DROP ───────────────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  // ─── VALIDATION ──────────────────────────────────────────────────────────
  const runValidation = () => {
    setCompileError(null);
    setIsValidSql(true);
    try {
      const parsed = parseSqlDdl(layout.generatedSql || importText || "");
      if (parsed.entities.length === 0) {
        throw new Error('No CREATE TABLE statements detected.');
      }
      layout.applyParsedSchema(parsed as ParsedSchema);
    } catch (err: any) {
      setCompileError(err.message || 'SQL parse error');
      setIsValidSql(false);
    }
  };

  const handleApplyChanges = () => {
    setCompileError(null);
    try {
      const parsed = parseSqlDdl(layout.generatedSql || "");
      if (parsed.entities.length === 0) {
        setCompileError('No CREATE TABLE statements found.');
        setIsValidSql(false);
        return;
      }
      layout.applyParsedSchema(parsed);
      setIsValidSql(true);
    } catch (err: any) {
      setCompileError(err.message || 'Failed to compile SQL');
      setIsValidSql(false);
    }
  };

  const handleGenerateFromImport = () => {
    setCompileError(null);
    try {
      let parsed: ParsedSchema;
      switch (importDialect) {
        case 'prisma':
          parsed = parsePrisma(importText || "");
          break;
        case 'django':
          parsed = parseDjango(importText || "");
          break;
        case 'rails':
          parsed = parseRails(importText || "");
          break;
        default:
          parsed = parseSqlDdl(importText || "");
          break;
      }
      if (parsed.entities.length === 0) {
        const dialectLabels: Record<string, string> = {
          sql: 'CREATE TABLE statements',
          prisma: 'Prisma model definitions',
          django: 'Django Model classes',
          rails: 'create_table blocks',
        };
        setCompileError(`No ${dialectLabels[importDialect] || 'schema definitions'} found in import.`);
        setIsValidSql(false);
        return;
      }
      layout.applyParsedSchema(parsed);
      setImportText("");
      setActiveTab('editor');
      setIsValidSql(true);
    } catch (err: any) {
      setCompileError(err.message || 'Import failed to parse');
      setIsValidSql(false);
    }
  };

  // ─── COPY / DOWNLOAD ────────────────────────────────────────────────────
  const handleCopySql = () => {
    navigator.clipboard.writeText(layout.generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleDownloadSql = () => {
    const blob = new Blob([layout.generatedSql], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.sql';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── FORMAT SQL ──────────────────────────────────────────────────────────
  const handleFormatSql = () => {
    if (activeTab === 'editor') {
      layout.setGeneratedSql(formatSql(layout.generatedSql));
    } else {
      setImportText(formatSql(importText));
    }
  };

  // ─── AUTOCOMPLETE ────────────────────────────────────────────────────────
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, isImport = false) => {
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
        const textarea = (isImport ? importTextareaRef : editorTextareaRef).current;
        if (textarea && item) {
          const text = textarea.value;
          const pos = textarea.selectionStart;
          const before = text.substring(0, pos);
          const wordMatch = before.match(/(\w+)$/);
          if (wordMatch) {
            const start = pos - wordMatch[1].length;
            const newText = text.substring(0, start) + item + ' ' + text.substring(pos);
            if (isImport) setImportText(newText);
            else layout.setGeneratedSql(newText);
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
      esc = esc.replace(kwRegex, (m) => `<span class="text-[#b38fff] font-semibold">${m}</span>`);
      // Strings
      esc = esc.replace(/'[^']*'/g, (m) => `<span class="text-[#9be7a6]">${m}</span>`);
      // Numbers
      esc = esc.replace(/\b(\d+)\b/g, (m) => `<span class="text-[#f6c85f]">${m}</span>`);
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
  const currentText = activeTab === 'editor' ? layout.generatedSql : importText;
  const tableCount = countTables(currentText);
  const lineCount = currentText.split('\n').length;
  const errorLines = useMemo(() => new Set(findErrorLines(currentText)), [currentText]);
  const breadcrumb = useMemo(() => getBreadcrumb(currentText, cursorLine), [currentText, cursorLine]);

  // Panel positioning
  const panelClasses = useMemo(() => {
    return `fixed top-0 left-16 h-screen z-40 bg-[#060b12]/97 backdrop-blur-xl border-r border-white/[0.06] shadow-[0_20px_60px_rgba(0,0,0,0.8)] transition-[width,transform] duration-300 overflow-hidden flex flex-col ${layout.isSqlOpen ? 'translate-x-0' : '-translate-x-full w-0'}`;
  }, [layout.isSqlOpen]);

  // SqlEditor component was moved outside to the top level.

  return (
    <div
      ref={containerRef}
      aria-hidden={!layout.isSqlOpen}
      className={panelClasses}
      style={{
        width: layout.isSqlOpen ? `${panelWidth}vw` : '0',
        minWidth: layout.isSqlOpen ? '360px' : '0',
      }}
      onDragOver={activeTab === 'import' ? handleDragOver : undefined}
      onDragLeave={activeTab === 'import' ? handleDragLeave : undefined}
      onDrop={activeTab === 'import' ? handleDrop : undefined}
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

      {/* ─── HEADER ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gradient-to-br from-[#4A90D9]/20 to-[#b38fff]/10 border border-[#4A90D9]/20">
            <FileCode2 size={14} className="text-[#4A90D9]" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-white tracking-wide">SQL Workspace</h4>
            <span className="text-[9px] text-white/35 font-mono uppercase tracking-wider">Interactive DDL Editor</span>
          </div>
        </div>
        <button
          onClick={() => layout.setSqlOpen(false)}
          className="p-1.5 text-white/40 hover:text-white hover:bg-white/[0.06] rounded-lg transition-all"
        >
          <X size={14} />
        </button>
      </div>

      {/* ─── TAB BAR ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pb-2 shrink-0">
        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all relative ${
            activeTab === 'editor'
              ? 'bg-white/[0.06] text-white border border-white/[0.08]'
              : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03] border border-transparent'
          }`}
        >
          <FileCode2 size={11} />
          Read & Modify
          {activeTab === 'editor' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-[#4A90D9] to-[#b38fff]" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all relative ${
            activeTab === 'import'
              ? 'bg-white/[0.06] text-white border border-white/[0.08]'
              : 'text-white/45 hover:text-white/70 hover:bg-white/[0.03] border border-transparent'
          }`}
        >
          <Upload size={11} />
          Import
          {activeTab === 'import' && (
            <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-gradient-to-r from-[#4A90D9] to-[#b38fff]" />
          )}
        </button>

        {/* Keyboard shortcut hints */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[9px] text-white/20 font-mono flex items-center gap-1">
            <Keyboard size={9} />
            Ctrl+S copy · Ctrl+I import
          </span>
        </div>
      </div>

      {/* ─── BREADCRUMB ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pb-2 text-[10px] text-white/30 font-mono shrink-0">
        {breadcrumb.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight size={8} className="text-white/15" />}
            <span className={i === breadcrumb.length - 1 ? 'text-[#4A90D9]/80' : ''}>{crumb}</span>
          </React.Fragment>
        ))}
      </div>

      {/* ─── EDITOR AREA ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col px-4 gap-2 min-h-0 overflow-hidden">

        {/* ── READ & MODIFY TAB ────────────────────────────────────────── */}
        {activeTab === 'editor' && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <SqlEditor
              value={layout.generatedSql}
              onChange={layout.setGeneratedSql}
              textareaRef={editorTextareaRef}
              placeholder="-- Generated SQL will appear here after ERD generation..."
              isImport={false}
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
              importTextareaRef={importTextareaRef}
              editorTextareaRef={editorTextareaRef}
              setImportText={setImportText}
              setGeneratedSql={layout.setGeneratedSql}
              setShowAutocomplete={setShowAutocomplete}
            />

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {/* Copy */}
                <button
                  onClick={handleCopySql}
                  disabled={!layout.generatedSql}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30"
                >
                  {copiedSql ? <Check size={11} className="text-[#9be7a6]" /> : <Copy size={11} />}
                  {copiedSql ? 'Copied!' : 'Copy'}
                </button>
                {/* Download */}
                <button
                  onClick={handleDownloadSql}
                  disabled={!layout.generatedSql}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30"
                >
                  <Download size={11} />
                  .sql
                </button>
                {/* Format */}
                <button
                  onClick={handleFormatSql}
                  disabled={!layout.generatedSql}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30"
                >
                  <Braces size={11} />
                  Format
                </button>
              </div>

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

        {/* ── IMPORT TAB ───────────────────────────────────────────────── */}
        {activeTab === 'import' && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            {/* Dialect selector + file upload header */}
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <select
                  value={importDialect}
                  onChange={(e) => setImportDialect(e.target.value as any)}
                  className="bg-[#0A0E1A] border border-white/[0.08] rounded-lg px-2 py-1.5 text-[11px] text-white/80 font-mono outline-none focus:border-[#4A90D9]/40 appearance-none cursor-pointer pr-6 transition-colors"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                >
                  <option value="sql" style={{ background: '#0A0E1A', color: '#ccc' }}>SQL DDL</option>
                  <option value="prisma" style={{ background: '#0A0E1A', color: '#ccc' }}>Prisma (.prisma)</option>
                  <option value="django" style={{ background: '#0A0E1A', color: '#ccc' }}>Django Models (.py)</option>
                  <option value="rails" style={{ background: '#0A0E1A', color: '#ccc' }}>Rails Schema (.rb)</option>
                </select>
                <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">
                  {importDialect === 'sql' ? 'SQL DDL Import' : importDialect === 'prisma' ? 'Prisma Schema Import' : importDialect === 'django' ? 'Django Models Import' : 'Rails Schema Import'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".sql,.txt,.ddl,.prisma,.py,.rb"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/50 hover:text-white hover:bg-white/[0.06] hover:border-white/[0.12] transition-all"
                >
                  <FileUp size={11} />
                  Open File
                </button>
              </div>
            </div>

            {/* ── Reverse Engineer from Connection String ── */}
            <div className="shrink-0 border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
              <button
                onClick={() => { setShowReverseWizard(v => !v); if (!showReverseWizard) setWizardStep(1); }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Link2 size={11} className="text-[#4A90D9]" />
                  <span className="text-[11px] font-semibold text-white/70">Reverse Engineer from Connection String</span>
                </div>
                <ChevronDown size={12} className={`text-white/30 transition-transform duration-200 ${showReverseWizard ? 'rotate-180' : ''}`} />
              </button>

              {showReverseWizard && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/[0.04]">
                  {/* Step Indicators */}
                  <div className="flex items-center gap-2 pt-2.5">
                    {[1, 2, 3].map((s) => (
                      <div key={s} className="flex items-center gap-1.5">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                          wizardStep >= s ? 'bg-[#4A90D9] text-white' : 'bg-white/[0.06] text-white/30'
                        }`}>{s}</div>
                        {s < 3 && <div className={`w-6 h-[1px] ${wizardStep > s ? 'bg-[#4A90D9]' : 'bg-white/[0.06]'}`} />}
                      </div>
                    ))}
                    <span className="ml-2 text-[9px] text-white/30 font-mono">
                      {wizardStep === 1 ? 'Paste URL' : wizardStep === 2 ? 'Run Query' : 'Paste DDL'}
                    </span>
                  </div>

                  {/* Step 1: Paste connection string */}
                  {wizardStep === 1 && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={connString}
                        onChange={(e) => setConnString(e.target.value)}
                        placeholder="postgres://user:pass@host:5432/dbname"
                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2 text-[11px] text-white/80 placeholder-white/25 outline-none focus:border-[#4A90D9]/40 font-mono transition-colors"
                      />
                      <button
                        onClick={() => {
                          const parsed = parseConnectionString(connString);
                          if (parsed) { setParsedConn(parsed); setWizardStep(2); }
                        }}
                        disabled={!connString.trim()}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-[#4A90D9] text-[11px] font-bold hover:bg-[#4A90D9]/25 transition-all disabled:opacity-30"
                      >
                        <Server size={11} />
                        Parse Connection
                      </button>
                      {connString.trim() && !parseConnectionString(connString) && (
                        <p className="text-[10px] text-red-400/80 font-mono">
                          Invalid format. Use: postgres://user:pass@host:port/db
                        </p>
                      )}
                    </div>
                  )}

                  {/* Step 2: Show parsed details & extraction query */}
                  {wizardStep === 2 && parsedConn && (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-1.5">
                        {[
                          { label: 'Protocol', value: parsedConn.protocol },
                          { label: 'Host', value: parsedConn.host },
                          { label: 'Port', value: parsedConn.port },
                          { label: 'Database', value: parsedConn.database },
                          { label: 'User', value: parsedConn.user },
                          { label: 'Password', value: '••••••••' },
                        ].map((item) => (
                          <div key={item.label} className="bg-white/[0.02] border border-white/[0.04] rounded-lg px-2.5 py-1.5">
                            <span className="text-[8px] text-white/30 uppercase font-mono block">{item.label}</span>
                            <span className="text-[10px] text-white/70 font-mono truncate block">{item.value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-[#0A0E1A] border border-white/[0.06] rounded-lg p-2.5 text-[10px] text-white/50 font-mono max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                        {getExtractionQuery(parsedConn)}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(getExtractionQuery(parsedConn).replace(/\\n/g, '\n'));
                            setCopiedQuery(true);
                            setTimeout(() => setCopiedQuery(false), 2000);
                          }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-[10px] font-bold hover:bg-white/[0.08] transition-all"
                        >
                          {copiedQuery ? <Check size={10} /> : <ClipboardCopy size={10} />}
                          {copiedQuery ? 'Copied!' : 'Copy Query'}
                        </button>
                        <button
                          onClick={() => setWizardStep(3)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-[#4A90D9] text-[10px] font-bold hover:bg-[#4A90D9]/25 transition-all"
                        >
                          Next: Paste Output →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Instructions to paste DDL output below */}
                  {wizardStep === 3 && (
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 text-[10px] text-emerald-300/80 font-sans leading-relaxed">
                      <p className="font-bold mb-1">✓ Query copied! Now:</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-emerald-300/60">
                        <li>Run the query on your database client (psql, pgAdmin, MySQL Workbench...)</li>
                        <li>Copy the CREATE TABLE output</li>
                        <li>Paste it into the SQL editor below</li>
                        <li>Click <strong className="text-emerald-300/90">Import & Build</strong> to generate the visual schema</li>
                      </ol>
                      <button
                        onClick={() => { setShowReverseWizard(false); setWizardStep(1); setConnString(''); setParsedConn(null); }}
                        className="mt-2 text-[9px] text-white/30 hover:text-white/50 underline transition-colors"
                      >
                        Done — Close wizard
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drag-and-drop zone indicator */}
            {isDragOver && (
              <div className="absolute inset-4 z-30 rounded-2xl border-2 border-dashed border-[#4A90D9]/50 bg-[#4A90D9]/5 flex items-center justify-center pointer-events-none animate-pulse">
                <div className="flex flex-col items-center gap-2 text-[#4A90D9]">
                  <Upload size={32} className="animate-bounce" />
                  <span className="text-sm font-semibold">Drop .sql file here</span>
                </div>
              </div>
            )}

            {/* IDE editor for import */}
            <SqlEditor
              value={importText}
              onChange={setImportText}
              textareaRef={importTextareaRef}
              placeholder={
                importDialect === 'prisma'
                  ? "// Paste your Prisma schema here\n// Example:\n// model User {\n//   id    Int    @id @default(autoincrement())\n//   email String @unique\n//   posts Post[]\n// }\n// model Post {\n//   id       Int  @id\n//   title    String\n//   authorId Int\n//   author   User @relation(fields: [authorId], references: [id])\n// }"
                : importDialect === 'django'
                  ? "# Paste your Django models.py here\n# Example:\n# class User(models.Model):\n#     username = models.CharField(max_length=255)\n#     email = models.EmailField()\n#\n# class Post(models.Model):\n#     title = models.CharField(max_length=200)\n#     author = models.ForeignKey(User, on_delete=models.CASCADE)"
                : importDialect === 'rails'
                  ? '# Paste your Rails schema.rb here\n# Example:\n# create_table "users", force: :cascade do |t|\n#   t.string "username"\n#   t.string "email"\n# end\n#\n# create_table "posts", force: :cascade do |t|\n#   t.string "title"\n#   t.integer "user_id"\n# end\n# add_foreign_key "posts", "users"'
                  : "-- Paste or drop your CREATE TABLE SQL here\n-- Example:\n-- CREATE TABLE orders (\n--   id SERIAL PRIMARY KEY,\n--   customer_id INTEGER REFERENCES customers(id),\n--   total DECIMAL(10,2)\n-- );"
              }
              isImport={true}
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
              importTextareaRef={importTextareaRef}
              editorTextareaRef={editorTextareaRef}
              setImportText={setImportText}
              setGeneratedSql={layout.setGeneratedSql}
              setShowAutocomplete={setShowAutocomplete}
            />

            {/* Import actions */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                {/* Format */}
                <button
                  onClick={handleFormatSql}
                  disabled={!importText}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.03] border border-white/[0.06] text-white/60 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30"
                >
                  <Braces size={11} />
                  Format
                </button>
              </div>
              <button
                onClick={handleGenerateFromImport}
                disabled={!importText.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#4A90D9] to-[#2d6db5] text-white text-[11px] font-bold shadow-[0_4px_16px_rgba(74,144,217,0.25)] hover:shadow-[0_6px_20px_rgba(74,144,217,0.35)] transition-all disabled:opacity-40"
              >
                <Database size={12} />
                Import & Build
              </button>
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

      {/* ─── STATUS BAR ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.04] bg-[#030710]/60 shrink-0">
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
            <span className="text-[9px] text-white/40 font-mono font-bold uppercase">PostgreSQL</span>
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
    </div>
  );
}
