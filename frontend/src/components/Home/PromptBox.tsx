"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CanvasLoader } from "./CanvasLoader";

export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Prefetch the canvas page on mount so chunks are ready before navigation
  useEffect(() => {
    router.prefetch("/canvas");
  }, [router]);

  // Auto-resize textarea height on every change
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to 1-row so scrollHeight recalculates from content
    el.style.height = "0px";
    // Grow to fit content, capped at ~8 lines (200px)
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    // Resize immediately in the same frame
    requestAnimationFrame(autoResize);
  };

  // Also resize when prompt changes externally (e.g. chip click)
  useEffect(() => {
    autoResize();
  }, [prompt, autoResize]);

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    sessionStorage.setItem("designdb_prompt", prompt.trim());
    setLoading(true);
  };

  const handleLoaderComplete = useCallback(() => {
    // replace (not push) prevents browser back-button from returning to home
    // during heavy canvas chunk loading, which caused the back-navigation loop
    router.replace("/canvas");
  }, [router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      {loading && <CanvasLoader onComplete={handleLoaderComplete} />}

      <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-6 px-4">
        {/* Prompt Container */}
        <div className="w-full flex justify-center">
          <div className="relative w-full max-w-2xl bg-white/[0.06] border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden transition-all duration-300 hover:border-[#4f46e5] hover:shadow-[0_0_15px_rgba(79,70,229,0.2)] focus-within:shadow-[0_0_20px_rgba(79,70,229,0.4)] focus-within:border-[#4f46e5] focus-within:bg-white/[0.08]">
            <div className="flex items-end gap-2 p-3">
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 min-h-[40px] px-3 py-2 text-[15px] text-white bg-transparent border-none outline-none placeholder:text-white/55 resize-none overflow-y-auto leading-relaxed scrollbar-hide"
                style={{ maxHeight: "200px" }}
                placeholder="Ask AI anything..."
                value={prompt}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
              />
              <button 
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                className="bg-[#4f46e5] border-none w-[38px] h-[38px] rounded-full cursor-pointer transition-all duration-300 flex justify-center items-center shrink-0 hover:bg-[#6366f1] hover:shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:-rotate-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-white text-[16px]">➤</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick example chips */}
        <div className="flex flex-wrap gap-2 justify-center mt-1">
          {["E-commerce", "SaaS Platform", "Hospital DB", "Social App"].map((chip) => (
            <button
              key={chip}
              onClick={() =>
                setPrompt(
                  `Design a ${chip.toLowerCase()} database with all relevant tables and relationships`
                )
              }
              className="px-3.5 py-1.5 rounded-full text-[11px] font-medium tracking-wide text-white/65 hover:text-white hover:border-lime-green/30 hover:bg-white/[0.02] hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Direct SQL DDL Import Option */}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-xs text-white/40">
          <div className="flex items-center gap-1.5">
            <span>Or have existing SQL DDL?</span>
            <button
              onClick={() => {
                sessionStorage.setItem("designdb_action", "import");
                setLoading(true);
              }}
              className="text-[#4a90d9] hover:text-[#7eb8f7] font-semibold underline transition-colors"
            >
              Import SQL DDL directly
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

