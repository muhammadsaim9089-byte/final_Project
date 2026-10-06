"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EyeOff, Loader2, Lock } from "lucide-react";
import { DiagramViewer } from "@/components/Viewer/DiagramViewer";
import type { LayoutMap } from "@/lib/share/codec";
import { apiErrorMessage } from "@/lib/apiError";

interface Loaded {
  title: string;
  dbml: string;
  layout?: LayoutMap;
}

/** Published diagram: /share/<slug> — public, password-protected or private (404). */
export default function SharePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [state, setState] = useState<"loading" | "ok" | "password" | "missing" | "error">("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/share/${slug}`);
      const j = await res.json();
      if (res.status === 404) return setState("missing");
      if (!res.ok) throw new Error(apiErrorMessage(j, "Failed to load"));
      if (j.needsPassword) {
        setData({ title: j.title, dbml: "" });
        setState("password");
      } else {
        setData(j);
        setState("ok");
      }
    } catch (e: any) {
      setMessage(e.message);
      setState("error");
    }
  }, [slug]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (data?.title) document.title = `${data.title} — DesignDB`;
  }, [data]);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/share/${slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const j = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(j, "Wrong password"));
      setData(j);
      setState("ok");
    } catch (err: any) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 text-slate-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (state === "ok" && data) {
    return (
      <div className="h-screen w-screen">
        <DiagramViewer dbml={data.dbml} layout={data.layout} title={data.title} theme="light" />
      </div>
    );
  }
  return (
    <div className="h-screen w-screen flex items-center justify-center p-6 bg-slate-50 text-slate-800">
      {state === "password" ? (
        <form onSubmit={unlock} className="w-full max-w-sm p-6 rounded-2xl border border-slate-200 bg-white shadow-xl space-y-4">
          <div className="flex items-center gap-2 font-bold">
            <Lock size={18} className="text-amber-500" /> {data?.title || "Protected diagram"}
          </div>
          <p className="text-xs text-slate-500">The owner requires a password to view this diagram.</p>
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 text-sm outline-none focus:border-blue-500" />
          {message && <p className="text-xs text-red-500">{message}</p>}
          <button disabled={busy || !password} className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      ) : state === "missing" ? (
        <div className="text-center max-w-sm">
          <EyeOff className="mx-auto mb-3 text-slate-400" size={28} />
          <h1 className="text-lg font-bold mb-1">Private or missing diagram</h1>
          <p className="text-sm text-slate-500">This link is not public. Ask the owner for access or a new link.</p>
        </div>
      ) : (
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-bold mb-1">Something went wrong</h1>
          <p className="text-sm text-slate-500">{message}</p>
        </div>
      )}
    </div>
  );
}
