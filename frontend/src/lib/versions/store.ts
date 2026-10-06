/**
 * Version history store — snapshots of {nodes, edges, meta} kept in IndexedDB (falls back to memory
 * when IndexedDB is unavailable, e.g. private windows). Powers dbdiagram "Version History" and
 * ERDLab "Restore to any point / Preview changes".
 */
import type { Edge, Node } from "@xyflow/react";
import type { ProjectMeta } from "../model/types";

export type VersionKind = "auto" | "manual" | "save" | "restore-point" | "import" | "ai";

export interface VersionRecord {
  id: string;
  /** stable per-diagram key (meta.versionKey) */
  key: string;
  createdAt: number;
  label: string;
  kind: VersionKind;
  nodes: Node[];
  edges: Edge[];
  meta: ProjectMeta;
  /** fingerprint of the schema content — identical consecutive snapshots are skipped */
  sig: string;
  stats: { tables: number; columns: number; refs: number };
}

export type NewVersion = Omit<VersionRecord, "id" | "createdAt" | "label"> & { label?: string };

const DB_NAME = "designdb-versions";
const STORE = "versions";
export const MAX_AUTO_VERSIONS = 40;

const memory = new Map<string, VersionRecord>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("key", "key", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      })
  );
}

const newId = () => `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export async function listVersions(key: string): Promise<VersionRecord[]> {
  const db = await openDb();
  let rows: VersionRecord[];
  if (!db) rows = [...memory.values()].filter((v) => v.key === key);
  else rows = ((await tx<VersionRecord[]>("readonly", (s) => s.index("key").getAll(key))) || []) as VersionRecord[];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getVersion(id: string): Promise<VersionRecord | undefined> {
  const db = await openDb();
  if (!db) return memory.get(id);
  return (await tx<VersionRecord>("readonly", (s) => s.get(id))) || undefined;
}

async function put(rec: VersionRecord): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(rec.id, rec);
    return;
  }
  await tx("readwrite", (s) => s.put(rec));
}

/** Saves a snapshot. Returns null when it would duplicate the latest one (unless `force`). */
export async function saveVersion(v: NewVersion, opts: { force?: boolean } = {}): Promise<VersionRecord | null> {
  const existing = await listVersions(v.key);
  if (!opts.force && existing[0] && existing[0].sig === v.sig) return null;
  const rec: VersionRecord = {
    ...v,
    id: newId(),
    createdAt: Date.now(),
    label: v.label || defaultLabel(v.kind),
    // structured clone strips React Flow internals we do not want to persist
    nodes: JSON.parse(JSON.stringify(v.nodes)),
    edges: JSON.parse(JSON.stringify(v.edges)),
    meta: JSON.parse(JSON.stringify(v.meta)),
  };
  await put(rec);
  await pruneVersions(v.key);
  return rec;
}

export function defaultLabel(kind: VersionKind): string {
  switch (kind) {
    case "manual":
      return "Manual snapshot";
    case "save":
      return "Saved";
    case "restore-point":
      return "Before restore";
    case "import":
      return "Before import";
    case "ai":
      return "Before AI change";
    default:
      return "Auto-saved";
  }
}

export async function deleteVersion(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.delete(id);
    return;
  }
  await tx("readwrite", (s) => s.delete(id));
}

export async function renameVersion(id: string, label: string): Promise<void> {
  const v = await getVersion(id);
  if (!v) return;
  await put({ ...v, label: label.trim() || v.label, kind: v.kind === "auto" ? "manual" : v.kind });
}

export async function clearVersions(key: string): Promise<void> {
  const rows = await listVersions(key);
  for (const r of rows) await deleteVersion(r.id);
}

/** Keeps every named snapshot and the newest MAX_AUTO_VERSIONS automatic ones. */
export async function pruneVersions(key: string): Promise<void> {
  const rows = await listVersions(key);
  const autos = rows.filter((r) => r.kind === "auto");
  for (const r of autos.slice(MAX_AUTO_VERSIONS)) await deleteVersion(r.id);
}
