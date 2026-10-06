"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessagePart } from "@/lib/model/deletion";

/**
 * One confirmation for every destructive action in the app ("You're deleting table customers. Are you sure?").
 * Given the button that was clicked it opens as a popover pointing at that button; without one (keyboard Delete) it is a
 * small centred dialog. Enter confirms, Esc cancels — a click anywhere else cancels too.
 *
 *   if (!(await confirmAction({ message: [...], anchor: e.currentTarget }))) return;
 *
 * Mounted once (ConfirmHost in AppLayout); only one confirmation is open at a time — asking again answers the previous
 * one with "no".
 */
export interface ConfirmOptions {
  message: MessagePart[] | string;
  /** second, quieter line (what goes with it, which columns…) */
  detail?: string;
  /** e.g. "Ctrl+Z undoes it." or "This can't be undone." */
  note?: string;
  confirmLabel?: string;
  /** the clicked control, or its rectangle — the popover points at it */
  anchor?: Element | DOMRect | null;
}

interface Pending extends ConfirmOptions {
  id: number;
  rect: DOMRect | null;
  resolve: (ok: boolean) => void;
}

let current: Pending | null = null;
let listener: ((p: Pending | null) => void) | null = null;
let seq = 0;

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  current?.resolve(false);
  return new Promise((resolve) => {
    const rect = opts.anchor instanceof Element ? opts.anchor.getBoundingClientRect() : opts.anchor ?? null;
    const p: Pending = {
      ...opts,
      id: ++seq,
      rect: rect && rect.width + rect.height > 0 ? rect : null,
      resolve: (ok) => {
        if (current?.id === p.id) {
          current = null;
          listener?.(null);
        }
        resolve(ok);
      },
    };
    current = p;
    if (listener) listener(p);
    else resolve(window.confirm(typeof opts.message === "string" ? opts.message : opts.message.map((m) => (typeof m === "string" ? m : m.strong)).join(""))); // host not mounted
  });
}

const W = 380;
const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; arrowX: number; below: boolean } | null>(null);

  useEffect(() => {
    listener = setPending;
    if (current) setPending(current);
    return () => {
      if (listener === setPending) listener = null;
    };
  }, []);

  // popover placement: centred on the anchor, above it (below when there is no room), inside the window
  useLayoutEffect(() => {
    if (!pending?.rect) {
      setBox(null);
      return;
    }
    const r = pending.rect;
    const h = boxRef.current?.offsetHeight || 150;
    const w = Math.min(W, window.innerWidth - 16);
    const centre = r.left + r.width / 2;
    const left = Math.min(Math.max(8, centre - w / 2), window.innerWidth - w - 8);
    const below = r.top - h - 14 < 8;
    const top = below ? Math.min(r.bottom + 14, window.innerHeight - h - 8) : r.top - h - 14;
    setBox({ left, top, arrowX: Math.min(Math.max(16, centre - left - 7), w - 30), below });
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // don't also close the drawer / clear the selection behind it
        pending.resolve(false);
      } else if (e.key === "Enter" && !(isEditable(e.target) && !boxRef.current?.contains(e.target as Node))) {
        e.preventDefault();
        e.stopPropagation();
        pending.resolve(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) pending.resolve(false);
    };
    // A click inside the confirmation is not an "outside click" for whatever opened it (the AI chat's history list, a
    // menu…): stopped at the window, before any document-level outside-click handler sees it. Clicks still work —
    // only propagation of pointerdown / mousedown is stopped, not the click itself.
    const shield = (e: Event) => {
      if (boxRef.current?.contains(e.target as Node)) e.stopPropagation();
    };
    window.addEventListener("pointerdown", shield, true);
    window.addEventListener("mousedown", shield, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("pointerdown", shield, true);
      window.removeEventListener("mousedown", shield, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [pending]);

  if (!pending || typeof document === "undefined") return null;
  const parts = typeof pending.message === "string" ? [pending.message] : pending.message;
  const anchored = !!pending.rect;

  const card = (
    <div
      ref={boxRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-action-text"
      style={anchored ? { position: "fixed", left: box?.left ?? -9999, top: box?.top ?? -9999, width: Math.min(W, window.innerWidth - 16) } : { width: Math.min(W, window.innerWidth - 32) }}
      className="z-[120] bg-[#0c101b] border border-white/[0.12] rounded-xl shadow-[0_12px_48px_rgba(0,0,0,0.75)] px-5 pt-4 pb-4 select-none text-left"
    >
      <p id="confirm-action-text" className="text-[15px] leading-[1.5] text-white/85">
        {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <b key={i} className="font-semibold text-white">{p.strong}</b>))}
      </p>
      {pending.detail && <p className="mt-1.5 text-[12.5px] leading-snug text-white/50 break-words">{pending.detail}</p>}
      {pending.note && <p className="mt-1 text-[11.5px] text-white/35">{pending.note}</p>}
      <div className="mt-4 flex justify-end gap-2.5">
        <button onClick={() => pending.resolve(false)} className="h-10 px-4 rounded-md border border-white/[0.16] text-[14px] text-white/80 hover:text-white hover:bg-white/[0.06] transition-colors">
          Cancel (Esc)
        </button>
        <button
          ref={confirmRef}
          onClick={() => pending.resolve(true)}
          className="h-10 px-4 rounded-md bg-red-500 hover:bg-red-600 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-red-300/60 transition-colors"
        >
          {pending.confirmLabel || "Delete"} (↵)
        </button>
      </div>
      {anchored && box && (
        <span
          aria-hidden
          style={{ left: box.arrowX }}
          className={`absolute w-3.5 h-3.5 rotate-45 bg-[#0c101b] ${box.below ? "-top-[8px] border-l border-t" : "-bottom-[8px] border-r border-b"} border-white/[0.12]`}
        />
      )}
    </div>
  );

  return createPortal(
    anchored ? card : <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45">{card}</div>,
    document.body
  );
}
