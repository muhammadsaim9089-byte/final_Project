/**
 * Reverse-engineer an SQLite database file entirely in the browser using the bundled sql.js (WASM).
 * SQLite keeps the original CREATE statements in sqlite_master, so we feed them to the SQL parser.
 */
import { DiagramModel } from "../model/types";
import { parseSql } from "../sql/parser";

let sqlPromise: Promise<any> | null = null;

export function loadSqlJs(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("sql.js is only available in the browser"));
  if (sqlPromise) return sqlPromise;
  sqlPromise = (async () => {
    if (!(window as any).initSqlJs) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/sql-wasm.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load sql-wasm.js"));
        document.head.appendChild(s);
      });
    }
    return (window as any).initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  })();
  sqlPromise.catch(() => {
    sqlPromise = null;
  });
  return sqlPromise;
}

export interface SqliteImportResult {
  model: DiagramModel;
  warnings: string[];
  tableCount: number;
  rowsRead: number;
}

export async function sqliteBytesToModel(bytes: Uint8Array, opts: { sampleRows?: number } = {}): Promise<SqliteImportResult> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(bytes);
  try {
    const res = db.exec("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name");
    const rows: any[][] = res[0]?.values || [];
    const ddl = rows.map((r) => `${r[2]};`).join("\n");
    const { model, warnings } = parseSql(ddl, "sqlite");
    let rowsRead = 0;
    const limit = opts.sampleRows ?? 0;
    if (limit > 0) {
      for (const t of model.tables) {
        try {
          const q = db.exec(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT ${limit}`);
          if (q[0]) {
            t.records = { columns: q[0].columns, rows: q[0].values.map((r: any[]) => r.map((v) => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "string" ? v : String(v)))) };
            rowsRead += q[0].values.length;
          }
        } catch {
          /* ignore unreadable tables (virtual tables etc.) */
        }
      }
    }
    return { model, warnings, tableCount: model.tables.length, rowsRead };
  } finally {
    db.close();
  }
}
