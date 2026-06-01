"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles } from "lucide-react";
import { CanvasLoader } from "./CanvasLoader";

const PLACEHOLDER_PROMPTS = [
  "A multi-tenant SaaS platform with users, workspaces, billing and audit logs...",
  "An e-commerce system with products, orders, inventory and reviews...",
  "A hospital management system with patients, doctors, appointments and records...",
  "A social platform with users, posts, comments, likes and followers...",
];

export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  // Cycle placeholders
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_PROMPTS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    sessionStorage.setItem("designdb_prompt", prompt.trim());
    setLoading(true);
  };

  const handleLoaderComplete = useCallback(() => {
    router.push("/canvas");
  }, [router]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSubmit();
    }
  };

  return (
    <>
      {loading && <CanvasLoader onComplete={handleLoaderComplete} />}

      <div className="w-full max-w-2xl mx-auto flex flex-col gap-4">
        {/* Prompt container */}
        <div
          className="relative rounded-2xl transition-all duration-300 border"
          style={{
            background: "rgba(5,10,22,0.65)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderColor: isFocused
              ? "rgba(194,239,78,0.4)"
              : "rgba(255,255,255,0.06)",
            boxShadow: isFocused
              ? "0 0 32px rgba(194,239,78,0.1), inset 0 0 24px rgba(255,255,255,0.02)"
              : "0 12px 48px rgba(0,0,0,0.5)",
          }}
        >
          {/* Sparkle icon */}
          <div className="absolute top-4.5 left-4.5 text-lime-green/70 animate-pulse">
            <Sparkles size={16} />
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDER_PROMPTS[placeholderIdx]}
            rows={4}
            className="w-full bg-transparent text-white/90 text-sm leading-relaxed resize-none outline-none pl-11 pr-4.5 pt-4.5 pb-16 placeholder:text-white/20 transition-colors font-sans"
          />

          {/* Footer bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4.5 py-3.5 border-t border-white/[0.06]">
            <span className="text-[10px] text-white/30 tracking-wide font-mono">
              CTRL + ENTER to synthesize
            </span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="flex items-center gap-2 px-5 py-2 rounded-full text-xs font-bold tracking-wide transition-all duration-200 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer"
              style={{
                background: prompt.trim()
                  ? "#C2EF4E"
                  : "rgba(255,255,255,0.05)",
                color: prompt.trim() ? "#030712" : "rgba(255,255,255,0.3)",
                boxShadow: prompt.trim() ? "0 4px 16px rgba(194,239,78,0.25)" : "none",
              }}
            >
              Generate Schema
              <ArrowRight size={13} />
            </button>
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
              className="px-3.5 py-1.5 rounded-full text-[11px] font-medium tracking-wide text-white/40 hover:text-white hover:border-lime-green/30 hover:bg-white/[0.02] hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
