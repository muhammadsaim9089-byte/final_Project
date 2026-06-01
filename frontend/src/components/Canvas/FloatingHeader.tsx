"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { 
  Play, Share2, FileCode2, FileType, Image as ImageIcon, Cloud, Check, Loader2, 
  ChevronDown, Sparkles, ArrowRight, Menu
} from "lucide-react";
import { ReactFlowInstance } from "@xyflow/react";

interface FloatingHeaderProps {
  generatedSql?: string;
  generatedMermaid?: string;
  rfInstance?: ReactFlowInstance | null;
  onSubmitPrompt?: (prompt: string) => void;
  isGenerating?: boolean;
}

export function FloatingHeader({ 
  generatedSql, 
  generatedMermaid, 
  rfInstance, 
  onSubmitPrompt, 
  isGenerating 
}: FloatingHeaderProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [validationState, setValidationState] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [shareState, setShareState] = useState<"idle" | "success">("idle");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && onSubmitPrompt) {
      onSubmitPrompt(prompt.trim());
      setPrompt("");
    }
  };

  const downloadAsFile = useCallback(async (content: string, filename: string, mimeType: string) => {
    if (!content) return;
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, filename, mimeType }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }, []);

  const handleSaveToCloud = async () => {
    if (!rfInstance || saveState === "saving") return;
    setSaveState("saving");
    const nodes = rfInstance.getNodes();
    const edges = rfInstance.getEdges();
    const title = "My DesignDB Schema";
    const rawPrompt = sessionStorage.getItem("designdb_prompt") || "";

    try {
      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, rawPrompt, nodes, edges }),
      });
      if (res.ok) {
        setSaveState("success");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        const errorData = await res.json();
        alert(`Server Error: ${errorData.error}`);
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 3000);
      }
    } catch (error: any) {
      console.error(error);
      alert(`Network Error: ${error.message}`);
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  const handleDownloadSql = () => {
    downloadAsFile(generatedSql || "", "designdb_schema.sql", "application/sql");
  };

  const handleDownloadMermaid = () => {
    downloadAsFile(generatedMermaid || "", "designdb_erd.mmd", "text/plain");
  };

  const handleDownloadPng = useCallback(() => {
    if (!rfInstance) return;
    const flowWrapper = document.querySelector(".react-flow") as HTMLElement | null;
    if (!flowWrapper) return;

    const { width, height } = flowWrapper.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const clone = flowWrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".react-flow__controls, .react-flow__panel, .react-flow__minimap").forEach(el => el.remove());

    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#0a0f1e;">
            ${clone.outerHTML}
          </div>
        </foreignObject>
      </svg>`;

    const img = new window.Image();
    img.onload = async () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");

      const res = await fetch("/api/download-png", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = "designdb_erd.png";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
  }, [rfInstance]);

  const hasSql = !!generatedSql && !generatedSql.startsWith("-- DesignDB: No prompt") && !generatedSql.startsWith("-- Error");
  const hasMermaid = !!generatedMermaid;

  return (
    <div className="absolute top-6 left-0 right-0 z-50 px-6 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-6xl h-14 rounded-full bg-[#030712]/75 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-between px-6 transition-all duration-300">
        
        {/* Left: DesignDB Logo */}
        <div 
          className="flex items-center gap-2 cursor-pointer shrink-0" 
          onClick={() => router.push("/")}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-lime-green to-[#0f2d12] shadow-[0_0_12px_rgba(194,239,78,0.25)] flex items-center justify-center border border-lime-green/20">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" fill="#C2EF4E" />
              <rect x="8" y="1.5" width="4.5" height="4.5" rx="1" fill="rgba(194,239,78,0.4)" />
              <rect x="1.5" y="8" width="4.5" height="4.5" rx="1" fill="rgba(194,239,78,0.4)" />
              <rect x="8" y="8" width="4.5" height="4.5" rx="1" fill="#C2EF4E" />
            </svg>
          </div>
          <span className="text-sm font-bold tracking-wide select-none text-white" style={{ fontFamily: "Vagnola, sans-serif" }}>
            Design<span className="text-lime-green">DB</span>
          </span>
        </div>

        {/* Middle: Combined AI Prompting Input */}
        <form 
          onSubmit={handleSubmit} 
          className="flex-1 max-w-xl mx-8 flex items-center bg-white/[0.03] border border-white/[0.06] rounded-full px-4.5 py-1.5 focus-within:border-lime-green/30 focus-within:bg-white/[0.05] transition-all"
        >
          <Sparkles size={13} className="text-lime-green/75 shrink-0 mr-2.5 animate-pulse" />
          <input 
            value={prompt} 
            onChange={e => setPrompt(e.target.value)} 
            disabled={isGenerating}
            placeholder="Modify schema in plain English (e.g. Add an orders table)..." 
            className="w-full bg-transparent text-[12px] text-white placeholder-white/20 outline-none font-sans" 
          />
          <button 
            type="submit" 
            disabled={isGenerating || !prompt.trim()} 
            className="p-1 rounded-full bg-lime-green text-[#050B14] hover:bg-lime-green/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0 ml-2 shadow-[0_2px_8px_rgba(194,239,78,0.2)]"
          >
            {isGenerating ? <Loader2 size={11} className="animate-spin text-[#050B14]" /> : <ArrowRight size={11} />}
          </button>
        </form>

        {/* Right: Consolidated Action Menu/Dropdown */}
        <div className="relative shrink-0 flex items-center gap-2">
          
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-4.5 py-2 text-xs font-bold rounded-full transition-all text-white bg-white/5 hover:bg-white/10 border border-white/[0.08]"
          >
            <Menu size={12} />
            Actions
            <ChevronDown size={12} className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
          </button>

          {menuOpen && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setMenuOpen(false)} 
              />
              <div className="absolute top-full right-0 mt-3 w-52 bg-[#050913]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden z-50 flex flex-col p-2 animate-in fade-in slide-in-from-top-3 duration-250">
                
                {/* Save to Cloud */}
                <button
                  onClick={() => { handleSaveToCloud(); setMenuOpen(false); }}
                  disabled={saveState === "saving"}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all text-white/70 hover:text-white hover:bg-white/[0.05] disabled:opacity-50 font-medium"
                >
                  {saveState === "saving" ? <Loader2 size={14} className="animate-spin text-lime-green" /> : <Cloud size={14} className="text-lime-green" />}
                  <span>Save to Cloud</span>
                </button>

                {/* Validate Schema */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (validationState !== "idle") return;
                    if (!generatedSql) {
                      setValidationState("error");
                      setTimeout(() => setValidationState("idle"), 2000);
                      return;
                    }
                    setValidationState("validating");
                    setTimeout(() => {
                      setValidationState("success");
                      setTimeout(() => setValidationState("idle"), 3000);
                    }, 1500);
                  }}
                  disabled={validationState !== "idle"}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all text-white/70 hover:text-white hover:bg-white/[0.05] disabled:opacity-50 font-medium"
                >
                  {validationState === "validating" ? <Loader2 size={14} className="animate-spin text-sentry-purple" /> : <Play size={14} className="text-sentry-purple fill-current" />}
                  <span>Validate Schema</span>
                </button>

                {/* Share Project */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (shareState !== "idle") return;
                    const dummyId = Math.random().toString(36).substring(2, 9);
                    const shareLink = `https://designdb.app/share/${dummyId}`;
                    navigator.clipboard.writeText(shareLink);
                    setShareState("success");
                    setTimeout(() => setShareState("idle"), 2000);
                  }}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  {shareState === "success" ? <Check size={14} className="text-green-400" /> : <Share2 size={14} className="text-coral-accent" />}
                  <span>Share Project</span>
                </button>

                <div className="h-px bg-white/[0.06] my-1.5" />
                <span className="text-[9px] text-white/30 uppercase font-mono px-3.5 py-1 tracking-wider block">Export Format</span>

                {/* SQL Export */}
                <button
                  onClick={() => { handleDownloadSql(); setMenuOpen(false); }}
                  disabled={!hasSql}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  <FileCode2 size={14} className="text-lime-green" />
                  SQL Script
                </button>

                {/* Mermaid Export */}
                <button
                  onClick={() => { handleDownloadMermaid(); setMenuOpen(false); }}
                  disabled={!hasMermaid}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  <FileType size={14} className="text-sentry-purple" />
                  Mermaid File
                </button>

                {/* PNG Export */}
                <button
                  onClick={() => { handleDownloadPng(); setMenuOpen(false); }}
                  disabled={!rfInstance}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  <ImageIcon size={14} className="text-coral-accent" />
                  PNG Image
                </button>

              </div>
            </>
          )}

        </div>

      </div>
    </div>
  );
}
