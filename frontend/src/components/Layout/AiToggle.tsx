"use client";

import React from "react";
import { Sparkles } from "lucide-react";

/**
 * The AI assistant's on/off switch in the top bar's menu row. On opens the AI panel, off closes it.
 * The knob springs across; while on, the track's gradient flows and the sparkle pops, then glows softly
 * (keyframes in globals.css: .ai-track-on, .ai-sparkle-on). Everything holds still under prefers-reduced-motion.
 */
export function AiToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="AI assistant"
      title={on ? "Close the AI assistant" : "Open the AI assistant"}
      onClick={onToggle}
      className={`group mx-1 xl:mx-2 h-8 pl-2.5 pr-1.5 flex items-center gap-2 rounded-full border text-white transition-[background-color,border-color,box-shadow] duration-300 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        on
          ? "bg-[#1d1546] border-violet-300/60 shadow-[0_0_0_3px_rgba(167,139,250,0.2),0_0_18px_rgba(139,92,246,0.5)]"
          : "bg-white/10 border-white/25 hover:bg-white/[0.17] hover:border-white/40"
      }`}
    >
      <Sparkles size={15} className={on ? "ai-sparkle-on text-violet-200" : "text-white/85 group-hover:text-white"} />
      <span className="text-[13px] font-semibold tracking-wider">AI</span>
      <span aria-hidden className={`relative w-9 h-5 rounded-full transition-colors duration-300 motion-reduce:transition-none ${on ? "ai-track-on" : "bg-white/20 group-hover:bg-white/30"}`}>
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}
