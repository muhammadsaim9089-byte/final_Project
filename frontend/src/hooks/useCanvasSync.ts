"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Connection, Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { useLayout, CanvasApi, ApplyModelOptions } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { AttrData, canvasToModel, isDepEdge, isTableNode, modelSignature, modelToCanvas } from "@/lib/model/canvasAdapter";
import { migrateLegacyGroups } from "@/lib/model/displayGraph";
import { DEFAULT_LAYOUT, LayoutKind, layoutNodes } from "@/lib/layout";
import { mergeModels } from "@/lib/model/merge";
import { DiagramModel, ProjectMeta, defaultMeta, tableKeyOf } from "@/lib/model/types";
import { modelToDbml } from "@/lib/dbml/serializer";
import { parseDbml } from "@/lib/dbml/parser";
import { modelToSql } from "@/lib/sql/exporter";
import { SqlDialect, dialectFromDbmlName, isSqlDialect } from "@/lib/sql/dialects";
import { importText } from "@/lib/import";
import { resolveFragment } from "@/lib/share/codec";
import { applyPositions } from "@/lib/model/autoLayout";
import { VersionKind, listVersions, saveVersion as storeVersion } from "@/lib/versions/store";
import { modelStats } from "@/lib/model/diff";

interface Params {
  nodes: Node[];
  edges: Edge[];
  setNodes: (n: Node[] | ((n: Node[]) => Node[])) => void;
  setEdges: (e: Edge[] | ((e: Edge[]) => Edge[])) => void;
  takeSnapshot: (o?: { nodes?: Node[]; edges?: Edge[]; meta?: ProjectMeta }) => void;
  resetHistory: () => void;
  rfInstance: ReactFlowInstance | null;
  sqlDialect: string;
  setSqlDialect: (d: string) => void;
  layoutDirection: "LR" | "TB";
  edgeStyle: "crowsFoot" | "pulseMode";
  detailsLevel: "all" | "keys" | "headers";
  generatedSql: string;
  generatedMermaid: string;
  setGeneratedSql: (s: string) => void;
}

/** Cheap "did the schema structurally change?" counter — ignores positions, selection and measurements. */
function useStructureVersion(nodes: Node[], edges: Edge[], meta: unknown): number {
  const ref = useRef<{ n: Map<string, unknown>; nt: Map<string, string | undefined>; e: Map<string, unknown[]>; meta: unknown; version: number } | null>(null);
  const prev = ref.current;
  let changed = !prev;
  if (prev) {
    if (prev.meta !== meta || prev.n.size !== nodes.length || prev.e.size !== edges.length) changed = true;
    else {
      for (const n of nodes) {
        if (prev.n.get(n.id) !== n.data || prev.nt.get(n.id) !== n.type) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        for (const e of edges) {
          const p = prev.e.get(e.id);
          if (!p || p[0] !== e.data || p[1] !== e.source || p[2] !== e.target || p[3] !== e.type) {
            changed = true;
            break;
          }
        }
      }
    }
  }
  if (changed) {
    ref.current = {
      n: new Map(nodes.map((n) => [n.id, n.data])),
      nt: new Map(nodes.map((n) => [n.id, n.type])),
      e: new Map(edges.map((e) => [e.id, [e.data, e.source, e.target, e.type]])),
      meta,
      version: (prev?.version ?? 0) + 1,
    };
  }
  return ref.current!.version;
}

// Shared across project tabs so tables can be copied from one diagram and pasted into another.
let sharedClipboard: { nodes: Node[]; edges: Edge[]; groups: ProjectMeta["groups"]; at: number } | null = null;

const singular = (s: string) => s.replace(/ies$/i, "y").replace(/s$/i, "");

export function useCanvasSync(p: Params) {
  const layout = useLayout();
  const { nodes, edges, setNodes, setEdges, takeSnapshot, resetHistory } = p;
  const meta = layout.meta;

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const metaRef = useRef(meta);
  const dbmlRef = useRef(layout.dbmlText);
  const paramsRef = useRef(p);
  const layoutRef = useRef(layout);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  metaRef.current = meta;
  dbmlRef.current = layout.dbmlText;
  paramsRef.current = p;
  layoutRef.current = layout;

  const lastSigRef = useRef<string>("");
  const lastVersionSigRef = useRef<string>("");
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const structVersion = useStructureVersion(nodes, edges, meta);

  /** Fits the viewport once React Flow has measured the (visible) nodes — fitting earlier would use stale sizes. */
  const fit = useCallback((delay = 120) => {
    const started = Date.now();
    const sizeSig = (rf: ReactFlowInstance) =>
      rf
        .getNodes()
        .filter((n) => !n.hidden)
        .map((n) => `${n.id}:${Math.round(n.measured?.width ?? 0)}x${Math.round(n.measured?.height ?? 0)}`)
        .join("|");
    const attempt = () => {
      const rf = paramsRef.current.rfInstance;
      if (!rf) return;
      const visible = rf.getNodes().filter((n) => !n.hidden);
      // React Flow only knows a node's size after its ResizeObserver fired — fitting earlier would use stale bounds
      const measured = visible.every((n) => (n.measured?.width ?? 0) > 0 && (n.measured?.height ?? 0) > 0);
      if (visible.length === 0 || measured || Date.now() - started > 3000) {
        rf.fitView({ duration: 450, padding: 0.12 });
        // node contents can still settle after the first measurement (fonts, images) — refit once if they did
        const first = sizeSig(rf);
        setTimeout(() => {
          const again = paramsRef.current.rfInstance;
          if (again && sizeSig(again) !== first) again.fitView({ duration: 300, padding: 0.12 });
        }, 700);
      } else setTimeout(attempt, 50);
    };
    setTimeout(attempt, delay);
  }, []);

  // ───────────────────────── loading a graph into the canvas ─────────────────────────

  /** Puts a graph on the canvas (tab switch, project load, restore, import) and refreshes the DBML text. */
  const loadGraph = useCallback(
    (g: { nodes: Node[]; edges: Edge[]; meta?: Partial<ProjectMeta> | null; dbml?: string }, opts: { fit?: boolean; snapshot?: boolean; reset?: boolean } = {}) => {
      const migrated = migrateLegacyGroups(g.nodes || [], g.meta);
      const stateNodes = migrated.nodes.filter((n) => !n.id.startsWith("grp:"));
      const nextMeta = migrated.meta;
      setNodes(stateNodes);
      setEdges(g.edges || []);
      layoutRef.current.setMeta(nextMeta);
      const model = canvasToModel(stateNodes, g.edges || [], nextMeta);
      lastSigRef.current = modelSignature(model);
      layoutRef.current.setDbmlText(g.dbml && g.dbml.trim() ? g.dbml : modelToDbml(model));
      layoutRef.current.setDbmlDiagnostics([]);
      const dialect = dialectFromDbmlName(nextMeta.project.databaseType);
      if (dialect && dialect !== paramsRef.current.sqlDialect) paramsRef.current.setSqlDialect(dialect);
      if (opts.reset) resetHistory();
      if (opts.snapshot) takeSnapshot({ nodes: stateNodes, edges: g.edges || [], meta: nextMeta });
      if (opts.fit) fit();
    },
    [setNodes, setEdges, resetHistory, takeSnapshot, fit]
  );

  // ───────────────────────── tab switching (nodes + edges + meta + DBML) ─────────────────────────
  const prevTabRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = layout.activeTabId;
    if (currentId === prevTabRef.current) return;
    // saving renames the tab (unsaved id → project id); that is not a switch, keep what is on the canvas
    const rename = layoutRef.current.tabRenameRef.current;
    if (rename && rename.to === currentId && rename.from === prevTabRef.current) {
      layoutRef.current.tabRenameRef.current = null;
      prevTabRef.current = currentId;
      return;
    }
    const prevId = prevTabRef.current;
    if (prevId) {
      const snapshot = { nodes: nodesRef.current, edges: edgesRef.current, meta: metaRef.current, dbml: dbmlRef.current, sql: paramsRef.current.generatedSql, mmd: paramsRef.current.generatedMermaid };
      layoutRef.current.setTabs((tabs) => tabs.map((t) => (t.id === prevId ? { ...t, nodes: snapshot.nodes, edges: snapshot.edges, generatedSql: snapshot.sql, generatedMermaid: snapshot.mmd, meta: snapshot.meta, dbml: snapshot.dbml } : t)));
    }
    const tab = layoutRef.current.tabs.find((t) => t.id === currentId);
    if (tab) {
      loadGraph({ nodes: tab.nodes || [], edges: tab.edges || [], meta: tab.meta ?? defaultMeta(), dbml: tab.dbml }, { reset: true, fit: (tab.nodes || []).length > 0 });
      paramsRef.current.setGeneratedSql(tab.generatedSql || "");
      lastVersionSigRef.current = "";
    }
    prevTabRef.current = currentId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.activeTabId]);

  // leaving the editor (the dashboard is its own page): keep the canvas in its tab — the tabs outlive this component,
  // so coming back shows the diagram exactly as it was, saved or not
  useEffect(
    () => () => {
      const id = prevTabRef.current;
      if (!id) return;
      const snap = { nodes: nodesRef.current, edges: edgesRef.current, meta: metaRef.current, dbml: dbmlRef.current, sql: paramsRef.current.generatedSql, mmd: paramsRef.current.generatedMermaid };
      layoutRef.current.setTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, nodes: snap.nodes, edges: snap.edges, meta: snap.meta, dbml: snap.dbml, generatedSql: snap.sql, generatedMermaid: snap.mmd } : t)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // remember the newest stored snapshot of this diagram so identical auto-saves are skipped
  useEffect(() => {
    let alive = true;
    listVersions(meta.versionKey).then((v) => {
      if (alive && v[0]) lastVersionSigRef.current = v[0].sig;
    });
    return () => {
      alive = false;
    };
  }, [meta.versionKey]);

  // ───────────────────────── canvas → DBML text ─────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      const model = canvasToModel(nodesRef.current, edgesRef.current, metaRef.current);
      const sig = modelSignature(model);
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
      layoutRef.current.setDbmlText(modelToDbml(model));
    }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structVersion]);

  // ───────────────────────── canvas → SQL text ─────────────────────────
  useEffect(() => {
    if (nodesRef.current.filter(isTableNode).length === 0) return;
    const t = setTimeout(() => {
      try {
        const model = canvasToModel(nodesRef.current, edgesRef.current, metaRef.current);
        const dialect: SqlDialect = isSqlDialect(paramsRef.current.sqlDialect) ? paramsRef.current.sqlDialect : "postgres";
        const sql = modelToSql(model, { dialect });
        paramsRef.current.setGeneratedSql(sql);
        layoutRef.current.setGeneratedSql(sql);
      } catch (e) {
        console.warn("Failed to generate SQL locally:", e);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structVersion, p.sqlDialect]);

  // ───────────────────────── DBML text → canvas ─────────────────────────
  const applyDbmlText = useCallback(
    (text: string) => {
      if (editTimer.current) clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => {
        const { model, diagnostics, ok } = parseDbml(text);
        layoutRef.current.setDbmlDiagnostics(diagnostics);
        if (!ok) return; // keep the last valid diagram while there are syntax errors
        const res = modelToCanvas(model, { prevNodes: nodesRef.current, prevEdges: edgesRef.current, prevMeta: metaRef.current, edgeType: paramsRef.current.edgeStyle });
        let outNodes = res.nodes;
        if (res.newNodeIds.length) outNodes = layoutNodes(outNodes, res.edges, paramsRef.current.layoutDirection, new Set(res.newNodeIds));
        lastSigRef.current = modelSignature(canvasToModel(outNodes, res.edges, res.meta));
        setNodes(outNodes);
        setEdges(res.edges);
        layoutRef.current.setMeta(res.meta);
        takeSnapshot({ nodes: outNodes, edges: res.edges, meta: res.meta });
        const dialect = dialectFromDbmlName(res.meta.project.databaseType);
        if (dialect && dialect !== paramsRef.current.sqlDialect) paramsRef.current.setSqlDialect(dialect);
        if (res.newNodeIds.length && nodesRef.current.length === 0) fit();
      }, 550);
    },
    [setNodes, setEdges, takeSnapshot, fit]
  );
  useEffect(() => {
    layout.registerDbmlEditHandler(applyDbmlText);
    return () => {
      if (editTimer.current) clearTimeout(editTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyDbmlText]);

  // ───────────────────────── apply an arbitrary model (import, templates, AI, restore) ─────────────────────────
  const saveVersion = useCallback(async (kind: VersionKind, label?: string) => {
    const tables = nodesRef.current.filter(isTableNode);
    if (!tables.length && kind !== "manual") return;
    const model = canvasToModel(nodesRef.current, edgesRef.current, metaRef.current);
    const sig = modelSignature(model);
    const rec = await storeVersion({ key: metaRef.current.versionKey, kind, label, nodes: nodesRef.current, edges: edgesRef.current, meta: metaRef.current, sig, stats: modelStats(model) }, { force: kind === "manual" });
    if (rec) lastVersionSigRef.current = sig;
  }, []);

  const applyModel = useCallback(
    (model: DiagramModel, opts: ApplyModelOptions = {}): { tables: number } => {
      const mode = opts.mode || "replace";
      const layoutMode = opts.layout || "auto";
      if (opts.restorePoint) void saveVersion("restore-point", opts.restorePoint);
      const prevNodes = nodesRef.current;
      let source = model;
      if (mode === "merge") {
        const cur = canvasToModel(prevNodes, edgesRef.current, metaRef.current);
        const merged = mergeModels(cur, model);
        source = merged.model;
        if (merged.skippedTables.length) showToast(`Skipped ${merged.skippedTables.length} table(s) that already exist`, "validate");
      }
      const keepPositions = mode === "merge" || layoutMode === "keep";
      const res = modelToCanvas(source, {
        prevNodes: keepPositions ? prevNodes : [],
        prevEdges: keepPositions ? edgesRef.current : [],
        prevMeta: metaRef.current,
        edgeType: paramsRef.current.edgeStyle,
      });
      let outNodes = res.nodes;
      if (layoutMode === "auto" && mode === "replace") outNodes = layoutNodes(outNodes, res.edges, paramsRef.current.layoutDirection === "TB" ? "TB" : DEFAULT_LAYOUT);
      else if (res.newNodeIds.length) outNodes = layoutNodes(outNodes, res.edges, paramsRef.current.layoutDirection, new Set(res.newNodeIds));
      const finalModel = canvasToModel(outNodes, res.edges, res.meta);
      lastSigRef.current = modelSignature(finalModel);
      setNodes(outNodes);
      setEdges(res.edges);
      layoutRef.current.setMeta(res.meta);
      layoutRef.current.setDbmlText(modelToDbml(finalModel));
      layoutRef.current.setDbmlDiagnostics([]);
      takeSnapshot({ nodes: outNodes, edges: res.edges, meta: res.meta });
      const dialect = dialectFromDbmlName(res.meta.project.databaseType);
      if (dialect && dialect !== paramsRef.current.sqlDialect) paramsRef.current.setSqlDialect(dialect);
      if (opts.fit !== false) fit();
      return { tables: res.nodes.filter(isTableNode).length };
    },
    [saveVersion, setNodes, setEdges, takeSnapshot, fit]
  );

  // ───────────────────────── the API tools use ─────────────────────────
  const focusTable = useCallback((nameOrId: string) => {
    const rf = paramsRef.current.rfInstance;
    const n = nodesRef.current.find((x) => x.id === nameOrId) || nodesRef.current.find((x) => isTableNode(x) && ((x.data as any).label === nameOrId || tableKeyOf({ schema: (x.data as any).schema, name: (x.data as any).label }) === nameOrId));
    if (!n || !rf) return;
    const w = (n as any).measured?.width || 250;
    const h = (n as any).measured?.height || 200;
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1.05, duration: 700 });
    setNodes((nds) => nds.map((x) => (x.id === n.id ? { ...x, selected: true, data: { ...x.data, spotlightActive: true } } : { ...x, selected: false })));
    setTimeout(() => setNodes((nds) => nds.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, spotlightActive: false } } : x))), 2500);
  }, [setNodes]);

  // "here's what the AI just built": a coloured border + New/Mod badge on the affected tables, cleared after a few seconds
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTables = useCallback((statusByKey: Record<string, "added" | "modified">) => {
    if (!Object.keys(statusByKey).length) return;
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    setNodes((nds) =>
      nds.map((n) => {
        if (!isTableNode(n)) return n;
        const status = statusByKey[tableKeyOf({ schema: (n.data as any).schema, name: (n.data as any).label })];
        return status ? { ...n, data: { ...n.data, diffStatus: status } } : n;
      })
    );
    highlightTimerRef.current = setTimeout(() => {
      setNodes((nds) => nds.map((n) => (isTableNode(n) && (n.data as any).diffStatus ? { ...n, data: { ...n.data, diffStatus: undefined } } : n)));
      highlightTimerRef.current = null;
    }, 4500);
  }, [setNodes]);

  const api: CanvasApi = useMemo(
    () => ({
      getState: () => ({ nodes: nodesRef.current, edges: edgesRef.current, meta: metaRef.current }),
      getModel: () => canvasToModel(nodesRef.current, edgesRef.current, metaRef.current),
      setGraph: (g, o) => {
        if (o?.version) void saveVersion(o.version, "Before change");
        loadGraph({ nodes: g.nodes, edges: g.edges, meta: g.meta ?? metaRef.current }, { fit: o?.fit, snapshot: true });
      },
      applyModel,
      focusTable,
      fitView: () => fit(0),
      autoLayout: (kind: LayoutKind = paramsRef.current.layoutDirection === "TB" ? "TB" : DEFAULT_LAYOUT) => {
        // the arrangement being replaced must itself be an undo step — a diagram that was just opened may not have one
        takeSnapshot({ nodes: nodesRef.current, edges: edgesRef.current });
        const laid = layoutNodes(nodesRef.current, edgesRef.current, kind);
        setNodes(laid);
        takeSnapshot({ nodes: laid, edges: edgesRef.current });
        fit(120);
      },
      snapshot: (override) => takeSnapshot(override),
      saveVersion,
      restoreGraph: (g) => {
        void saveVersion("restore-point", "Before restore");
        loadGraph({ nodes: g.nodes, edges: g.edges, meta: g.meta }, { fit: true, snapshot: true });
      },
      getSvgOptions: () => ({ detail: paramsRef.current.detailsLevel, showRelationships: metaRef.current.showRelationships }),
      getSqlDialect: () => paramsRef.current.sqlDialect,
      setSqlDialect: (d) => paramsRef.current.setSqlDialect(d),
      highlightTables,
    }),
    [applyModel, focusTable, fit, loadGraph, saveVersion, setNodes, takeSnapshot, highlightTables]
  );
  useEffect(() => {
    layout.registerCanvasApi(api);
    return () => layout.registerCanvasApi(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // ───────────────────────── automatic version snapshots ─────────────────────────
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!nodesRef.current.some(isTableNode)) return;
      const model = canvasToModel(nodesRef.current, edgesRef.current, metaRef.current);
      const sig = modelSignature(model);
      if (sig === lastVersionSigRef.current) return;
      await saveVersion("auto");
    }, 45_000);
    return () => clearTimeout(t);
  }, [structVersion, saveVersion]);

  // ───────────────────────── relationships by dragging column → column ─────────────────────────
  const createRelationship = useCallback(
    (conn: Connection) => {
      const cur = nodesRef.current;
      const colOf = (h?: string | null) => (h && h.startsWith("c:") ? h.slice(2, h.lastIndexOf(":")) : undefined);
      let src = cur.find((n) => n.id === conn.source);
      let tgt = cur.find((n) => n.id === conn.target);
      if (!src || !tgt || !isTableNode(src) || !isTableNode(tgt)) return;
      let sCol = colOf(conn.sourceHandle);
      let tCol = colOf(conn.targetHandle);
      if (src.id === tgt.id && sCol === tCol) return;
      const attrs = (n: Node) => (((n.data as any).attributes as AttrData[]) || []);
      const isKey = (n: Node, c?: string) => !!c && attrs(n).some((a) => a.name === c && (a.isPk || a.unique));
      // the referenced ("one") side is the key column — swap when the user dragged the other way round
      if (isKey(tgt, tCol) && !isKey(src, sCol)) [src, tgt, sCol, tCol] = [tgt, src, tCol, sCol];
      const parent = src;
      const child = tgt;
      const pAttrs = attrs(parent);
      if (!sCol) sCol = pAttrs.find((a) => a.isPk)?.name || pAttrs[0]?.name;
      if (!sCol) {
        showToast("The parent table has no columns to reference", "error");
        return;
      }
      const pCol = pAttrs.find((a) => a.name === sCol);
      let newChildAttrs = attrs(child);
      let childCol = tCol;
      if (!childCol) {
        const wanted = `${singular(String((parent.data as any).label))}_${sCol}`;
        const existing = newChildAttrs.find((a) => a.name === wanted);
        childCol = existing ? existing.name : wanted;
      }
      const exists = edgesRef.current.some((e) => !isDepEdge(e) && e.source === parent.id && e.target === child.id && ((e.data as any)?.targetColumn || (e.data as any)?.foreignKey) === childCol);
      if (exists) {
        showToast("That relationship already exists", "validate");
        return;
      }
      const cAttr = newChildAttrs.find((a) => a.name === childCol);
      if (!cAttr) newChildAttrs = [...newChildAttrs, { name: childCol, type: pCol?.type || "integer", isPk: false, isFk: true, allowNull: true }];
      newChildAttrs = newChildAttrs.map((a) => (a.name === childCol ? { ...a, isFk: true, fkRefTable: String((parent.data as any).label), fkRefField: sCol, fkRelationType: "Many to One" } : a));
      const nextNodes = cur.map((n) => (n.id === child.id ? { ...n, data: { ...n.data, attributes: newChildAttrs } } : n));
      const edge: Edge = {
        id: `e_${parent.id}_${child.id}_${childCol}_${Date.now().toString(36)}`,
        source: parent.id,
        target: child.id,
        type: paramsRef.current.edgeStyle,
        data: {
          kind: "ref",
          relationshipType: cAttr?.unique || cAttr?.isPk ? "one-to-one" : "one-to-many",
          foreignKey: childCol,
          referencedKey: sCol,
          sourceColumn: sCol,
          targetColumn: childCol,
          onDelete: "NO ACTION",
          onUpdate: "CASCADE",
        },
      };
      const nextEdges = [...edgesRef.current, edge];
      setNodes(nextNodes);
      setEdges(nextEdges);
      takeSnapshot({ nodes: nextNodes, edges: nextEdges });
      showToast(`Relationship created: ${(child.data as any).label}.${childCol} → ${(parent.data as any).label}.${sCol}`, "success");
    },
    [setNodes, setEdges, takeSnapshot]
  );

  // ───────────────────────── copy / paste tables (also between diagrams) ─────────────────────────
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || !!el.closest?.(".cm-editor") || el.isContentEditable);
    };
    const onKey = async (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "c" || k === "x") {
        const selected = nodesRef.current.filter((n) => n.selected && isTableNode(n));
        if (!selected.length) return;
        e.preventDefault();
        const ids = new Set(selected.map((n) => n.id));
        const internal = edgesRef.current.filter((ed) => ids.has(ed.source) && ids.has(ed.target));
        const groups: ProjectMeta["groups"] = {};
        for (const n of selected) {
          const g = (n.data as any).group;
          if (g && metaRef.current.groups[g]) groups[g] = metaRef.current.groups[g];
        }
        sharedClipboard = { nodes: JSON.parse(JSON.stringify(selected)), edges: JSON.parse(JSON.stringify(internal)), groups, at: Date.now() };
        try {
          const sub = canvasToModel(selected, internal, { ...metaRef.current, groups: {}, views: [], enums: metaRef.current.enums });
          await navigator.clipboard.writeText(modelToDbml(sub));
        } catch {
          /* clipboard permission denied — the in-app clipboard still works */
        }
        showToast(`${k === "x" ? "Cut" : "Copied"} ${selected.length} table${selected.length > 1 ? "s" : ""} — paste into any diagram`, "success");
        if (k === "x") {
          const rm = new Set(ids);
          const nn = nodesRef.current.filter((n) => !rm.has(n.id));
          const ee = edgesRef.current.filter((ed) => !rm.has(ed.source) && !rm.has(ed.target));
          setNodes(nn);
          setEdges(ee);
          takeSnapshot({ nodes: nn, edges: ee });
        }
      } else if (k === "v") {
        e.preventDefault();
        if (sharedClipboard) {
          const clip = sharedClipboard;
          const cur = nodesRef.current;
          const usedLabels = new Set(cur.filter(isTableNode).map((n) => String((n.data as any).label)));
          const idMap = new Map<string, string>();
          const rf = paramsRef.current.rfInstance;
          const minX = Math.min(...clip.nodes.map((n) => n.position.x));
          const minY = Math.min(...clip.nodes.map((n) => n.position.y));
          const el = document.querySelector(".react-flow") as HTMLElement | null;
          const center = rf && el ? rf.screenToFlowPosition({ x: el.getBoundingClientRect().left + el.clientWidth / 2, y: el.getBoundingClientRect().top + el.clientHeight / 2 }) : { x: minX + 60, y: minY + 60 };
          const labelMap = new Map<string, string>();
          const pasted = clip.nodes.map((n) => {
            const id = `tbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
            idMap.set(n.id, id);
            let label = String((n.data as any).label);
            const original = label;
            if (usedLabels.has(label)) {
              let i = 1;
              while (usedLabels.has(`${original}_copy${i > 1 ? i : ""}`)) i++;
              label = `${original}_copy${i > 1 ? i : ""}`;
            }
            usedLabels.add(label);
            labelMap.set(original, label);
            return { ...n, id, selected: true, position: { x: center.x - 100 + (n.position.x - minX), y: center.y - 60 + (n.position.y - minY) }, data: { ...n.data, label } } as Node;
          });
          // re-point FK helpers (fkRefTable) at renamed copies inside the pasted set
          const fixed = pasted.map((n) => ({ ...n, data: { ...n.data, attributes: ((n.data as any).attributes || []).map((a: AttrData) => (a.fkRefTable && labelMap.has(a.fkRefTable) ? { ...a, fkRefTable: labelMap.get(a.fkRefTable) } : a)) } }));
          const pastedEdges = clip.edges.map((ed) => ({ ...ed, id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, source: idMap.get(ed.source)!, target: idMap.get(ed.target)! }));
          const nn = [...cur.map((n) => ({ ...n, selected: false })), ...fixed];
          const ee = [...edgesRef.current, ...pastedEdges];
          setNodes(nn);
          setEdges(ee);
          const missing = Object.entries(clip.groups).filter(([g]) => !metaRef.current.groups[g]);
          if (missing.length) layoutRef.current.setMeta((m) => ({ ...m, groups: { ...m.groups, ...Object.fromEntries(missing) } }));
          takeSnapshot({ nodes: nn, edges: ee });
          showToast(`Pasted ${fixed.length} table${fixed.length > 1 ? "s" : ""}`, "success");
          return;
        }
        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) return;
          const r = importText(text, "auto");
          if (r.errors.length || !r.model.tables.length) return;
          applyModel(r.model, { mode: "merge", layout: "keep", fit: false });
          showToast(`Pasted ${r.model.tables.length} table(s) from the clipboard`, "success");
        } catch {
          /* no clipboard access */
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyModel, setNodes, setEdges, takeSnapshot]);

  // ───────────────────────── open a shared link (…/canvas#c=…) ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!/[#&](c|e)=/.test(hash)) return;
    let cancelled = false;
    (async () => {
      let r = await resolveFragment(hash);
      let attempts = 0;
      while (!cancelled && (r.status === "needs-password" || (r.status === "error" && r.message === "Wrong password")) && attempts < 3) {
        const pw = window.prompt(r.status === "error" ? "Wrong password — try again:" : "This diagram is password-protected. Enter the password:");
        if (pw === null) return;
        r = await resolveFragment(hash, pw);
        attempts++;
      }
      if (cancelled) return;
      if (r.status !== "ok") {
        if (r.status === "error") showToast(r.message, "error");
        return;
      }
      const { model } = parseDbml(r.payload.dbml);
      applyPositions(model, r.payload.layout);
      const empty = !nodesRef.current.some(isTableNode);
      if (!empty) layoutRef.current.addTab(r.payload.title || "Shared diagram");
      // wait for the tab switch to settle before loading
      setTimeout(() => {
        applyModel(model, { mode: "replace", layout: model.tables.some((t) => t.x === undefined) ? "auto" : "keep", fit: true });
        if (r.payload.title) layoutRef.current.setProjectTitle(r.payload.title);
        window.history.replaceState(null, "", window.location.pathname);
        showToast(`Opened shared diagram${r.payload.title ? ` “${r.payload.title}”` : ""}`, "success");
      }, empty ? 50 : 400);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { structVersion, applyModel, loadGraph, createRelationship, focusTable, saveVersion };
}
