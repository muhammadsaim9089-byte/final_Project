/**
 * SERVER-ONLY API rate limiting.
 *
 * Every route handler under src/app/api is wrapped — `export const POST = withRateLimit("write", async (req) => …)` —
 * and tests/rateLimit.test.ts fails if one is not. Each request is checked against its endpoint group's limits plus a
 * global per-client safety net, using sliding-window counters (a weighted blend of the previous and current fixed
 * window, so there is no double burst at window edges). Clients are identified by IP address (DesignDB has no user
 * accounts): the right-most X-Forwarded-For entry our own proxies did not add (TRUST_PROXY_HOPS), IPv6 grouped by /64.
 *
 * On top of the counters:
 *  - progressive penalties for clients that keep hitting limits (doubled cooldown → 1 h block → 24 h block);
 *  - an auth lockout after repeated wrong share passwords / edit tokens;
 *  - successful auth requests are refunded, so only failed attempts use up the auth budget.
 *
 * Responses carry X-RateLimit-Limit / -Remaining / -Reset; a 429 adds Retry-After and
 * `{ error: { code: "RATE_LIMIT_EXCEEDED", message, retryAfter } }` (clients read it with lib/apiError).
 *
 * Storage is this process's memory, kept on globalThis so every route bundle and dev hot reloads share one store.
 * That is exact for a single server process; with several instances or serverless functions each keeps its own
 * counts — move the store to Redis before scaling out. Any internal failure fails open (the request goes through).
 *
 * Environment:
 *   TRUST_PROXY_HOPS           reverse proxies in front of the app that append to X-Forwarded-For (default 1)
 *   RATE_LIMIT_ALLOWLIST       comma-separated client IPs that are never limited
 *   RATE_LIMIT_INTERNAL_TOKEN  requests sending this value in `x-internal-token` are never limited (service calls)
 *   RATE_LIMIT_AI_GLOBAL_PER_MIN  AI calls per minute across all clients (default 60; size it to the Groq plan)
 *   RATE_LIMIT_DISABLED=true   turns limiting off
 */
import { timingSafeEqual } from "crypto";
import { defaultNoStore } from "./httpCache";

export type LimitGroup = "auth" | "ai" | "upload" | "write" | "read";

export interface Rule {
  /** counter name, part of the store key */
  name: string;
  /** requests allowed per window */
  limit: number;
  windowMs: number;
  /** "client": one counter per client; "shared": one counter for everyone (a capacity cap, not the client's fault) */
  scope: "client" | "shared";
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Limits per endpoint group. Numbers are per client (IP) unless the rule's scope is "shared". */
export function defaultRules(): Record<LimitGroup, Rule[]> {
  return {
    // share-password unlock, and changing / unpublishing a share with its edit token
    auth: [{ name: "auth", limit: 5, windowMs: 15 * MIN, scope: "client" }],
    // Groq-backed routes: every call costs money and uses the account's tokens-per-minute budget
    ai: [
      { name: "ai", limit: 10, windowMs: MIN, scope: "client" },
      { name: "ai-day", limit: 100, windowMs: DAY, scope: "client" },
      { name: "ai-all", limit: envInt("RATE_LIMIT_AI_GLOBAL_PER_MIN", 60), windowMs: MIN, scope: "shared" },
    ],
    // publishing a diagram (up to 2 MB) and reverse-engineering a live database
    upload: [{ name: "upload", limit: 10, windowMs: HOUR, scope: "client" }],
    // saves (autosave fires 1.6 s after each pause in editing), renames, duplicates, deletes
    write: [{ name: "write", limit: 60, windowMs: MIN, scope: "client" }],
    // project lists and loads, shared-diagram views, conversions, downloads, the normalizer
    read: [{ name: "read", limit: 60, windowMs: MIN, scope: "client" }],
  };
}

/** Safety net over every group. Above the spec's 1,000/h so a full hour of steady editing (autosave) still fits. */
export const GLOBAL_RULE: Rule = { name: "global", limit: 2000, windowMs: HOUR, scope: "client" };

export const ABUSE = {
  /** this many 429s within the window doubles the wait (a cooldown on that group) */
  cooldown: { hits: 3, withinMs: 5 * MIN },
  /** this many 429s within the window blocks the client on every endpoint */
  block: { hits: 10, withinMs: 15 * MIN, blockMs: HOUR },
  /** a client blocked again within this long after a previous block is blocked for this long */
  repeatBlock: { withinMs: DAY, blockMs: DAY },
  /** failed auth attempts (wrong password / edit token) that lock the auth group */
  authLockout: { failures: 10, withinMs: HOUR, lockMs: 30 * MIN },
  /** a blocked client's rejected requests are logged at most this often */
  blockedLogEveryMs: MIN,
};

// ─── store ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Counter {
  start: number;
  curr: number;
  prev: number;
}

interface ClientState {
  /** times of recent 429s */
  hits: number[];
  /** times of recent blocks */
  blocks: number[];
  blockedUntil: number;
  /** times of recent failed auth attempts */
  failures: number[];
  lastBlockedLog: number;
}

interface Penalty {
  until: number;
  kind: "cooldown" | "lockout";
}

export interface Store {
  counters: Map<string, { c: Counter; windowMs: number }>;
  clients: Map<string, ClientState>;
  penalties: Map<string, Penalty>;
  lastSweep: number;
}

export function createStore(): Store {
  return { counters: new Map(), clients: new Map(), penalties: new Map(), lastSweep: 0 };
}

// ─── sliding window ──────────────────────────────────────────────────────────────────────────────────────────────────

function roll(c: Counter | undefined, now: number, w: number): Counter {
  const start = Math.floor(now / w) * w;
  if (!c || c.start < start - w) return { start, curr: 0, prev: 0 };
  if (c.start < start) return { start, curr: 0, prev: c.curr };
  return c;
}

function estimate(c: Counter, now: number, w: number): number {
  return c.prev * (1 - (now - c.start) / w) + c.curr;
}

/** ms until one more request fits under `limit` */
function waitMs(c: Counter, now: number, w: number, limit: number): number {
  const est = estimate(c, now, w);
  if (est + 1 <= limit) return 0;
  const end = c.start + w;
  // for the rest of this window the estimate falls by prev / w per ms
  if (c.prev > 0) {
    const t = ((est + 1 - limit) * w) / c.prev;
    if (now + t <= end) return Math.ceil(t);
  }
  // in the next window the estimate is curr × (1 − elapsed / w)
  const into = c.curr > 0 ? w * (1 - (limit - 1) / c.curr) : 0;
  return Math.ceil(end - now + Math.max(0, into));
}

// ─── limiter ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DenyReason = "limit" | "capacity" | "cooldown" | "blocked" | "lockout";

export interface Decision {
  allowed: boolean;
  /** header values, for the rule closest to its limit (or the rule / penalty that denied) */
  limit: number;
  remaining: number;
  /** epoch ms: when the current window ends (allowed) or when a retry can succeed (denied) */
  resetAt: number;
  retryAfterSec?: number;
  reason?: DenyReason;
  /** counters this request was added to, for an auth refund */
  refundable: string[];
}

export interface LimiterOptions {
  now?: () => number;
  store?: Store;
  rules?: Record<LimitGroup, Rule[]>;
  global?: Rule;
  log?: (event: Record<string, unknown>) => void;
}

export interface RequestInfo {
  method?: string;
  path?: string;
}

export function createRateLimiter(opts: LimiterOptions = {}) {
  const now = opts.now ?? Date.now;
  const store = opts.store ?? createStore();
  const rules = opts.rules ?? defaultRules();
  const globalRule = opts.global ?? GLOBAL_RULE;
  const log = opts.log ?? ((e: Record<string, unknown>) => console.warn(JSON.stringify(e)));

  const client = (key: string): ClientState => {
    let st = store.clients.get(key);
    if (!st) store.clients.set(key, (st = { hits: [], blocks: [], blockedUntil: 0, failures: [], lastBlockedLog: 0 }));
    return st;
  };

  const sweep = (t: number) => {
    if (t - store.lastSweep < MIN) return;
    store.lastSweep = t;
    store.counters.forEach((v, k) => {
      if (v.c.start + 2 * v.windowMs <= t) store.counters.delete(k);
    });
    store.penalties.forEach((p, k) => {
      if (p.until <= t) store.penalties.delete(k);
    });
    store.clients.forEach((st, k) => {
      st.hits = st.hits.filter((x) => t - x < ABUSE.block.withinMs);
      st.blocks = st.blocks.filter((x) => t - x < ABUSE.repeatBlock.withinMs);
      st.failures = st.failures.filter((x) => t - x < ABUSE.authLockout.withinMs);
      if (!st.hits.length && !st.blocks.length && !st.failures.length && st.blockedUntil <= t) store.clients.delete(k);
    });
  };

  const deny = (t: number, wait: number, reason: DenyReason, limit: number): Decision => {
    const retryAfterSec = Math.max(1, Math.ceil(wait / 1000));
    return { allowed: false, limit, remaining: 0, resetAt: t + retryAfterSec * 1000, retryAfterSec, reason, refundable: [] };
  };

  /** a 429 the client earned: count it and escalate (doubled cooldown, then a block) */
  const hit = (key: string, group: LimitGroup, t: number, wait: number, reason: DenyReason, info: RequestInfo): { wait: number; reason: DenyReason } => {
    const st = client(key);
    st.hits = st.hits.filter((x) => t - x < ABUSE.block.withinMs);
    st.hits.push(t);
    const base = { client: key, group, method: info.method, path: info.path };
    if (st.hits.length >= ABUSE.block.hits) {
      st.blocks = st.blocks.filter((x) => t - x < ABUSE.repeatBlock.withinMs);
      const ms = st.blocks.length ? ABUSE.repeatBlock.blockMs : ABUSE.block.blockMs;
      st.blocks.push(t);
      st.blockedUntil = t + ms;
      st.lastBlockedLog = t;
      st.hits = [];
      log({ event: "rate_limit.blocked", ...base, blockSeconds: ms / 1000 });
      return { wait: ms, reason: "blocked" };
    }
    const recent = st.hits.filter((x) => t - x < ABUSE.cooldown.withinMs).length;
    if (reason === "limit" && recent >= ABUSE.cooldown.hits) {
      const ms = wait * 2;
      store.penalties.set(`${group}|${key}`, { until: t + ms, kind: "cooldown" });
      log({ event: "rate_limit.cooldown", ...base, retryAfter: Math.ceil(ms / 1000) });
      return { wait: ms, reason: "cooldown" };
    }
    log({ event: "rate_limit.exceeded", ...base, reason, retryAfter: Math.ceil(wait / 1000) });
    return { wait, reason };
  };

  function check(group: LimitGroup, key: string, info: RequestInfo = {}): Decision {
    const t = now();
    sweep(t);
    const groupRules = rules[group];
    const primary = groupRules[0];

    // 1. an active block covers every endpoint
    const st = store.clients.get(key);
    if (st && st.blockedUntil > t) {
      if (t - st.lastBlockedLog >= ABUSE.blockedLogEveryMs) {
        st.lastBlockedLog = t;
        log({ event: "rate_limit.blocked_request", client: key, group, method: info.method, path: info.path });
      }
      return deny(t, st.blockedUntil - t, "blocked", primary.limit);
    }

    // 2. a cooldown or auth lockout on this group
    const pen = store.penalties.get(`${group}|${key}`);
    if (pen && pen.until > t) {
      const r = hit(key, group, t, pen.until - t, pen.kind, info);
      return deny(t, r.wait, r.reason, primary.limit);
    }

    // 3. the counters: all must have room, or none is charged
    const all = [...groupRules, globalRule];
    const evaluated = all.map((rule) => {
      const k = rule.scope === "shared" ? `${rule.name}` : `${rule.name}|${key}`;
      const c = roll(store.counters.get(k)?.c, t, rule.windowMs);
      return { rule, k, c, wait: waitMs(c, t, rule.windowMs, rule.limit) };
    });
    const blocking = evaluated.filter((e) => e.wait > 0);
    if (blocking.length) {
      // the client's own limits come first: a capacity cap is nobody's fault and never escalates
      const own = blocking.filter((e) => e.rule.scope === "client");
      if (own.length) {
        const worst = own.reduce((a, b) => (b.wait > a.wait ? b : a));
        const r = hit(key, group, t, worst.wait, "limit", info);
        return deny(t, r.wait, r.reason, worst.rule.limit);
      }
      const worst = blocking.reduce((a, b) => (b.wait > a.wait ? b : a));
      log({ event: "rate_limit.capacity", client: key, group, rule: worst.rule.name, method: info.method, path: info.path });
      return deny(t, worst.wait, "capacity", worst.rule.limit);
    }

    let shown: { limit: number; remaining: number; resetAt: number } | null = null;
    for (const e of evaluated) {
      e.c.curr += 1;
      store.counters.set(e.k, { c: e.c, windowMs: e.rule.windowMs });
      const remaining = Math.max(0, Math.floor(e.rule.limit - estimate(e.c, t, e.rule.windowMs)));
      if (!shown || remaining < shown.remaining) shown = { limit: e.rule.limit, remaining, resetAt: e.c.start + e.rule.windowMs };
    }
    const refundable = evaluated.filter((e) => e.rule !== globalRule && e.rule.scope === "client").map((e) => e.k);
    return { allowed: true, ...shown!, refundable };
  }

  /** give back a request's charge (a successful auth request does not use the auth budget) */
  function refund(decision: Decision) {
    for (const k of decision.refundable) {
      const v = store.counters.get(k);
      if (v && v.c.curr > 0) v.c.curr -= 1;
    }
  }

  /** a wrong share password or edit token; enough of them lock the client out of the auth group */
  function recordAuthFailure(key: string, info: RequestInfo = {}) {
    const t = now();
    const st = client(key);
    st.failures = st.failures.filter((x) => t - x < ABUSE.authLockout.withinMs);
    st.failures.push(t);
    if (st.failures.length >= ABUSE.authLockout.failures) {
      st.failures = [];
      store.penalties.set(`auth|${key}`, { until: t + ABUSE.authLockout.lockMs, kind: "lockout" });
      log({ event: "rate_limit.auth_lockout", client: key, method: info.method, path: info.path, lockSeconds: ABUSE.authLockout.lockMs / 1000 });
    }
  }

  return { check, refund, recordAuthFailure, store };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

// ─── client identity ─────────────────────────────────────────────────────────────────────────────────────────────────

type Env = Record<string, string | undefined>;

function ipv6Prefix64(ip: string): string {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return (
    groups
      .slice(0, 4)
      .map((g) => (g || "0").toLowerCase().replace(/^0+(?=.)/, ""))
      .join(":") + "::/64"
  );
}

/** One key per client: an IPv4 address, or an IPv6 /64 (one household or server can rotate within it). */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().replace(/^"|"$/g, "");
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1];
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  if (ip.includes(":")) return ipv6Prefix64(ip.split("%")[0]);
  return ip || "unknown";
}

/**
 * The client's address. Each trusted proxy appends the address it received from, so the client is the entry just
 * before the last `TRUST_PROXY_HOPS` ones; anything further left was sent by the client and can be forged. With no
 * proxy (hops 0) Next.js fills the header from the socket only when the client sent none, so run behind a proxy in
 * production.
 */
export function clientIp(req: Request, env: Env = process.env): string {
  const platformIp = (req as unknown as { ip?: string }).ip; // NextRequest.ip: set by some hosts (e.g. Vercel) from their own edge
  if (platformIp) return normalizeIp(platformIp);
  const hopsRaw = Number(env.TRUST_PROXY_HOPS ?? 1);
  const hops = Number.isFinite(hopsRaw) && hopsRaw >= 0 ? Math.floor(hopsRaw) : 1;
  const parts = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length) return normalizeIp(parts[Math.max(0, parts.length - Math.max(1, hops))]);
  const real = req.headers.get("x-real-ip");
  return real ? normalizeIp(real) : "unknown";
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** service-to-service calls (`x-internal-token`) and allowlisted addresses are never limited */
export function isExempt(req: Request, ip: string, env: Env = process.env): boolean {
  const token = env.RATE_LIMIT_INTERNAL_TOKEN;
  const sent = req.headers.get("x-internal-token");
  if (token && sent && safeEqual(sent, token)) return true;
  const allow = (env.RATE_LIMIT_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeIp);
  return allow.includes(ip);
}

// ─── route wrapper ───────────────────────────────────────────────────────────────────────────────────────────────────

const g = globalThis as unknown as { __designdbRateLimiter?: RateLimiter };
function limiter(): RateLimiter {
  return (g.__designdbRateLimiter ??= createRateLimiter());
}

const MESSAGES: Record<DenyReason, string> = {
  limit: "Too many requests.",
  cooldown: "Too many requests.",
  blocked: "Too many requests. Access from your network is paused for a while.",
  lockout: "Too many failed attempts.",
  capacity: "The service is busy right now.",
};

function setHeaders(headers: Headers, d: Decision) {
  headers.set("X-RateLimit-Limit", String(d.limit));
  headers.set("X-RateLimit-Remaining", String(d.remaining));
  headers.set("X-RateLimit-Reset", String(Math.ceil(d.resetAt / 1000)));
  if (d.retryAfterSec) headers.set("Retry-After", String(d.retryAfterSec));
}

export function tooManyRequests(d: Decision): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  setHeaders(headers, d);
  const body = { error: { code: "RATE_LIMIT_EXCEEDED", message: MESSAGES[d.reason || "limit"], retryAfter: d.retryAfterSec ?? 1 } };
  return new Response(JSON.stringify(body), { status: 429, headers });
}

function withHeaders(res: Response, d: Decision): Response {
  try {
    setHeaders(res.headers, d);
    return res;
  } catch {
    // immutable headers (a proxied fetch response): copy it
    const copy = new Response(res.body, res);
    setHeaders(copy.headers, d);
    return copy;
  }
}

type Handler<R extends Request, C> = (req: R, ctx: C) => Response | Promise<Response>;

/**
 * Rate-limits a route handler by endpoint group (see the module comment). Every API route goes through this wrapper,
 * so it also applies the caching default: a response that set no Cache-Control is sent as `no-store` (lib/server/httpCache).
 */
export function withRateLimit<R extends Request, C = any>(group: LimitGroup, handler: Handler<R, C>): Handler<R, C> {
  const limited = rateLimited(group, handler);
  return async (req: R, ctx: C) => defaultNoStore(await limited(req, ctx));
}

function rateLimited<R extends Request, C>(group: LimitGroup, handler: Handler<R, C>): Handler<R, C> {
  return async (req: R, ctx: C) => {
    if (process.env.RATE_LIMIT_DISABLED === "true") return handler(req, ctx);
    let decision: Decision;
    let key: string;
    let info: RequestInfo;
    try {
      const ip = clientIp(req);
      if (isExempt(req, ip)) return handler(req, ctx);
      key = `ip:${ip}`;
      info = { method: req.method, path: new URL(req.url).pathname };
      decision = limiter().check(group, key, info);
    } catch (e) {
      console.warn(JSON.stringify({ event: "rate_limit.error", message: String((e as Error)?.message || e) }));
      return handler(req, ctx); // fail open
    }
    if (!decision.allowed) return tooManyRequests(decision);

    const res = await handler(req, ctx);
    try {
      if (group === "auth") {
        if (res.status >= 200 && res.status < 300) limiter().refund(decision);
        else if (res.status === 401 || res.status === 403) limiter().recordAuthFailure(key, info);
      }
      return withHeaders(res, decision);
    } catch {
      return res;
    }
  };
}
