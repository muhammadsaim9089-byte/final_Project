"use client";

import { useState, useEffect, useRef } from "react";
import { Play, Copy, Check, FileCode2, AlertCircle } from "lucide-react";
import { showToast } from "../ui/toast";

interface DbmlEditorProps {
  value: string;
  onChange: (val: string) => void;
  onApply: (val: string) => string | null; // returns error message if parse fails, or null if success
}

export function DbmlEditor({ value, onChange, onApply }: DbmlEditorProps) {
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Sync scroll of textarea and line numbers gutter
  const handleScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Generate line numbers array
  const lines = value.split("\n");
  const lineNumbers = Array.from({ length: Math.max(lines.length, 1) }, (_, i) => i + 1);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    showToast("DBML copied to clipboard", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRun = () => {
    const error = onApply(value);
    if (error) {
      setParseError(error);
      showToast("Compile Error: Review DBML syntax", "error");
    } else {
      setParseError(null);
      showToast("DBML compiled and synced to canvas!", "success");
    }
  };

  // Automatic compile on idle typing pauses (debounce)
  useEffect(() => {
    const t = setTimeout(() => {
      const error = onApply(value);
      setParseError(error);
    }, 1200);
    return () => clearTimeout(t);
  }, [value, onApply]);

  return (
    <div className="w-full h-full flex flex-col bg-[#050913]/90 backdrop-blur-xl border-r border-white/[0.08] relative font-sans">
      {/* Editor Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-[#070e1a]/80 shrink-0">
        <div className="flex items-center gap-2">
          <FileCode2 size={15} className="text-[#4A90D9]" />
          <span className="text-xs font-semibold text-white uppercase tracking-wider font-mono">DBML Code Workspace</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/[0.05] transition-all"
            title="Copy DBML Code"
          >
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          
          {/* Compile Button */}
          <button
            onClick={handleRun}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 hover:text-white transition-all shadow-[0_4px_12px_rgba(74,144,217,0.2)]"
            title="Compile & Render"
          >
            <Play size={10} className="fill-current" />
            Compile
          </button>
        </div>
      </div>

      {/* Editor Text Workspace */}
      <div className="flex-1 flex overflow-hidden relative min-h-0 bg-[#040811]/50">
        {/* Line Numbers Gutter */}
        <div
          ref={gutterRef}
          className="w-10 bg-[#050913]/60 border-r border-white/[0.04] text-right pr-2 py-4 select-none font-mono text-[11px] text-white/20 overflow-hidden leading-6"
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          className="flex-1 bg-transparent border-none outline-none resize-none px-4 py-4 font-mono text-[12px] text-slate-200 placeholder:text-white/10 overflow-y-auto leading-6 focus:ring-0 p-scrollbar selection:bg-blue-500/20"
          placeholder={`// DesignDB DBML Editor
// Type DBML markup to render visuals instantly

Table users {
  id integer [primary key]
  username varchar
  created_at timestamp
}

Table posts {
  id integer [primary key]
  title varchar
  user_id integer
}

Ref: posts.user_id > users.id`}
          spellCheck="false"
        />
      </div>

      {/* Error Marker Panel */}
      {parseError && (
        <div className="bg-red-950/20 border-t border-red-500/30 p-3.5 flex gap-2.5 items-start shrink-0 animate-in slide-in-from-bottom-2">
          <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h4 className="text-[11px] font-bold font-mono text-red-400 uppercase tracking-wider mb-0.5">Syntax / Compile Error</h4>
            <p className="text-xs text-red-300/80 leading-relaxed font-sans">{parseError}</p>
          </div>
        </div>
      )}
    </div>
  );
}
