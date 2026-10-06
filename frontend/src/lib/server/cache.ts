/**
 * SERVER-ONLY in-memory caching: one TTL + LRU cache per domain, with hit / miss / eviction counters.
 *
 * Keys are namespaced `cache:<domain>:<id>` (the same scheme a Redis layer would use). Values are kept as ready-to-send
 * strings where possible, so a hit costs no JSON parsing or serialising, and nobody can mutate a shared object.
 *
 *   projects  list + single-project response bodies   5 min   invalidated on save / rename / duplicate / delete
 *   shares    published diagram rows + public bodies    5 min   write-through on update, deleted on unpublish
 *   compute   /api/convert and /api/audit results       30 min  pure functions of the request body
 *   ai        /api/generate results for a new diagram   24 h    keyed by prompt + prompt version; `fresh: true` skips
 *
 * Memory is this server process's (kept on globalThis so every route bundle and dev hot reloads share it). Invalidation
 * is exact for one process — like SQLite and the rate limiter. With several instances, move this to Redis or set
 * CACHE_DISABLED=true, or one instance can serve another's stale copy until the TTL runs out.
 * Cache failures never fail a request: callers fall through to the database / the computation.
 */
import { createHash } from "crypto";

export interface CacheStats {
  name: string;
  size: number;
  max: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export interface CacheOptions<V> {
  /** entry limit (LRU eviction beyond it) */
  max?: number;
  ttlMs: number;
  /** total size budget across entries, measured by sizeOf (LRU eviction beyond it) */
  maxBytes?: number;
  /** a single entry larger than this is not cached */
  maxEntryBytes?: number;
  sizeOf?: (value: V) => number;
  now?: () => number;
}

export function cacheDisabled(): boolean {
  return process.env.CACHE_DISABLED === "true";
}

export class TtlLruCache<V> {
  private map = new Map<string, { value: V; expires: number; bytes: number }>();
  private inflight = new Map<string, Promise<V | undefined>>();
  private bytes = 0;
  /** bumped by every invalidation: a load that started before it must not store what it read */
  private epoch = 0;
  hits = 0;
  misses = 0;
  evictions = 0;

  constructor(
    readonly name: string,
    private readonly opts: CacheOptions<V>
  ) {}

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private drop(key: string) {
    const e = this.map.get(key);
    if (!e) return false;
    this.bytes -= e.bytes;
    this.map.delete(key);
    return true;
  }

  get(key: string): V | undefined {
    const e = cacheDisabled() ? undefined : this.map.get(key);
    if (!e || e.expires <= this.now()) {
      if (e) this.drop(key);
      this.misses++;
      return undefined;
    }
    // most recently used goes to the end of the Map's insertion order
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.value;
  }

  set(key: string, value: V, ttlMs = this.opts.ttlMs): void {
    if (cacheDisabled()) return;
    const bytes = this.opts.sizeOf ? this.opts.sizeOf(value) : 0;
    this.drop(key);
    if (this.opts.maxEntryBytes && bytes > this.opts.maxEntryBytes) return;
    this.map.set(key, { value, expires: this.now() + ttlMs, bytes });
    this.bytes += bytes;
    const max = this.opts.max ?? 1000;
    while (this.map.size > max || (this.opts.maxBytes && this.bytes > this.opts.maxBytes && this.map.size > 1)) {
      const oldest = this.map.keys().next().value as string;
      this.drop(oldest);
      this.evictions++;
    }
  }

  // Invalidation also bumps the epoch and forgets in-flight loads, so a read that began before a write can neither
  // store its (now old) result nor hand it to requests that arrive after the write.
  delete(key: string): boolean {
    this.epoch++;
    this.inflight.delete(key);
    return this.drop(key);
  }

  /** bulk invalidation, e.g. every `cache:projects:list:` entry */
  deleteByPrefix(prefix: string): number {
    this.epoch++;
    for (const k of Array.from(this.inflight.keys())) if (k.startsWith(prefix)) this.inflight.delete(k);
    let n = 0;
    for (const k of Array.from(this.map.keys())) if (k.startsWith(prefix) && this.drop(k)) n++;
    return n;
  }

  clear(): void {
    this.epoch++;
    this.inflight.clear();
    this.map.clear();
    this.bytes = 0;
  }

  /**
   * The cached value, or `load()`'s (cached when it is not undefined). Concurrent misses for one key share a single
   * load, so a burst of identical requests does the work once. `fresh` skips the read but still stores the result.
   */
  async load(key: string, loader: () => Promise<V | undefined>, opts: { fresh?: boolean; ttlMs?: number } = {}): Promise<{ value: V | undefined; hit: boolean }> {
    if (!opts.fresh) {
      const hit = this.get(key);
      if (hit !== undefined) return { value: hit, hit: true };
    }
    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, hit: true };
    const startEpoch = this.epoch;
    const p: Promise<V | undefined> = Promise.resolve()
      .then(loader)
      .then((v) => {
        if (v !== undefined && this.epoch === startEpoch) this.set(key, v, opts.ttlMs);
        return v;
      })
      .finally(() => {
        if (this.inflight.get(key) === p) this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return { value: await p, hit: false };
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      name: this.name,
      size: this.map.size,
      max: this.opts.max ?? 1000,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total ? this.hits / total : 0,
    };
  }
}

// ─── the app's caches ────────────────────────────────────────────────────────────────────────────────────────────────

/** a ready-to-send JSON body and its ETag */
export interface CachedBody {
  body: string;
  etag: string;
}

/** a successful response kept whole */
export interface CachedResponse {
  status: number;
  contentType: string;
  body: string;
}

const MIN = 60_000;
const MB = 1024 * 1024;
const bodySize = (v: { body: string }) => v.body.length;

function createCaches() {
  return {
    projects: new TtlLruCache<CachedBody>("projects", { max: 1000, ttlMs: 5 * MIN, maxBytes: 64 * MB, maxEntryBytes: 16 * MB, sizeOf: bodySize }),
    // values: { row, body, etag } — see lib/server/cachedData
    shares: new TtlLruCache<CachedBody & { row: unknown }>("shares", { max: 1000, ttlMs: 5 * MIN, maxBytes: 64 * MB, maxEntryBytes: 8 * MB, sizeOf: bodySize }),
    compute: new TtlLruCache<CachedResponse>("compute", { max: 500, ttlMs: 30 * MIN, maxBytes: 32 * MB, maxEntryBytes: 2 * MB, sizeOf: bodySize }),
    ai: new TtlLruCache<CachedResponse>("ai", { max: 200, ttlMs: 24 * 60 * MIN, maxBytes: 16 * MB, maxEntryBytes: 1 * MB, sizeOf: bodySize }),
  };
}

const g = globalThis as unknown as { __designdbCaches?: ReturnType<typeof createCaches> };
export const caches = (g.__designdbCaches ??= createCaches());

export function cacheStats(): CacheStats[] {
  return Object.values(caches).map((c) => c.stats());
}

export const cacheKey = {
  project: (id: string) => `cache:projects:item:${id}`,
  projectList: (userId: string) => `cache:projects:list:${userId}`,
  share: (slug: string) => `cache:share:${slug}`,
  convert: (hash: string) => `cache:convert:${hash}`,
  audit: (hash: string) => `cache:audit:${hash}`,
  generate: (hash: string) => `cache:ai:generate:${hash}`,
};

/** after any project write: that project's cached body and every cached project list */
export function invalidateProjects(...ids: (string | undefined | null)[]) {
  try {
    for (const id of ids) if (id) caches.projects.delete(cacheKey.project(id));
    caches.projects.deleteByPrefix("cache:projects:list:");
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.error", op: "invalidateProjects", message: String((e as Error)?.message || e) }));
  }
}

/** a short, stable key for any JSON-serialisable parts */
export function hashKey(...parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 32);
}

/**
 * Serves a computation's response from the cache, or runs it and keeps a 200 answer. `X-Cache: HIT | MISS` says which.
 * Anything that goes wrong with the cache itself falls through to running the computation.
 */
export async function memoResponse(
  cache: TtlLruCache<CachedResponse>,
  key: string,
  produce: () => Promise<Response>,
  opts: { fresh?: boolean } = {}
): Promise<Response> {
  const failed: { res?: Response; error?: unknown } = {};
  let entry: { value: CachedResponse | undefined; hit: boolean };
  try {
    entry = await cache.load(
      key,
      async () => {
        let res: Response;
        try {
          res = await produce();
        } catch (e) {
          failed.error = e; // the computation's own error: rethrown below, never retried
          return undefined;
        }
        if (res.status !== 200) {
          failed.res = res; // errors are answered as they are, never cached
          return undefined;
        }
        return { status: 200, contentType: res.headers.get("content-type") || "application/json", body: await res.text() };
      },
      opts
    );
  } catch (e) {
    console.warn(JSON.stringify({ event: "cache.error", op: "memoResponse", cache: cache.name, message: String((e as Error)?.message || e) }));
    return produce();
  }
  if (failed.error) throw failed.error;
  const v = entry.value;
  if (!v) return failed.res ?? produce(); // a request that joined a failed in-flight load runs its own
  return new Response(v.body, { status: v.status, headers: { "Content-Type": v.contentType, "X-Cache": entry.hit ? "HIT" : "MISS" } });
}
