/**
 * The text to show for a failed API call. Routes answer `{ error: "…" }`; the rate limiter and the AI-busy response
 * answer `{ error: { code, message, retryAfter } }` — this reads both, adding how long to wait.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  const err = (body as { error?: unknown } | null | undefined)?.error;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    const { message, retryAfter } = err as { message: string; retryAfter?: unknown };
    const s = Number(retryAfter);
    return Number.isFinite(s) && s > 0 ? `${message} Try again in ${formatWait(s)}.` : message;
  }
  return fallback;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.ceil(seconds / 3600)} h`;
}
