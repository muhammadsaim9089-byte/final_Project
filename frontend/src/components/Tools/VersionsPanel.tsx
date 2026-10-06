"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Copy, History, Loader2, Pencil, RotateCcw, Trash2, X, Eye } from "lucide-react";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm";
import { VersionRecord, deleteVersion, listVersions, renameVersion } from "@/lib/versions/store";
import { newVersionKey } from "@/lib/model/types";

function ago(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

const KIND_STYLE: Record<string, string> = {
  manual: "bg-[#4A90D9]/15 text-[#7ec8ff] border-[#4A90D9]/30",
  save: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  auto: "bg-white/[0.05] text-white/45 border-white/[0.08]",
  "restore-point": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  import: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  ai: "bg-pink-500/15 text-pink-300 border-pink-500/30",
};

function getSchemaStats(v: VersionRecord): { tables: number; cols: number } {
  if (v.stats) {
    return { tables: v.stats.tables, cols: v.stats.columns };
  }
  const tables = (v.nodes || []).filter((n) => n.type === "tableMode");
  const cols = tables.reduce((acc, n) => acc + (((n.data as any)?.attributes as any[])?.length || 0), 0);
  return { tables: tables.length, cols };
}

function groupVersionsByDate(versions: VersionRecord[]): { group: string; items: VersionRecord[] }[] {
  const groups: { [key: string]: VersionRecord[] } = {};
  const order: string[] = [];

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - 6 * 86400000;

  for (const v of versions) {
    let key: string;
    if (v.createdAt >= startOfToday) {
      key = "TODAY";
    } else if (v.createdAt >= startOfYesterday) {
      key = "YESTERDAY";
    } else if (v.createdAt >= startOfWeek) {
      key = "PREVIOUS 7 DAYS";
    } else {
      key = "EARLIER";
    }

    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(v);
  }

  return order.map((key) => ({ group: key, items: groups[key] }));
}

export function VersionsPanel({ onClose }: { onClose: () => void }) {
  const layout = useLayout();
  const api = layout.getCanvasApi();
  const key = layout.meta.versionKey;
  const [versions, setVersions] = useState<VersionRecord[] | null>(null);
  const [label, setLabel] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [saving, setSaving] = useState(false);

  const previewId = layout.previewVersion?.id || null;

  const refresh = useCallback(async () => {
    const list = await listVersions(key);
    setVersions(list);
  }, [key]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const handleClose = useCallback(() => {
    if (layout.previewVersion) {
      layout.setPreviewVersion(null);
    }
    onClose();
  }, [layout, onClose]);

  // Clean up preview if panel unmounts while preview is active
  useEffect(() => {
    return () => {
      if (layoutRef.current.previewVersion) {
        layoutRef.current.setPreviewVersion(null);
      }
    };
  }, []);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (renaming) {
          setRenaming(null);
          return;
        }
        handleClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renaming, handleClose]);

  const saveNow = async () => {
    if (!api) return;
    setSaving(true);
    await api.saveVersion("manual", label.trim() || undefined);
    setLabel("");
    await refresh();
    setSaving(false);
    showToast("Snapshot saved", "success");
  };

  const handleRowClick = (v: VersionRecord) => {
    if (renaming === v.id) return;
    if (previewId === v.id) {
      // Toggle off preview -> return to working state
      layout.setPreviewVersion(null);
    } else {
      // Inject this version directly into the main React Flow canvas
      layout.setPreviewVersion(v);
    }
  };

  const restore = (v: VersionRecord) => {
    if (!api) return;
    api.restoreGraph({ nodes: v.nodes, edges: v.edges, meta: v.meta });
    layout.setPreviewVersion(null);
    showToast(`Restored “${v.label}”`, "success");
    onClose();
  };

  const duplicate = (v: VersionRecord) => {
    layout.addTab(`${layout.projectTitle} (${new Date(v.createdAt).toLocaleDateString()})`, {
      nodes: v.nodes,
      edges: v.edges,
      meta: { ...v.meta, versionKey: newVersionKey() },
    });
    layout.setPreviewVersion(null);
    showToast("Forked version into a new project tab", "success");
    onClose();
  };

  const remove = async (v: VersionRecord, anchor: Element) => {
    const ok = await confirmAction({
      message: ["You're deleting version ", { strong: v.label }, ". Are you sure?"],
      detail: `Saved ${new Date(v.createdAt).toLocaleString()}`,
      note: "A deleted version can't be restored.",
      anchor,
    });
    if (!ok) return;
    await deleteVersion(v.id);
    if (layout.previewVersion?.id === v.id) {
      layout.setPreviewVersion(null);
    }
    await refresh();
    showToast("Version deleted", "validate");
  };

  const commitRename = async (v: VersionRecord) => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== v.label) {
      await renameVersion(v.id, trimmed);
      if (layout.previewVersion?.id === v.id) {
        layout.setPreviewVersion({ ...layout.previewVersion, label: trimmed });
      }
    }
    setRenaming(null);
    await refresh();
  };

  const grouped = useMemo(() => (versions ? groupVersionsByDate(versions) : []), [versions]);

  return (
    // Docked inside the editor's canvas column, like the Inspect and audit drawers: below the top bar (a window-fixed
    // drawer slid under the navbar and tab row, hiding its own header), solid, and the minimap / preview banner keep
    // clear of it (Canvas counts it in `rightDrawerW`).
    <aside
      aria-label="Version history"
      className="absolute right-0 top-0 bottom-0 z-40 w-96 max-w-full flex flex-col bg-[#0b1020] border-l border-white/[0.08] shadow-[-24px_0_60px_rgba(0,0,0,0.45)] select-none animate-in slide-in-from-right duration-200"
    >
      {/* Drawer Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#4A90D9]/25 to-[#8B5CF6]/15 border border-[#4A90D9]/30 text-[#7ec8ff]">
            <History size={17} />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-white leading-tight">Version history</h2>
            <p className="text-[11.5px] text-white/45 truncate">
              {versions === null ? "Loading…" : `${versions.length} snapshot${versions.length === 1 ? "" : "s"} · click one to preview it on the canvas`}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 -mr-1 shrink-0 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors"
            aria-label="Close version history"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Snapshot Creator */}
      <div className="shrink-0 px-4 py-3 border-b border-white/[0.07]">
        <div className="flex gap-2">
          <input
            className="flex-1 min-w-0 h-9 bg-white/[0.04] border border-white/[0.09] rounded-lg px-3 text-[12.5px] text-white placeholder:text-white/30 outline-none focus:border-[#4A90D9]/60 transition-colors"
            placeholder="Name this snapshot (optional)"
            aria-label="Snapshot name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveNow()}
          />
          <button
            className="h-9 px-3.5 shrink-0 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[#4A90D9] to-[#2563eb] text-white text-[12.5px] font-semibold shadow-[0_2px_10px_rgba(74,144,217,0.3)] hover:shadow-[0_4px_16px_rgba(74,144,217,0.4)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={saveNow}
            disabled={saving || !api}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Save snapshot
          </button>
        </div>
      </div>

      {/* Compact Snapshot List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-scrollbar">
        {versions === null ? (
          <div className="p-8 text-center text-white/40 text-sm">
            <Loader2 className="mx-auto mb-2 animate-spin text-[#4A90D9]" size={18} /> Loading versions…
          </div>
        ) : versions.length === 0 ? (
          <div className="p-8 text-center text-white/40 text-sm">
            <History size={28} className="mx-auto mb-3 text-white/15" />
            <p className="text-[13.5px] font-semibold text-white/75">No snapshots yet</p>
            <p className="mt-1 text-[12px] leading-relaxed">Save one above — or just keep working: DesignDB also records one automatically as the diagram changes, when you save, and before imports, AI changes and restores.</p>
          </div>
        ) : (
          <div>
            {grouped.map(({ group, items }) => (
              <div key={group}>
                {/* Sticky Group Header */}
                <div className="sticky top-0 z-10 bg-[#0b1020] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/45 border-y border-white/[0.06] flex items-center justify-between">
                  <span>{group}</span>
                  <span className="font-mono text-white/30 text-[9px]">{items.length}</span>
                </div>

                <ul className="divide-y divide-white/[0.04]">
                  {items.map((v) => {
                    const isPreviewing = previewId === v.id;
                    const stats = getSchemaStats(v);
                    const isLatest = versions[0]?.id === v.id;

                    return (
                      <li
                        key={v.id}
                        className={`group relative transition-all duration-150 cursor-pointer ${
                          isPreviewing
                            ? "bg-[#4A90D9]/15 border-l-2 border-l-[#4A90D9]"
                            : "hover:bg-white/[0.035] border-l-2 border-l-transparent"
                        }`}
                        onClick={() => handleRowClick(v)}
                      >
                        <div className="px-3.5 py-2.5 flex items-center justify-between gap-2.5 min-h-[52px]">
                          {/* Left: Title + Timestamp + Schema Stats */}
                          <div className="min-w-0 flex-1">
                            {renaming === v.id ? (
                              <div className="flex items-center gap-1.5 my-0.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  autoFocus
                                  className="flex-1 bg-white/[0.08] border border-[#4A90D9]/60 rounded px-2 py-1 text-xs text-white outline-none"
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitRename(v);
                                    else if (e.key === "Escape") setRenaming(null);
                                  }}
                                />
                                <button
                                  className="p-1 text-emerald-400 hover:text-emerald-300 rounded hover:bg-white/[0.06]"
                                  onClick={() => commitRename(v)}
                                  title="Save name"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  className="p-1 text-white/50 hover:text-white rounded hover:bg-white/[0.06]"
                                  onClick={() => setRenaming(null)}
                                  title="Cancel"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {isPreviewing && (
                                  <span className="flex h-2 w-2 relative shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4A90D9] opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4A90D9]"></span>
                                  </span>
                                )}
                                <span className={`text-[12px] font-semibold truncate ${isPreviewing ? "text-white font-bold" : "text-white/90"}`} title={v.label}>
                                  {v.label}
                                </span>
                              </div>
                            )}

                            {/* Subtitle: Timestamp and Schema Stats */}
                            <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-white/40">
                              <span title={new Date(v.createdAt).toLocaleString()} className="shrink-0">
                                {ago(v.createdAt)}
                              </span>
                              <span className="text-white/20">•</span>
                              <span className="font-mono truncate">
                                {stats.tables} tables • {stats.cols} cols
                              </span>
                            </div>
                          </div>

                          {/* Right: Default badge vs Hover inline action buttons */}
                          <div className="relative shrink-0 flex items-center justify-end h-7">
                            {/* Normal status badge (hidden when row is hovered) */}
                            <div className="flex items-center gap-1.5 group-hover:opacity-0 group-focus-within:opacity-0 transition-opacity pointer-events-none">
                              {isPreviewing ? (
                                <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border bg-[#4A90D9]/25 text-[#7ec8ff] border-[#4A90D9]/40 flex items-center gap-1">
                                  <Eye size={10} /> Previewing
                                </span>
                              ) : (
                                <span
                                  className={`text-[8.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border ${
                                    isLatest ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : KIND_STYLE[v.kind] || KIND_STYLE.auto
                                  }`}
                                >
                                  {isLatest ? "latest" : v.kind.replace("-", " ")}
                                </span>
                              )}
                            </div>

                            {/* Hover inline icon buttons: Restore, Duplicate/Fork, Rename, Delete */}
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity bg-[#0b1020] pl-1 rounded-lg">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  restore(v);
                                }}
                                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
                                title="Restore this version"
                                aria-label="Restore this version"
                              >
                                <RotateCcw size={13} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicate(v);
                                }}
                                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
                                title="Duplicate / Fork into new project tab"
                                aria-label="Duplicate / Fork"
                              >
                                <Copy size={13} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenaming(v.id);
                                  setRenameValue(v.label);
                                }}
                                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
                                title="Rename snapshot"
                                aria-label="Rename"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void remove(v, e.currentTarget);
                                }}
                                className="p-1.5 rounded-md text-white/60 hover:text-red-400 hover:bg-red-500/15 transition-colors"
                                title="Delete snapshot"
                                aria-label="Delete snapshot"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
