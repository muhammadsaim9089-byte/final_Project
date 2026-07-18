"use client";

import { useCallback, useState } from "react";
import { 
  Play, Share2, FileCode2, FileType, Image as ImageIcon, Cloud, Check, Loader2, 
  ChevronDown, FileImage, FileText
} from "lucide-react";
import { ReactFlowInstance } from "@xyflow/react";
import { showToast } from "../ui/toast";
import { useLayout } from "@/components/Layout/LayoutContext";
import { validateCanvasSchema } from "@/lib/canvasValidation";

interface FloatingHeaderProps {
  generatedSql?: string;
  generatedMermaid?: string;
  rfInstance?: ReactFlowInstance | null;
  showSidebar?: boolean;
  projectTitle: string;
  setProjectTitle: (title: string) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

}

export function FloatingHeader({ 
  generatedSql, 
  generatedMermaid, 
  rfInstance, 
  showSidebar: _showSidebar = false,
  projectTitle,
  setProjectTitle,
  currentProjectId,
  setCurrentProjectId,

}: FloatingHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [validationState, setValidationState] = useState<"idle" | "validating" | "success" | "error">("idle");
  const [shareState, setShareState] = useState<"idle" | "success">("idle");

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
    const title = projectTitle || "Untitled Schema";
    const rawPrompt = sessionStorage.getItem("designdb_prompt") || "";

    try {
      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentProjectId || undefined,
          title,
          rawPrompt,
          nodes,
          edges
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentProjectId(data.project.id);
        setProjectTitle(data.project.title);
        setSaveState("success");
        showToast("Saved to cloud", "cloud");
        setTimeout(() => setSaveState("idle"), 3000);
      } else {
        const errorData = await res.json();
        showToast(`Failed to save: ${errorData.error}`, "error");
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 3000);
      }
    } catch (error: any) {
      console.error(error);
      showToast(`Failed to save: ${error.message}`, "error");
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 3000);
    }
  };

  const layout = useLayout();

  const checkValidationBeforeExport = useCallback((): boolean => {
    if (!rfInstance) return true;
    const nodes = rfInstance.getNodes();
    const edges = rfInstance.getEdges();
    const validation = validateCanvasSchema(nodes, edges);
    const criticalErrors = Object.values(validation.errors).flat();
    
    if (criticalErrors.length > 0) {
      showToast(`Export blocked: Resolve ${criticalErrors.length} critical errors first.`, "error");
      layout.triggerToggleAiInsights();
      return false;
    }
    return true;
  }, [rfInstance, layout]);

  const handleDownloadSql = () => {
    if (!checkValidationBeforeExport()) return;
    downloadAsFile(generatedSql || "", "designdb_schema.sql", "application/sql");
    showToast("SQL script downloaded", "download");
  };

  const handleDownloadMermaid = () => {
    if (!checkValidationBeforeExport()) return;
    downloadAsFile(generatedMermaid || "", "designdb_erd.mmd", "text/plain");
    showToast("Mermaid file downloaded", "download");
  };

  const handleDownloadSvg = useCallback(() => {
    if (!rfInstance) return;
    if (!checkValidationBeforeExport()) return;
    const flowWrapper = document.querySelector(".react-flow") as HTMLElement | null;
    if (!flowWrapper) return;

    const { width, height } = flowWrapper.getBoundingClientRect();
    const clone = flowWrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".react-flow__controls, .react-flow__panel, .react-flow__minimap").forEach(el => el.remove());

    let cssStyles = "";
    try {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        if (!sheet.href || sheet.href.startsWith(window.location.origin)) {
          const rules = Array.from(sheet.cssRules);
          for (const rule of rules) {
            cssStyles += rule.cssText;
          }
        }
      }
    } catch (e) {
      console.warn("Could not copy document styles for SVG export:", e);
    }

    const computedStyle = getComputedStyle(document.documentElement);
    const themeColor = computedStyle.getPropertyValue('--theme-color').trim() || '#6a5fc1';
    const nodeFont = computedStyle.getPropertyValue('--node-font').trim() || 'Vagnola, sans-serif';
    const nodeOpacity = computedStyle.getPropertyValue('--node-opacity').trim() || '1';

    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <style>
          ${cssStyles}
          :root {
            --theme-color: ${themeColor};
            --node-font: ${nodeFont};
            --node-opacity: ${nodeOpacity};
          }
          body, div, span, h3 {
            font-family: ${nodeFont}, system-ui, sans-serif !important;
          }
        </style>
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#0a0f1e;position:relative;">
            ${clone.outerHTML}
          </div>
        </foreignObject>
      </svg>`;

    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = "designdb_erd.svg";
    document.body.appendChild(a);
    a.click();
    showToast("SVG vector image downloaded", "download");
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }, [rfInstance, checkValidationBeforeExport]);

  const handleDownloadPng = useCallback(() => {
    if (!rfInstance) return;
    if (!checkValidationBeforeExport()) return;
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

    let cssStyles = "";
    try {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        if (!sheet.href || sheet.href.startsWith(window.location.origin)) {
          const rules = Array.from(sheet.cssRules);
          for (const rule of rules) {
            cssStyles += rule.cssText;
          }
        }
      }
    } catch (e) {
      console.warn("Could not copy document styles for SVG export:", e);
    }

    const computedStyle = getComputedStyle(document.documentElement);
    const themeColor = computedStyle.getPropertyValue('--theme-color').trim() || '#6a5fc1';
    const nodeFont = computedStyle.getPropertyValue('--node-font').trim() || 'Vagnola, sans-serif';
    const nodeOpacity = computedStyle.getPropertyValue('--node-opacity').trim() || '1';

    const svgData = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <style>
          ${cssStyles}
          :root {
            --theme-color: ${themeColor};
            --node-font: ${nodeFont};
            --node-opacity: ${nodeOpacity};
          }
          body, div, span, h3 {
            font-family: ${nodeFont}, system-ui, sans-serif !important;
          }
        </style>
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#0a0f1e;position:relative;">
            ${clone.outerHTML}
          </div>
        </foreignObject>
      </svg>`;

    const img = new window.Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = dataUrl;
      a.download = "designdb_erd.png";
      document.body.appendChild(a);
      a.click();
      showToast("PNG image downloaded", "download");
      setTimeout(() => {
        document.body.removeChild(a);
      }, 500);
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);
  }, [rfInstance, checkValidationBeforeExport]);

  const handleDownloadPdf = useCallback(() => {
    if (!rfInstance) return;
    if (!checkValidationBeforeExport()) return;
    const flowWrapper = document.querySelector(".react-flow") as HTMLElement | null;
    if (!flowWrapper) return;

    const { width, height } = flowWrapper.getBoundingClientRect();
    const clone = flowWrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".react-flow__controls, .react-flow__panel, .react-flow__minimap").forEach(el => el.remove());

    let cssStyles = "";
    try {
      const sheets = Array.from(document.styleSheets);
      for (const sheet of sheets) {
        if (!sheet.href || sheet.href.startsWith(window.location.origin)) {
          const rules = Array.from(sheet.cssRules);
          for (const rule of rules) {
            cssStyles += rule.cssText;
          }
        }
      }
    } catch (e) {
      console.warn("Could not copy document styles for PDF export:", e);
    }

    const computedStyle = getComputedStyle(document.documentElement);
    const themeColor = computedStyle.getPropertyValue('--theme-color').trim() || '#6a5fc1';
    const nodeFont = computedStyle.getPropertyValue('--node-font').trim() || 'Vagnola, sans-serif';

    const printHtml = `
      <html>
        <head>
          <title>DesignDB ERD Export</title>
          <style>
            ${cssStyles}
            :root {
              --theme-color: ${themeColor};
              --node-font: ${nodeFont};
            }
            body, div, span, h3 {
              font-family: ${nodeFont}, system-ui, sans-serif !important;
            }
            body {
              margin: 0;
              padding: 0;
              background: #0a0f1e;
              display: flex;
              justify-content: center;
              align-items: center;
              width: 100vw;
              height: 100vh;
              overflow: hidden;
            }
            @media print {
              body {
                background: #ffffff !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              .container {
                background: #ffffff !important;
              }
            }
            .container {
              width: ${width}px;
              height: ${height}px;
              position: relative;
              background: #0a0f1e;
              transform: scale(min(1, min(800 / ${width}, 1100 / ${height})));
              transform-origin: center center;
            }
          </style>
        </head>
        <body>
          <div class="container">
            ${clone.outerHTML}
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;

    const popup = window.open("", "_blank");
    if (popup) {
      popup.document.open();
      popup.document.write(printHtml);
      popup.document.close();
      showToast("PDF document downloaded via print utility", "download");
    } else {
      showToast("Popup blocked! Enable popups to print/save as PDF", "error");
    }
  }, [rfInstance, checkValidationBeforeExport]);

  const hasSql = !!generatedSql && !generatedSql.startsWith("-- DesignDB: No prompt") && !generatedSql.startsWith("-- Error");
  const hasMermaid = !!generatedMermaid;

  return (
    <>

      {/* Standalone Actions Button — top-right fixed */}
      <div 
        className="absolute top-6 right-6 z-50 pointer-events-auto transition-all duration-300 ease-in-out flex items-center gap-3"
      >


        <div className="relative">
          {/* Split Drop Menu Button Container */}
          <div className="flex items-center rounded-full overflow-hidden shadow-[0_4px_16px_rgba(0,0,0,0.2)] focus-within:ring-2 focus-within:ring-white/20 transition-all">
            {/* Leading Button (Left Side) */}
            <button
              id="actions-main-button"
              onClick={() => setMenuOpen(!menuOpen)}
              className={`flex items-center gap-2 pl-4 pr-3 py-2 text-xs font-medium text-white transition-all outline-none
                ${menuOpen ? 'bg-[#5a51a6]' : 'bg-[#6a5fc1] hover:bg-[#5a51a6] active:bg-[#4f469c]'}
              `}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
              </svg>
              Actions
            </button>
            
            {/* Separator */}
            <div className={`w-[1px] self-stretch transition-colors ${menuOpen ? 'bg-[#4f469c]' : 'bg-[#5a51a6]'}`} />
            
            {/* Trailing Button (Right Side - Chevron) */}
            <button
              id="actions-menu-button"
              onClick={() => setMenuOpen(!menuOpen)}
              className={`flex items-center justify-center pl-2 pr-3 py-2 text-white transition-all outline-none
                ${menuOpen ? 'bg-[#5a51a6]' : 'bg-[#6a5fc1] hover:bg-[#5a51a6] active:bg-[#4f469c]'}
              `}
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              <ChevronDown size={14} className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>

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
                    if (!rfInstance) {
                      setValidationState("error");
                      showToast("No canvas instance to validate", "error");
                      setTimeout(() => setValidationState("idle"), 2000);
                      return;
                    }
                    setValidationState("validating");
                    setTimeout(() => {
                      const nodes = rfInstance.getNodes();
                      const edges = rfInstance.getEdges();
                      const validation = validateCanvasSchema(nodes, edges);
                      if (validation.isValid) {
                        setValidationState("success");
                        showToast("Schema is fully valid ✓", "validate");
                      } else {
                        const errorCount = Object.values(validation.errors).flat().length;
                        setValidationState("error");
                        showToast(`Schema validation failed with ${errorCount} error(s) ✕`, "error");
                        layout.triggerToggleAiInsights();
                      }
                      setTimeout(() => setValidationState("idle"), 3000);
                    }, 1000);
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
                    showToast("Share link copied to clipboard", "share");
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

                {/* SVG Export */}
                <button
                  onClick={() => { handleDownloadSvg(); setMenuOpen(false); }}
                  disabled={!rfInstance}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  <FileImage size={14} className="text-amber-400" />
                  SVG Vector
                </button>

                {/* PDF Export */}
                <button
                  onClick={() => { handleDownloadPdf(); setMenuOpen(false); }}
                  disabled={!rfInstance}
                  className="flex items-center gap-2.5 px-3.5 py-2 text-xs rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-white/70 hover:text-white hover:bg-white/[0.05] font-medium"
                >
                  <FileText size={14} className="text-sky-400" />
                  PDF Document
                </button>

              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
