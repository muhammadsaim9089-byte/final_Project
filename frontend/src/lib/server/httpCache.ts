/**
 * SERVER-ONLY HTTP caching for API responses.
 *
 *   public-static      GET /api/convert (usage text)       public, max-age=300, s-maxage=600, stale-while-revalidate=60 + ETag
 *   public-revalidate  GET /api/share/[slug]               public, max-age=0, must-revalidate + ETag
 *   private            GET /api/projects, /api/projects/x  private, max-age=0, must-revalidate + ETag, Vary: Authorization, Cookie
 *   everything else                                        no-store (set by the route wrapper unless a route chose)
 *
 * A shared diagram is "public" but always revalidated: unpublishing it or adding a password has to take effect at once,
 * and every view is counted — a CDN may keep a copy, but asks the server before each use (an unchanged diagram costs a
 * 304, not a re-download). If-None-Match with a matching ETag gets 304 Not Modified.
 */
import { createHash } from "crypto";

export type HttpCachePolicy = "public-static" | "public-revalidate" | "private";

const CACHE_CONTROL: Record<HttpCachePolicy, string> = {
  "public-static": "public, max-age=300, s-maxage=600, stale-while-revalidate=60",
  "public-revalidate": "public, max-age=0, must-revalidate",
  private: "private, max-age=0, must-revalidate",
};

export const NO_STORE = "no-store";

/** a strong ETag over the exact body bytes */
export function etagOf(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

/** does an If-None-Match header list this ETag (weak comparison, as RFC 9110 asks for If-None-Match)? */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = etag.replace(/^W\//, "");
  return ifNoneMatch.split(",").some((t) => {
    const tag = t.trim().replace(/^W\//, "");
    return tag === "*" || tag === bare;
  });
}

/** A 200 JSON response with caching headers — or 304 Not Modified when the client already has this body. */
export function cachedJson(req: Request, body: string, policy: HttpCachePolicy, opts: { etag?: string; headers?: Record<string, string> } = {}): Response {
  const etag = opts.etag ?? etagOf(body);
  const headers = new Headers(opts.headers);
  headers.set("Cache-Control", CACHE_CONTROL[policy]);
  headers.set("ETag", etag);
  if (policy === "private") headers.set("Vary", "Authorization, Cookie");
  if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", "application/json");
  return new Response(body, { status: 200, headers });
}

/** Secure default: an API response that did not choose a caching policy is never stored. */
export function defaultNoStore(res: Response): Response {
  if (res.headers.has("Cache-Control")) return res;
  try {
    res.headers.set("Cache-Control", NO_STORE);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.set("Cache-Control", NO_STORE);
    return copy;
  }
}
