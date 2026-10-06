"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { DiagramViewer } from "@/components/Viewer/DiagramViewer";
import { ResolvedShare, SharePayload, resolveFragment } from "@/lib/share/codec";

/**
 * Embeddable read-only viewer (dbdiagram-compatible): /embed#c=<base64 DBML>[&theme=dark]
 * Also understands DesignDB's compressed (pako:) and password-protected (e=) links.
 */
export default function EmbedPage() {
  const [state, setState] = useState<ResolvedShare | { status: "loading" }>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pw?: string) => {
    setBusy(true);
    const r = await resolveFragment(window.location.hash, pw);
    setState(r);
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
    const onHash = () => void load();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [load]);

  useEffect(() => {
    if (state.status === "ok") document.title = `${state.payload.title || "Diagram"} — DesignDB`;
  }, [state]);

  if (state.status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (state.status === "ok") {
    const p: SharePayload = state.payload;
    return (
      <div className="h-screen w-screen">
        <DiagramViewer dbml={p.dbml} layout={p.layout} title={p.title} theme={state.theme} compact />
      </div>
    );
  }

  const dark = state.theme === "dark";
  return (
    <div className={`h-screen w-screen flex items-center justify-center p-6 ${dark ? "bg-[#0b1120] text-white" : "bg-slate-50 text-slate-800"}`}>
      {state.status === "empty" ? (
        <div className="text-center max-w-md">
          <h1 className="text-lg font-bold mb-2">Nothing to show</h1>
          <p className="text-sm opacity-60">This embed URL has no diagram. Use <code className="px-1 rounded bg-black/10">/embed#c=&lt;base64 DBML&gt;</code>, or create a link from DesignDB → Share.</p>
        </div>
      ) : state.status === "error" && state.message !== "Wrong password" ? (
        <div className="text-center max-w-md">
          <h1 className="text-lg font-bold mb-2">This link could not be opened</h1>
          <p className="text-sm opacity-60">{state.message}</p>
        </div>
      ) : (
        <form
          className={`w-full max-w-sm p-6 rounded-2xl border shadow-xl space-y-4 ${dark ? "bg-[#111a2e] border-white/10" : "bg-white border-slate-200"}`}
          onSubmit={(e) => {
            e.preventDefault();
            void load(password);
          }}
        >
          <div className="flex items-center gap-2 font-bold">
            <Lock size={18} className="text-amber-500" /> Password-protected diagram
          </div>
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className={`w-full px-3 py-2 rounded-lg border text-sm outline-none ${dark ? "bg-black/30 border-white/10" : "bg-slate-50 border-slate-300"}`} />
          {state.status === "error" && <p className="text-xs text-red-500">Wrong password — try again.</p>}
          <button disabled={busy || !password} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
            {busy ? "Decrypting…" : "Unlock"}
          </button>
        </form>
      )}
    </div>
  );
}
