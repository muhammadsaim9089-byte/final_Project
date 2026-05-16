"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
          className="relative rounded-2xl transition-all duration-300"
          style={{
            background: "rgba(0,18,32,0.55)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: isFocused
              ? "1px solid rgba(30,84,159,0.6)"
              : "1px solid rgba(255,255,255,0.06)",
            boxShadow: isFocused
              ? "0 0 40px rgba(30,84,159,0.2), inset 0 0 40px rgba(30,84,159,0.04)"
              : "0 8px 40px rgba(0,0,0,0.4)",
          }}
        >
          {/* Sparkle icon */}
          <div className="absolute top-4 left-4 text-[#1e549f] opacity-70">
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
            className="w-full bg-transparent text-white/90 text-sm leading-relaxed resize-none outline-none pl-10 pr-4 pt-4 pb-14 placeholder:text-white/20 transition-colors"
            style={{ fontFamily: "Vagnola, sans-serif" }}
          />

          {/* Footer bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3 border-t border-white/5">
            <span className="text-[11px] text-white/25 tracking-wide">⌘ + Enter to generate</span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium tracking-wide transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              style={{
                background: prompt.trim()
                  ? "linear-gradient(135deg, #1e549f 0%, #052c52 100%)"
                  : "rgba(255,255,255,0.05)",
                color: "white",
                border: "1px solid rgba(30,84,159,0.4)",
                boxShadow: prompt.trim() ? "0 0 16px rgba(30,84,159,0.35)" : "none",
              }}
            >
              Generate Schema
              <ArrowRight size={13} />
            </button>
          </div>
        </div>

        {/* Quick example chips */}
        <div className="flex flex-wrap gap-2 justify-center">
          {["E-commerce", "SaaS Platform", "Hospital DB", "Social App"].map((chip) => (
            <button
              key={chip}
              onClick={() =>
                setPrompt(
                  `Design a ${chip.toLowerCase()} database with all relevant tables and relationships`
                )
              }
              className="px-3 py-1 rounded-full text-[11px] tracking-wide text-white/40 hover:text-white/70 transition-all duration-200 cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
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
