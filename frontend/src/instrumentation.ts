/**
 * Runs once when a Next.js server starts (Next 14: enabled by `experimental.instrumentationHook` in next.config.mjs).
 * Warms the server caches in the background — the server is ready without waiting for it.
 *
 * Next also compiles this file for the edge runtime: the Node-only import must sit inside the
 * `NEXT_RUNTIME === "nodejs"` block, which the edge build drops as dead code (an early `return` does not).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return; // no warm-up while `next build` collects pages
    setTimeout(() => {
      import("./lib/server/cacheWarm")
        .then((m) => m.warmCaches())
        .catch((e) => console.warn(JSON.stringify({ event: "cache.warm_failed", message: String(e?.message || e) })));
    }, 0);
  }
}
