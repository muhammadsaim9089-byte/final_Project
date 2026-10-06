"use client";

import { useEffect, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import { useLayout, type ProjectTab, type SaveStatus } from "@/components/Layout/LayoutContext";
import { saveSignature } from "@/lib/projects";
import { defaultMeta, type ProjectMeta } from "@/lib/model/types";
import { showToast } from "@/components/ui/toast";
import { apiErrorMessage } from "@/lib/apiError";

/**
 * Saving lives in the editor, where the work happens (the dashboard only lists and manages saved projects):
 *
 *   • a diagram that was never saved shows "Not saved" and a Save button — the first save is a deliberate act;
 *   • once it has been saved, every change is saved automatically 1.6 s after the last edit ("Saving…" → "Saved");
 *   • switching tabs or leaving the editor saves what is pending; closing the browser tab warns if anything is unsaved;
 *   • Ctrl+S / the Save button save right away (and also keep a snapshot in version history).
 *
 * "Changed" means the saveSignature differs from the tab's `savedSig` — the fingerprint of what was last saved or opened
 * — so selecting, hovering or re-measuring tables never counts as an edit, and a tab keeps its unsaved state across
 * tab switches. Every status is recorded against a tab id: a save that finishes after you switched tabs (or after the
 * editor unmounted) updates its own diagram, never the one on screen.
 */
const AUTOSAVE_MS = 1600;
const untitled = (t: string | undefined) => (t || "").trim() || "Untitled Schema";
const isSavedId = (id: string | null | undefined) => !!id && !id.startsWith("new-") && id !== "default";

interface Graph {
  id?: string;
  title: string;
  nodes: Node[];
  edges: Edge[];
  meta: ProjectMeta;
}

async function postSave(g: Graph, keepalive = false): Promise<{ id: string; title: string }> {
  const res = await fetch("/api/projects/save", {
    method: "POST",
    keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: g.id || undefined, title: g.title, nodes: g.nodes, edges: g.edges, meta: g.meta }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.project?.id) throw new Error(apiErrorMessage(data, `the server answered ${res.status}`));
  return { id: data.project.id, title: data.project.title };
}

export function useProjectSave({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  const layout = useLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const inFlight = useRef<string | null>(null); // the tab being saved
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutosave = () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null;
  };
  const status = (tabId: string, s: SaveStatus) => layoutRef.current.setSaveStatus(s, tabId);
  const tabById = (id: string): ProjectTab | undefined => layoutRef.current.tabs.find((t) => t.id === id);
  const currentGraph = (): Graph => {
    const l = layoutRef.current;
    return { id: isSavedId(l.currentProjectId) ? l.currentProjectId! : undefined, title: untitled(l.projectTitle), nodes: nodesRef.current, edges: edgesRef.current, meta: l.meta };
  };

  const saveRef = useRef<(o?: { explicit?: boolean; keepalive?: boolean }) => Promise<boolean>>(async () => false);

  // ── compare what is on the canvas with what was saved; schedule an autosave when a saved project changed ──
  const evaluate = () => {
    const l = layoutRef.current;
    const tabId = l.activeTabId;
    if (inFlight.current === tabId) return; // re-evaluated when that save finishes
    const g = currentGraph();
    if (!g.id) {
      clearAutosave();
      status(tabId, { state: g.nodes.length ? "unsaved" : "empty", savedAt: null });
      return;
    }
    const tab = tabById(tabId);
    if (!tab) return;
    const sig = saveSignature(g.nodes, g.edges, g.meta, g.title);
    if (tab.savedSig === undefined) {
      // just opened: this is the saved state
      l.setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, savedSig: sig } : t)));
      status(tabId, { state: "saved", savedAt: tab.savedAt ?? null });
      return;
    }
    if (tab.savedSig === sig) {
      clearAutosave();
      status(tabId, { state: "saved", savedAt: tab.savedAt ?? null });
      return;
    }
    if (l.getSaveStatus(tabId)?.state !== "error") status(tabId, { state: "dirty", savedAt: tab.savedAt ?? null });
    clearAutosave();
    // only ever autosaves *this* tab's project: switch tabs meanwhile and it doesn't fire on the other one
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      const now = layoutRef.current;
      if (now.activeTabId === tabId && isSavedId(now.currentProjectId)) void saveRef.current();
    }, AUTOSAVE_MS);
  };
  const evaluateRef = useRef(evaluate);
  evaluateRef.current = evaluate;

  saveRef.current = async ({ explicit = false, keepalive = false } = {}) => {
    clearAutosave();
    const l = layoutRef.current;
    const tabId = l.activeTabId;
    const g = currentGraph();
    if (!g.id && !explicit) return false; // the first save is always your call, never an autosave
    if (!g.nodes.length && !g.id) {
      if (explicit) showToast("Nothing to save yet — add a table first", "error");
      return false;
    }
    if (inFlight.current) return false; // one save at a time; the one running re-evaluates when it ends
    const sig = saveSignature(g.nodes, g.edges, g.meta, g.title);
    const firstSave = !g.id;
    inFlight.current = tabId;
    status(tabId, { state: "saving", savedAt: tabById(tabId)?.savedAt ?? null });
    try {
      const saved = await postSave(g, keepalive);
      const now = Date.now();
      const lNow = layoutRef.current;
      if (saved.id !== tabId && lNow.activeTabId === tabId) lNow.setCurrentProjectId(saved.id); // the tab takes the project's id
      lNow.setTabs((ts) => ts.map((t) => (t.id === tabId || t.id === saved.id ? { ...t, id: saved.id, savedSig: sig, savedAt: now } : t)));
      status(saved.id, { state: "saved", savedAt: now });
      if (explicit) void lNow.getCanvasApi()?.saveVersion("save", "Saved");
      if (firstSave) showToast(`Saved “${g.title}” — it's on your dashboard now, and changes save automatically`, "cloud");
      return true;
    } catch (e: any) {
      status(tabId, { state: "error", savedAt: tabById(tabId)?.savedAt ?? null, error: e?.message || "Save failed" });
      if (explicit) showToast(`Save failed: ${e?.message || "unknown error"}`, "error");
      return false;
    } finally {
      inFlight.current = null;
      // edits made while the request was on its way
      setTimeout(() => evaluateRef.current(), 0);
    }
  };

  // Ctrl+S, the save button and the DesignDB menu reach this through the layout
  useEffect(() => {
    layout.registerSaveHandler((opts) => saveRef.current({ explicit: opts?.explicit ?? true }));
    return () => layout.registerSaveHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabSig = layout.tabs.find((t) => t.id === layout.activeTabId)?.savedSig;
  useEffect(() => {
    const t = setTimeout(() => evaluateRef.current(), 400);
    return () => clearTimeout(t);
  }, [nodes, edges, layout.meta, layout.projectTitle, layout.activeTabId, layout.currentProjectId, tabSig]);

  // leaving a tab: save it in the background if it had unsaved changes (its diagram was just stored in the tab)
  const prevTabRef = useRef(layout.activeTabId);
  useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = layout.activeTabId;
    if (!prev || prev === layout.activeTabId) return;
    clearAutosave(); // that tab's pending autosave is replaced by the background save below
    setTimeout(() => {
      const tab = tabById(prev);
      if (!tab || !isSavedId(tab.id) || tab.savedSig === undefined) return; // gone (renamed on first save), or never saved
      const meta = tab.meta ?? defaultMeta();
      const sig = saveSignature(tab.nodes, tab.edges, meta, untitled(tab.title));
      if (sig === tab.savedSig) return;
      status(prev, { state: "saving", savedAt: tab.savedAt ?? null });
      postSave({ id: tab.id, title: untitled(tab.title), nodes: tab.nodes, edges: tab.edges, meta })
        .then(() => {
          const now = Date.now();
          layoutRef.current.setTabs((ts) => ts.map((t) => (t.id === prev ? { ...t, savedSig: sig, savedAt: now } : t)));
          status(prev, { state: "saved", savedAt: now });
        })
        .catch((e) => {
          status(prev, { state: "error", savedAt: tab.savedAt ?? null, error: e?.message || "Save failed" });
          showToast(`Couldn't save “${untitled(tab.title)}” — switch back to it and press Ctrl+S`, "error");
        });
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.activeTabId]);

  // leaving the editor (e.g. for the dashboard): save pending changes; closing the browser tab: warn
  useEffect(() => {
    const pending = () => {
      const l = layoutRef.current;
      const st = l.getSaveStatus(l.activeTabId)?.state;
      const otherNew = l.tabs.some((t) => t.id !== l.activeTabId && !isSavedId(t.id) && (t.nodes?.length ?? 0) > 0);
      return st === "dirty" || st === "saving" || st === "error" || st === "unsaved" || otherNew;
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const l = layoutRef.current;
      if (l.getSaveStatus(l.activeTabId)?.state === "dirty") void saveRef.current({ keepalive: true });
      if (!pending()) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearAutosave();
      const l = layoutRef.current;
      const tab = tabById(l.activeTabId);
      const g = currentGraph();
      if (g.id && tab?.savedSig !== undefined && saveSignature(g.nodes, g.edges, g.meta, g.title) !== tab?.savedSig) void saveRef.current({ keepalive: true });
      // (a new, never-saved diagram stays in its tab — it is still there when you come back to the editor)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
