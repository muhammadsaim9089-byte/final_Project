"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, CloudUpload, Loader2 } from "lucide-react";
import { useLayout } from "./LayoutContext";
import { relativeTime } from "@/lib/projects";

/**
 * The editor's save status, next to the AI button (where Figma, Notion and dbdiagram put theirs): what state the
 * diagram is in, and the one click that fixes it. Ctrl+S does the same as clicking it.
 */
export function SaveIndicator() {
  const layout = useLayout();
  const { state, savedAt, error } = layout.saveStatus;
  // keep "Saved 2 minutes ago" current
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const save = () => void layout.requestSave({ explicit: true });
  const base = "flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12.5px] font-semibold whitespace-nowrap transition-colors";
  const ago = savedAt ? relativeTime(savedAt) : "";

  switch (state) {
    case "empty":
      return (
        <span className={`${base} border-transparent text-white/55 cursor-default`} title="Add a table — then save it to keep it on your dashboard">
          Not saved
        </span>
      );
    case "unsaved":
      return (
        <button onClick={save} className={`${base} bg-white text-[#1d5fb1] border-white hover:bg-white/90 shadow-sm`} title="This diagram isn't saved yet — save it to keep it on your dashboard (Ctrl+S)">
          <CloudUpload size={15} /> Save
        </button>
      );
    case "dirty":
      return (
        <button onClick={save} className={`${base} bg-white/10 border-white/20 hover:bg-white/20 text-white`} title="Unsaved changes — saving automatically (click or Ctrl+S to save now)">
          <span className="w-2 h-2 rounded-full bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]" /> Unsaved changes
        </button>
      );
    case "saving":
      return (
        <span className={`${base} bg-white/10 border-white/20 text-white/85`} aria-live="polite">
          <Loader2 size={14} className="animate-spin" /> Saving…
        </span>
      );
    case "error":
      return (
        <button onClick={save} className={`${base} bg-red-500/90 border-red-300/60 hover:bg-red-500 text-white`} title={`Couldn't save: ${error || "unknown error"} — click to try again`}>
          <AlertTriangle size={14} /> Save failed · Retry
        </button>
      );
    default:
      return (
        <button onClick={save} className={`${base} border-transparent text-white/85 hover:bg-white/10`} title={`All changes saved${ago ? ` · ${ago}` : ""} — changes save automatically (Ctrl+S saves a version too)`} aria-live="polite">
          <Check size={15} className="text-emerald-300" /> Saved{ago && ago !== "just now" ? <span className="font-normal text-white/60">· {ago}</span> : null}
        </button>
      );
  }
}
