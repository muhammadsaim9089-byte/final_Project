"use client";

import { useEffect, useState } from "react";
import { Check, X, AlertCircle, Download, Cloud, Share2, ShieldCheck } from "lucide-react";

export type ToastType = "success" | "error" | "download" | "cloud" | "share" | "validate";

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

const ICON_MAP: Record<ToastType, React.ReactNode> = {
  success: <Check size={14} className="text-lime-green" />,
  error: <AlertCircle size={14} className="text-red-400" />,
  download: <Download size={14} className="text-purple-400" />,
  cloud: <Cloud size={14} className="text-lime-green" />,
  share: <Share2 size={14} className="text-coral-accent" />,
  validate: <ShieldCheck size={14} className="text-sentry-purple" />,
};

const BG_MAP: Record<ToastType, string> = {
  success: "border-lime-green/30 shadow-[0_0_24px_rgba(194,239,78,0.1)]",
  error: "border-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.1)]",
  download: "border-purple-500/30 shadow-[0_0_24px_rgba(124,58,237,0.1)]",
  cloud: "border-lime-green/30 shadow-[0_0_24px_rgba(194,239,78,0.1)]",
  share: "border-coral-accent/30 shadow-[0_0_24px_rgba(255,107,107,0.1)]",
  validate: "border-sentry-purple/30 shadow-[0_0_24px_rgba(106,95,193,0.1)]",
};

// Simple global toast store
let toastListeners: ((toasts: ToastMessage[]) => void)[] = [];
let toastStore: ToastMessage[] = [];

function notify(listeners: ((toasts: ToastMessage[]) => void)[]) {
  listeners.forEach((fn) => fn([...toastStore]));
}

export function showToast(message: string, type: ToastType = "success") {
  const id = Math.random().toString(36).substring(2, 9);
  toastStore = [...toastStore, { id, message, type }];
  notify(toastListeners);

  setTimeout(() => {
    toastStore = toastStore.filter((t) => t.id !== id);
    notify(toastListeners);
  }, 3000);
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setIsVisible(true));
    // Trigger exit animation before removal
    const timer = setTimeout(() => setIsVisible(false), 2600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0A1020]/95 backdrop-blur-xl border transition-all duration-400 ease-out
        ${BG_MAP[toast.type]}
        ${isVisible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"}
      `}
    >
      <div className="p-1.5 rounded-lg bg-white/[0.04]">
        {ICON_MAP[toast.type]}
      </div>
      <span className="text-[12px] text-white/90 font-medium tracking-wide flex-1">
        {toast.message}
      </span>
      <button
        onClick={onDismiss}
        className="p-1 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-white/60 transition-colors"
      >
        <X size={11} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    toastListeners.push(setToasts);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-2.5 pointer-events-auto max-w-xs w-full">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => {
            toastStore = toastStore.filter((t) => t.id !== toast.id);
            notify(toastListeners);
          }}
        />
      ))}
    </div>
  );
}
