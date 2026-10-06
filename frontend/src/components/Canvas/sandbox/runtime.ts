/**
 * Where the playground's SQLite database runs. Normally a Web Worker (playground.worker.ts), so building the database and
 * running queries never costs the canvas a frame and a runaway query can be stopped; on the main thread when workers are
 * unavailable. Both run the same engine (lib/sandbox/engine.ts).
 */
import type { DiagramModel } from "@/lib/model/types";
import { buildDatabase, runSql, type BuildReport, type RunOutcome, type SqlJsDatabase, type SqlJsStatic } from "@/lib/sandbox/engine";

export type WorkerRequest = { id: number; type: "build"; model: DiagramModel } | { id: number; type: "run"; sql: string; offset: number };
export type WorkerResponse = { id: number; ok: true; report?: BuildReport; outcome?: RunOutcome } | { id: number; ok: false; error: string };

/** A request abandoned because the engine was restarted (Stop) or disposed. */
export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export interface PlaygroundRuntime {
  readonly kind: "worker" | "inline";
  /** (Re)creates the database from the diagram. */
  build(model: DiagramModel): Promise<BuildReport>;
  /** `offset` shifts error ranges — the position of a run selection inside the editor. */
  run(sql: string, offset?: number): Promise<RunOutcome>;
  /** Abandons whatever is running (restarting the worker) and rebuilds from `model`. */
  restart(model: DiagramModel): Promise<BuildReport>;
  dispose(): void;
}

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };

class WorkerRuntime implements PlaygroundRuntime {
  readonly kind = "worker" as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL("./playground.worker.ts", import.meta.url));
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      p.resolve(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault();
      this.failAll(new Error(e.message || "The SQL engine stopped unexpectedly."));
    };
    return w;
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private call(msg: { type: "build"; model: DiagramModel } | { type: "run"; sql: string; offset: number }): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  async build(model: DiagramModel): Promise<BuildReport> {
    const r = await this.call({ type: "build", model });
    if (!r.ok) throw new Error(r.error);
    return r.report!;
  }

  async run(sql: string, offset = 0): Promise<RunOutcome> {
    const r = await this.call({ type: "run", sql, offset });
    if (!r.ok) throw new Error(r.error);
    return r.outcome!;
  }

  restart(model: DiagramModel): Promise<BuildReport> {
    this.worker.terminate();
    this.failAll(new CancelledError());
    this.worker = this.spawn();
    return this.build(model);
  }

  dispose() {
    this.worker.terminate();
    this.failAll(new CancelledError());
  }
}

let inlineEngine: Promise<SqlJsStatic> | null = null;

function loadSqlJsInline(): Promise<SqlJsStatic> {
  if (!inlineEngine) {
    inlineEngine = new Promise<void>((resolve, reject) => {
      if ((window as any).initSqlJs) return resolve();
      const script = document.createElement("script");
      script.src = "/sql-wasm.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load /sql-wasm.js"));
      document.head.appendChild(script);
    })
      .then(() => (window as any).initSqlJs({ locateFile: () => "/sql-wasm.wasm" }) as Promise<SqlJsStatic>)
      .catch((e) => {
        inlineEngine = null;
        throw e;
      });
  }
  return inlineEngine;
}

/** Main-thread fallback: same engine, no isolation — the engine's row and time limits are the only brakes. */
class InlineRuntime implements PlaygroundRuntime {
  readonly kind = "inline" as const;
  private db: SqlJsDatabase | null = null;

  async build(model: DiagramModel): Promise<BuildReport> {
    const SQL = await loadSqlJsInline();
    this.db?.close();
    const built = buildDatabase(SQL, model);
    this.db = built.db;
    return built.report;
  }

  async run(sql: string, offset = 0): Promise<RunOutcome> {
    if (!this.db) throw new Error("The playground database isn't ready yet.");
    await new Promise((r) => setTimeout(r, 0)); // let "Running…" paint first
    return runSql(this.db, sql, { offset, timeBudgetMs: 5000 });
  }

  restart(model: DiagramModel): Promise<BuildReport> {
    return this.build(model);
  }

  dispose() {
    this.db?.close();
    this.db = null;
  }
}

/** Starts the engine and builds the first database — in a worker when possible, else on the main thread. */
export async function startPlaygroundRuntime(model: DiagramModel): Promise<{ runtime: PlaygroundRuntime; report: BuildReport }> {
  if (typeof Worker !== "undefined") {
    let runtime: WorkerRuntime | null = null;
    try {
      runtime = new WorkerRuntime();
      return { runtime, report: await runtime.build(model) };
    } catch (e) {
      runtime?.dispose();
      console.warn("SQL playground: worker unavailable, running on the main thread —", e);
    }
  }
  const runtime = new InlineRuntime();
  return { runtime, report: await runtime.build(model) };
}
