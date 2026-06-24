"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CanvasLoader } from "./CanvasLoader";

export function PromptBox() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  // Prefetch the canvas page on mount so chunks are ready before navigation
  useEffect(() => {
    router.prefetch("/canvas");
  }, [router]);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <>
      {loading && <CanvasLoader onComplete={handleLoaderComplete} />}

      <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-6">
        {/* Tailwind Prompt Wrapper */}
        <div className="flex justify-center items-center w-full h-full bg-transparent font-sans">
          <div className="group flex items-center w-fit min-w-[280px] bg-white/[0.06] border border-white/10 rounded-full backdrop-blur-md p-1.5 transition-all duration-300 hover:border-[#4f46e5] hover:shadow-[0_0_15px_rgba(79,70,229,0.2)] focus-within:shadow-[0_0_20px_rgba(79,70,229,0.4)] focus-within:border-[#4f46e5] focus-within:bg-white/[0.08]">
            <input
              type="text"
              className="flex-1 w-full min-w-[240px] max-w-[400px] px-5 py-3 text-[15px] text-white bg-transparent border-none outline-none transition-all duration-300 placeholder:text-white/55 focus:min-w-[380px]"
              placeholder="Ask AI anything..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button 
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="bg-[#4f46e5] border-none w-[38px] h-[38px] rounded-full cursor-pointer transition-all duration-300 flex justify-center items-center ml-2.5 hover:bg-[#6366f1] hover:shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:-rotate-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="text-white text-[16px]">➤</span>
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
      </div>
    </>
  );
}
