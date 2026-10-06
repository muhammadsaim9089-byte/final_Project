"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Link2, Loader2, Lock, Share2, Trash2, Code2, EyeOff, AlertTriangle } from "lucide-react";
import { ModalShell, Tabs, btnGhost, btnPrimary, inputCls, labelCls } from "./ModalShell";
import { useDiagramModel } from "./useDiagramModel";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm";
import { buildFragment, embedSnippet } from "@/lib/share/codec";
import { modelToDbml } from "@/lib/dbml/serializer";
import { positionsOf } from "@/lib/model/autoLayout";
import { apiErrorMessage } from "@/lib/apiError";

type TabId = "link" | "embed" | "publish";
type Visibility = "public" | "password" | "private";

interface PublishedInfo {
  slug: string;
  editToken: string;
  visibility: Visibility;
  url: string;
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-[11px]`} />
        <button
          className={btnGhost}
          onClick={() => {
            navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
        </button>
        <a className={btnGhost} href={value} target="_blank" rel="noreferrer" title="Open">
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}

export function ShareModal({ onClose, initialTab }: { onClose: () => void; initialTab?: TabId }) {
  const layout = useLayout();
  const { model } = useDiagramModel();
  const title = layout.projectTitle || "Untitled diagram";
  const dbml = useMemo(() => modelToDbml(model), [model]);
  const [tab, setTab] = useState<TabId>(initialTab || "link");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // ── stateless link ──
  const [withLayout, setWithLayout] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [fragment, setFragment] = useState("");
  const [building, setBuilding] = useState(false);
  useEffect(() => {
    let alive = true;
    if (protect && password.length < 4) {
      setFragment("");
      return;
    }
    setBuilding(true);
    buildFragment({ dbml, layout: withLayout ? positionsOf(model) : undefined, title }, { theme, compress: true, password: protect ? password : undefined })
      .then((f) => alive && setFragment(f))
      .catch(() => alive && setFragment(""))
      .finally(() => alive && setBuilding(false));
    return () => {
      alive = false;
    };
  }, [dbml, model, withLayout, theme, protect, password, title]);
  const viewerUrl = fragment ? `${origin}/embed#${fragment}` : "";
  const editorUrl = fragment ? `${origin}/canvas#${fragment}` : "";
  const tooLong = viewerUrl.length > 8000;

  // ── embed ──
  const [height, setHeight] = useState(600);
  const [width, setWidth] = useState("100%");
  const snippet = viewerUrl ? embedSnippet(viewerUrl, { height, width, title }) : "";
  const [snipCopied, setSnipCopied] = useState(false);

  // ── publish ──
  const storageKey = `designdb_share:${layout.meta.versionKey}`;
  const [published, setPublished] = useState<PublishedInfo | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [pubPassword, setPubPassword] = useState("");
  const [pubBusy, setPubBusy] = useState(false);
  const [pubError, setPubError] = useState("");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const info = JSON.parse(raw) as PublishedInfo;
        setPublished(info);
        setVisibility(info.visibility);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  const remember = (info: PublishedInfo | null) => {
    setPublished(info);
    try {
      if (info) localStorage.setItem(storageKey, JSON.stringify(info));
      else localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const publish = async () => {
    setPubBusy(true);
    setPubError("");
    try {
      const body: Record<string, unknown> = { title, dbml, layout: positionsOf(model), visibility, password: visibility === "password" ? pubPassword : undefined };
      let res: Response;
      if (published) res = await fetch(`/api/share/${published.slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, editToken: published.editToken }) });
      else res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "Publishing failed"));
      if (published) remember({ ...published, visibility });
      else remember({ slug: data.slug, editToken: data.editToken, visibility, url: data.url });
      showToast(published ? "Published version updated" : "Diagram published", "success");
    } catch (e: any) {
      setPubError(e.message);
    } finally {
      setPubBusy(false);
    }
  };
  const unpublish = async (e: React.MouseEvent<HTMLElement>) => {
    if (!published) return;
    const ok = await confirmAction({
      message: ["You're unpublishing ", { strong: `/share/${published.slug}` }, ". Are you sure?"],
      detail: "Anyone with the link — or a page embedding it — loses access. Publishing again makes a new link.",
      confirmLabel: "Unpublish",
      anchor: e.currentTarget,
    });
    if (!ok) return;
    setPubBusy(true);
    try {
      const res = await fetch(`/api/share/${published.slug}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editToken: published.editToken }) });
      if (!res.ok && res.status !== 403) throw new Error(apiErrorMessage(await res.json().catch(() => ({})), "Could not unpublish"));
      remember(null);
      showToast("Diagram unpublished — the link no longer works", "success");
    } catch (e: any) {
      setPubError(e.message);
    } finally {
      setPubBusy(false);
    }
  };

  return (
    <ModalShell title="Share" subtitle="One-click links, embeds and password-protected sharing — no account needed" icon={<Share2 size={16} />} onClose={onClose} width="max-w-2xl" height="h-[78vh]">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "link", label: "Link", icon: <Link2 size={13} /> },
          { id: "embed", label: "Embed", icon: <Code2 size={13} /> },
          { id: "publish", label: "Publish", icon: <Globe size={13} /> },
        ]}
      />
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        {tab === "link" && (
          <>
            <p className="text-[12px] text-white/50 leading-relaxed">
              The diagram is stored <b className="text-white/70">inside the link itself</b> (DBML-in-Link) — nothing is uploaded, and the link keeps working anywhere DesignDB is hosted. Anyone with the link can view it{protect ? ", but only with the password" : ""}.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={labelCls}>Viewer theme</span>
                <div className="flex rounded-lg border border-white/[0.09] overflow-hidden text-[11px]">
                  {(["dark", "light"] as const).map((t) => (
                    <button key={t} onClick={() => setTheme(t)} className={`flex-1 px-3 py-1.5 font-semibold capitalize ${theme === t ? "bg-[#4A90D9]/25 text-white" : "text-white/50 hover:text-white/80"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-white/70 self-end pb-2 cursor-pointer">
                <input type="checkbox" className="accent-[#4A90D9]" checked={withLayout} onChange={(e) => setWithLayout(e.target.checked)} /> Keep table positions
              </label>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
              <label className="flex items-center gap-2 text-[12px] font-semibold text-white/80 cursor-pointer">
                <input type="checkbox" className="accent-[#4A90D9]" checked={protect} onChange={(e) => setProtect(e.target.checked)} />
                <Lock size={13} className="text-amber-300" /> Protect with a password
              </label>
              {protect && (
                <div>
                  <input type="text" className={inputCls} placeholder="At least 4 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="text-[10px] text-white/35 mt-1.5">The diagram is encrypted in your browser (AES-256-GCM) before it goes into the link. Share the password separately — it can&apos;t be recovered.</p>
                </div>
              )}
            </div>
            {building ? (
              <div className="flex items-center gap-2 text-[12px] text-white/50">
                <Loader2 size={14} className="animate-spin" /> Building link…
              </div>
            ) : fragment ? (
              <div className="space-y-3">
                <CopyRow label="View-only link" value={viewerUrl} />
                <CopyRow label="Open-in-editor link (recipient can edit their own copy)" value={editorUrl} />
                {tooLong && (
                  <p className="flex items-start gap-2 text-[11px] text-amber-300/90">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> This link is {Math.round(viewerUrl.length / 1000)}k characters long. Some chat apps truncate long links — use the Publish tab for large diagrams.
                  </p>
                )}
              </div>
            ) : (
              protect && <p className="text-[12px] text-white/40">Enter a password to generate the encrypted link.</p>
            )}
          </>
        )}

        {tab === "embed" && (
          <>
            <p className="text-[12px] text-white/50 leading-relaxed">Paste this into Notion, Confluence, a blog or your docs. The viewer is interactive: pan, zoom, search tables and highlight relationships.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className={labelCls}>Width</span>
                <input className={inputCls} value={width} onChange={(e) => setWidth(e.target.value)} />
              </div>
              <div>
                <span className={labelCls}>Height (px)</span>
                <input type="number" className={inputCls} value={height} onChange={(e) => setHeight(Math.max(200, Number(e.target.value) || 600))} />
              </div>
            </div>
            {snippet ? (
              <>
                <div>
                  <span className={labelCls}>Embed code</span>
                  <textarea readOnly value={snippet} rows={4} onFocus={(e) => e.target.select()} className={`${inputCls} font-mono text-[11px] resize-none`} />
                  <button
                    className={`${btnGhost} mt-2`}
                    onClick={() => {
                      navigator.clipboard.writeText(snippet);
                      setSnipCopied(true);
                      setTimeout(() => setSnipCopied(false), 1500);
                    }}
                  >
                    {snipCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />} Copy embed code
                  </button>
                </div>
                {!tooLong && <iframe title="Embed preview" src={viewerUrl} className="w-full rounded-xl border border-white/[0.1] bg-black/30" style={{ height: Math.min(height, 420) }} />}
              </>
            ) : (
              <p className="text-[12px] text-white/40">Generate a link on the Link tab first{protect ? " (a password is required)" : ""}.</p>
            )}
          </>
        )}

        {tab === "publish" && (
          <>
            <p className="text-[12px] text-white/50 leading-relaxed">
              Publish a snapshot to <b className="text-white/70">this server</b> for a short, permanent link (<code className="text-[#4A90D9]">/share/xxxx</code>). You choose who can open it, and can update or unpublish it at any time.
            </p>
            <div className="space-y-2">
              {(
                [
                  ["public", "Public", "Anyone with the link can view it.", <Globe key="g" size={15} />],
                  ["password", "Password-protected", "Viewers must enter a password.", <Lock key="l" size={15} />],
                  ["private", "Private", "Nobody can open the link (hidden, but kept so you can re-enable it).", <EyeOff key="e" size={15} />],
                ] as const
              ).map(([id, name, hint, icon]) => (
                <button key={id} onClick={() => setVisibility(id)} className={`w-full flex items-start gap-3 text-left px-3.5 py-2.5 rounded-xl border transition-all ${visibility === id ? "bg-[#4A90D9]/12 border-[#4A90D9]/40" : "bg-white/[0.02] border-white/[0.07] hover:bg-white/[0.05]"}`}>
                  <span className="mt-0.5 text-white/60">{icon}</span>
                  <span>
                    <span className="block text-[12.5px] font-semibold">{name}</span>
                    <span className="block text-[11px] text-white/40">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {visibility === "password" && (
              <div>
                <span className={labelCls}>{published ? "New password (leave empty to keep the current one)" : "Password"}</span>
                <input type="text" className={inputCls} value={pubPassword} onChange={(e) => setPubPassword(e.target.value)} placeholder="At least 4 characters" />
              </div>
            )}
            {pubError && (
              <p className="flex items-center gap-2 text-[12px] text-red-300">
                <AlertTriangle size={13} /> {pubError}
              </p>
            )}
            <div className="flex gap-2">
              <button className={btnPrimary} onClick={publish} disabled={pubBusy || (visibility === "password" && !published && pubPassword.length < 4)}>
                {pubBusy ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} {published ? "Update published diagram" : "Publish diagram"}
              </button>
              {published && (
                <button className={btnGhost} onClick={(e) => void unpublish(e)} disabled={pubBusy}>
                  <Trash2 size={13} /> Unpublish
                </button>
              )}
            </div>
            {published && (
              <div className="space-y-3 pt-1">
                <CopyRow label={`Published link · ${published.visibility}`} value={`${origin}/share/${published.slug}`} />
              </div>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
