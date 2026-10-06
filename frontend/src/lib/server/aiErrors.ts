/**
 * SERVER-ONLY: turns the AI provider's own rate-limit refusals into a clean "busy, retry later" response.
 *
 * Groq answers 429 when the account's request or token budget is used up, and 413 when a single request would not
 * fit the tokens-per-minute budget. Its message names the Groq organization and plan, so it must never reach the
 * customer: they get a 503 with Retry-After instead, and the details go to the server log.
 */
export function upstreamAiBusy(e: unknown): Response | null {
  const err = e as { status?: number; headers?: Headers | Record<string, string>; message?: string };
  if (err?.status !== 429 && err?.status !== 413 && err?.status !== 503) return null;
  const h = err.headers;
  const raw = h && typeof (h as Headers).get === "function" ? (h as Headers).get("retry-after") : (h as Record<string, string> | undefined)?.["retry-after"];
  const n = Number(raw);
  const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : 30;
  console.warn(JSON.stringify({ event: "ai.upstream_busy", status: err.status, retryAfter, message: String(err.message || "").slice(0, 300) }));
  return new Response(
    JSON.stringify({ error: { code: "AI_BUSY", message: "The AI service is busy right now.", retryAfter } }),
    { status: 503, headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) } }
  );
}
