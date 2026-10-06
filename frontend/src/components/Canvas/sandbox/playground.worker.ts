/**
 * The SQL playground's database lives here, off the main thread: building it and running queries never blocks the canvas,
 * and a runaway query can be stopped by terminating the worker (see runtime.ts).
 */
import { buildDatabase, runSql, type SqlJsDatabase, type SqlJsStatic } from "@/lib/sandbox/engine";
import type { WorkerRequest, WorkerResponse } from "./runtime";

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  importScripts(...urls: string[]): void;
  initSqlJs?: (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>;
}

const scope = self as unknown as WorkerScope;
let engine: Promise<SqlJsStatic> | null = null;
let db: SqlJsDatabase | null = null;
let queue: Promise<void> = Promise.resolve();

function sqlJs(): Promise<SqlJsStatic> {
  if (!engine) {
    scope.importScripts("/sql-wasm.js"); // the same sql.js build the app serves from /public
    if (!scope.initSqlJs) throw new Error("sql-wasm.js did not load");
    engine = scope.initSqlJs({ locateFile: () => "/sql-wasm.wasm" }).catch((e) => {
      engine = null; // let the next build try again
      throw e;
    });
  }
  return engine;
}

async function handle(msg: WorkerRequest): Promise<WorkerResponse> {
  try {
    if (msg.type === "build") {
      const SQL = await sqlJs();
      db?.close();
      db = null;
      const built = buildDatabase(SQL, msg.model);
      db = built.db;
      return { id: msg.id, ok: true, report: built.report };
    }
    if (!db) throw new Error("The playground database isn't ready yet.");
    return { id: msg.id, ok: true, outcome: runSql(db, msg.sql, { offset: msg.offset }) };
  } catch (e) {
    return { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// one message at a time, in order — a run posted during a build waits for the database
scope.onmessage = (e) => {
  queue = queue.then(async () => scope.postMessage(await handle(e.data)));
};

export {};
