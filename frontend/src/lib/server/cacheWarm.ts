/**
 * SERVER-ONLY: fills the hot caches when the server starts (called from src/instrumentation.ts, in the background, so
 * it never delays the server becoming ready). Capped at WARM_TIMEOUT_MS; a failure is logged and otherwise ignored.
 *
 *  - the 20 most-viewed published diagrams (the public share links that get traffic)
 *  - the project lists of the 5 most recently active users (the dashboard's first load)
 *
 * AI results are deliberately not warmed: each would be a paid Groq call on every restart.
 */
import { db } from "@/lib/db";
import { cacheDisabled } from "./cache";
import { cacheShare, loadProjectList } from "./cachedData";

const WARM_TIMEOUT_MS = 10_000;

export async function warmCaches(opts: { timeoutMs?: number } = {}): Promise<void> {
  if (cacheDisabled()) return;
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? WARM_TIMEOUT_MS;
  const work = (async () => {
    const shares = await db.sharedDiagram.findMany({ where: { visibility: { in: ["public", "password"] } }, orderBy: { views: "desc" }, take: 20 });
    for (const row of shares) cacheShare(row);
    const recent = await db.project.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { userId: true } });
    const users = Array.from(new Set(recent.map((p) => p.userId))).slice(0, 5);
    for (const userId of users) await loadProjectList(userId);
    return { shares: shares.length, projectLists: users.length };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const warmed = await Promise.race([work, timeout]);
    console.info(JSON.stringify({ event: "cache.warmed", ms: Date.now() - started, ...warmed }));
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.warm_failed", ms: Date.now() - started, message: String((e as Error)?.message || e) }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
