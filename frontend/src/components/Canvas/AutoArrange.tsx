"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, LayoutDashboard, LayoutGrid, Network, Snowflake, Workflow, type LucideIcon } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";

/**
 * Auto arrange (dbdiagram-style): the bottom toolbar's arrange button opens a chooser of algorithms; picking one asks
 * for confirmation in a popover pointing at that button; confirming rearranges the whole diagram (one undo step).
 * The Inspect drawer opens the same chooser / confirmation through `requestAutoArrange`, so there is one flow and one
 * place it is drawn. (The top bar has no View menu any more: this chooser is the place to pick a layout, Top-bottom
 * included.)
 */

export type ArrangeKind = "domains" | "LR" | "pipeline" | "snowflake" | "compact" | "TB";
/** null = closed, "choose" = the algorithm list, a kind = confirming that algorithm */
export type ArrangeStage = null | "choose" | ArrangeKind;

export const ARRANGE_ALGORITHMS: { kind: ArrangeKind; name: string; description: string; Icon: LucideIcon }[] = [
  {
    kind: "domains",
    name: "Domains",
    description: "Each table group, or cluster of related tables, flows left to right in its own block; the blocks fill a widescreen grid, related ones side by side. The default for new diagrams.",
    Icon: LayoutDashboard,
  },
  {
    kind: "LR",
    name: "Left-right",
    description: "Tables flow left to right along their foreign-key relationships. Best for schemas with long relationship chains.",
    Icon: Workflow,
  },
  {
    kind: "pipeline",
    name: "Pipeline",
    description: "Tables flow left to right along their data lineage. Each table group becomes a stage, its tables stacked vertically.",
    Icon: Columns3,
  },
  {
    kind: "snowflake",
    name: "Snowflake",
    description: "The most connected tables in the centre, their neighbours in rings around them. Ideal for densely connected diagrams like data warehouses.",
    Icon: Snowflake,
  },
  {
    kind: "compact",
    name: "Compact",
    description: "Tables packed into a tight rectangle. Ideal for diagrams with few tables and relationships.",
    Icon: LayoutGrid,
  },
  {
    kind: "TB",
    name: "Top-bottom",
    description: "Tables flow top to bottom along their foreign-key relationships, parents above children. Suits deep hierarchies.",
    Icon: Network,
  },
];

const NAMES: Record<ArrangeKind, string> = { domains: "Domains", LR: "Left-right", pipeline: "Pipeline", snowflake: "Snowflake", compact: "Compact", TB: "Top-bottom" };

const ARRANGE_EVENT = "designdb:auto-arrange";

/** Opens the chooser — or, given an algorithm, straight away its confirmation — above the bottom toolbar. */
export function requestAutoArrange(kind?: ArrangeKind) {
  window.dispatchEvent(new CustomEvent(ARRANGE_EVENT, { detail: { kind } }));
}

const CHOOSER_W = 340;
const CONFIRM_W = 392;

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function AutoArrange({
  anchorRef,
  stage,
  onStageChange,
}: {
  /** the toolbar button both popovers point at */
  anchorRef: React.RefObject<HTMLElement | null>;
  stage: ArrangeStage;
  onStageChange: (s: ArrangeStage) => void;
}) {
  const layout = useLayout();
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // the button's centre / top, and the horizontal span of the canvas the popovers must stay inside
  const [anchor, setAnchor] = useState<{ centre: number; top: number; minX: number; maxX: number } | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const setStage = useRef(onStageChange);
  setStage.current = onStageChange;

  // the rest of the app asks through a window event (it has no handle on the toolbar)
  useEffect(() => {
    const onRequest = (e: Event) => setStage.current(((e as CustomEvent).detail?.kind as ArrangeKind | undefined) ?? "choose");
    window.addEventListener(ARRANGE_EVENT, onRequest);
    return () => window.removeEventListener(ARRANGE_EVENT, onRequest);
  }, []);

  // portaled (the canvas clips its children), so follow the button in window coordinates
  useLayoutEffect(() => {
    if (!stage) {
      setAnchor(null);
      return;
    }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      // in the canvas, not over the code panel / AI chat beside it
      const c = anchorRef.current?.closest(".react-flow")?.getBoundingClientRect();
      setAnchor({ centre: r.left + r.width / 2, top: r.top, minX: c ? c.left : 0, maxX: c ? c.right : window.innerWidth });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [stage, anchorRef]);

  const apply = (kind: ArrangeKind) => {
    onStageChange(null);
    const api = layout.getCanvasApi();
    if (!api) return;
    if (!api.getState().nodes.some((n) => n.type === "tableMode")) {
      showToast("There are no tables to arrange yet", "error");
      return;
    }
    api.autoLayout(kind);
    showToast(`Diagram arranged: ${NAMES[kind]} — Ctrl+Z to undo`, "success");
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // keyboard: 1–6 / ↑ ↓ pick in the chooser, Enter confirms, Esc closes; a click anywhere else closes too
  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      const s = stageRef.current;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // don't also clear the canvas selection
        setStage.current(null);
        return;
      }
      if (s === "choose") {
        if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
        const n = Number(e.key);
        if (n >= 1 && n <= ARRANGE_ALGORITHMS.length) {
          e.preventDefault();
          setStage.current(ARRANGE_ALGORITHMS[n - 1].kind);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
          const at = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length : at) - 1;
          items[next]?.focus();
        }
      } else if (s && e.key === "Enter") {
        if (isEditable(e.target) && !panelRef.current?.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        applyRef.current(s);
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setStage.current(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true); // capture: the canvas stops mousedown from bubbling
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [stage, anchorRef]);

  useEffect(() => {
    if (stage && stage !== "choose") confirmRef.current?.focus();
  }, [stage]);

  if (!stage || !anchor || typeof document === "undefined") return null;
  const vh = window.innerHeight;
  // centred on the button, kept 8px inside the canvas (or the window, when the canvas is narrower than the popover)
  const fit = (want: number) => {
    const roomy = anchor.maxX - anchor.minX >= want + 16;
    const lo = roomy ? anchor.minX : 0;
    const hi = roomy ? anchor.maxX : window.innerWidth;
    const w = Math.min(want, hi - lo - 16);
    return { w, left: Math.min(Math.max(lo + 8, anchor.centre - w / 2), hi - w - 8) };
  };

  if (stage === "choose") {
    const { w, left } = fit(CHOOSER_W);
    return createPortal(
      <div
        ref={panelRef}
        role="menu"
        aria-label="Choose auto arrange algorithm"
        style={{ left, bottom: vh - anchor.top + 8, width: w }}
        className="fixed z-[90] bg-[#0c101b] border border-white/[0.1] rounded-xl shadow-[0_-8px_40px_rgba(0,0,0,0.7)] select-none overflow-hidden"
      >
        <div className="px-4 py-3 text-[13px] font-semibold text-white/90 border-b border-white/[0.07]">Choose auto arrange algorithm</div>
        <div className="py-1">
          {ARRANGE_ALGORITHMS.map((a, i) => (
            <button
              key={a.kind}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              onClick={() => onStageChange(a.kind)}
              className="w-full text-left px-4 py-2.5 flex gap-3 outline-none hover:bg-white/[0.05] focus-visible:bg-white/[0.07] transition-colors"
            >
              <a.Icon size={17} className="mt-[3px] shrink-0 text-white/75" />
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-medium text-white">{a.name}</span>
                  <kbd className="min-w-[20px] h-5 px-1.5 rounded-md bg-white/[0.07] border border-white/[0.14] text-[11px] font-mono text-white/60 flex items-center justify-center">{i + 1}</kbd>
                </span>
                <span className="block mt-1 text-[12px] leading-[1.45] text-white/50">{a.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>,
      document.body
    );
  }

  // confirmation: a solid popover whose arrow points at the arrange button
  const { w, left } = fit(CONFIRM_W);
  const arrowX = Math.min(Math.max(16, anchor.centre - left - 7), w - 30);
  const kind = stage;
  return createPortal(
    <div
      ref={panelRef}
      role="alertdialog"
      aria-labelledby="auto-arrange-confirm-text"
      style={{ left, bottom: vh - anchor.top + 14, width: w }}
      className="fixed z-[90] bg-[#0c101b] border border-white/[0.12] rounded-xl shadow-[0_-8px_40px_rgba(0,0,0,0.7)] px-5 pt-4 pb-4 select-none"
    >
      {/* dbdiagram's wording, minus "you will not be able to undo": here an arrangement is one undo step (the toast says so) */}
      <p id="auto-arrange-confirm-text" className="text-[15px] leading-[1.5] text-white/90">
        Your diagram will be automatically rearranged. Are you sure?
      </p>
      <div className="mt-4 flex justify-end gap-2.5">
        <button
          onClick={() => onStageChange(null)}
          className="h-10 px-4 rounded-md border border-white/[0.16] text-[14px] text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          Cancel (Esc)
        </button>
        <button
          ref={confirmRef}
          onClick={() => apply(kind)}
          title={`Arrange with ${NAMES[kind]}`}
          className="h-10 px-4 rounded-md bg-blue-500 hover:bg-blue-600 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60 transition-colors"
        >
          Confirm (↵)
        </button>
      </div>
      <span
        aria-hidden
        style={{ left: arrowX }}
        className="absolute -bottom-[8px] w-3.5 h-3.5 rotate-45 bg-[#0c101b] border-r border-b border-white/[0.12]"
      />
    </div>,
    document.body
  );
}
