import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  ABUSE,
  clientIp,
  createRateLimiter,
  defaultRules,
  isExempt,
  normalizeIp,
  withRateLimit,
  type LimitGroup,
  type Rule,
} from "../src/lib/server/rateLimit";
import { upstreamAiBusy } from "../src/lib/server/aiErrors";
import { apiErrorMessage } from "../src/lib/apiError";

const MIN = 60_000;

function clock(start = Date.UTC(2026, 8, 30, 12, 0, 0)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function limiterWith(rules: Partial<Record<LimitGroup, Rule[]>>, global: Rule = { name: "global", limit: 10_000, windowMs: 60 * MIN, scope: "client" }) {
  const c = clock();
  const events: Record<string, unknown>[] = [];
  const l = createRateLimiter({ now: c.now, rules: { ...defaultRules(), ...rules }, global, log: (e) => events.push(e) });
  return { l, c, events };
}

const five = (name = "read"): Rule => ({ name, limit: 5, windowMs: MIN, scope: "client" });

test("allows up to the limit, then answers with a wait and no charge", () => {
  const { l } = limiterWith({ read: [five()] });
  for (let i = 0; i < 5; i++) {
    const d = l.check("read", "ip:1.1.1.1");
    assert.equal(d.allowed, true);
    assert.equal(d.limit, 5);
    assert.equal(d.remaining, 4 - i);
  }
  const denied = l.check("read", "ip:1.1.1.1");
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "limit");
  assert.equal(denied.remaining, 0);
  // a full window's worth must first fade: up to one window plus the share of the next that brings it under the limit
  assert.ok(denied.retryAfterSec! >= 1 && denied.retryAfterSec! <= 120);
  // another client is unaffected
  assert.equal(l.check("read", "ip:2.2.2.2").allowed, true);
});

test("sliding window: the previous window still counts, fading as the new one goes on", () => {
  const { l, c } = limiterWith({ read: [five()] });
  const start = Math.ceil(c.now() / MIN) * MIN; // align to a window edge
  c.advance(start - c.now());
  for (let i = 0; i < 5; i++) assert.equal(l.check("read", "ip:a").allowed, true);
  c.advance(MIN + 1); // just into the next window: the previous 5 still weigh ~5
  assert.equal(l.check("read", "ip:a").allowed, false);
  c.advance(MIN / 2); // halfway: the previous window weighs 2.5, so two more fit
  assert.equal(l.check("read", "ip:a").allowed, true);
  assert.equal(l.check("read", "ip:a").allowed, true);
  assert.equal(l.check("read", "ip:a").allowed, false);
  c.advance(2 * MIN); // everything has aged out
  const d = l.check("read", "ip:a");
  assert.equal(d.allowed, true);
  assert.equal(d.remaining, 4);
});

test("the Retry-After wait is enough: a retry at that moment succeeds", () => {
  const { l, c } = limiterWith({ read: [five()] });
  for (let i = 0; i < 5; i++) l.check("read", "ip:w");
  const d = l.check("read", "ip:w");
  c.advance(d.retryAfterSec! * 1000);
  assert.equal(l.check("read", "ip:w").allowed, true);
});

test("a request is charged to every rule or to none", () => {
  const { l } = limiterWith({ ai: [{ name: "ai", limit: 100, windowMs: MIN, scope: "client" }, { name: "ai-day", limit: 2, windowMs: 24 * 60 * MIN, scope: "client" }] });
  assert.equal(l.check("ai", "ip:x").allowed, true);
  assert.equal(l.check("ai", "ip:x").allowed, true);
  const d = l.check("ai", "ip:x");
  assert.equal(d.allowed, false);
  assert.ok(d.retryAfterSec! > 60, "the daily cap sets the wait");
  const perMin = l.store.counters.get("ai|ip:x")!;
  assert.equal(perMin.c.curr, 2, "the denied request did not use the per-minute budget");
});

test("headers show the rule closest to its limit", () => {
  const { l } = limiterWith({ ai: [{ name: "ai", limit: 10, windowMs: MIN, scope: "client" }, { name: "ai-day", limit: 3, windowMs: 24 * 60 * MIN, scope: "client" }] });
  const d = l.check("ai", "ip:h");
  assert.equal(d.limit, 3);
  assert.equal(d.remaining, 2);
});

test("a shared capacity cap denies without penalising the client", () => {
  const { l, events } = limiterWith({ ai: [{ name: "ai", limit: 50, windowMs: MIN, scope: "client" }, { name: "ai-all", limit: 2, windowMs: MIN, scope: "shared" }] });
  assert.equal(l.check("ai", "ip:p").allowed, true);
  assert.equal(l.check("ai", "ip:q").allowed, true);
  for (let i = 0; i < 12; i++) {
    const d = l.check("ai", "ip:r");
    assert.equal(d.allowed, false);
    assert.equal(d.reason, "capacity");
  }
  assert.equal(l.store.clients.get("ip:r")?.hits.length ?? 0, 0);
  assert.ok(events.some((e) => e.event === "rate_limit.capacity"));
  assert.ok(!events.some((e) => e.event === "rate_limit.blocked"));
});

test("progressive penalties: doubled cooldown, then a 1 h block, then 24 h for a repeat", () => {
  const { l, c, events } = limiterWith({ write: [{ name: "write", limit: 1, windowMs: MIN, scope: "client" }] });
  const who = "ip:9.9.9.9";
  assert.equal(l.check("write", who).allowed, true);
  const first = l.check("write", who);
  assert.equal(first.reason, "limit");
  l.check("write", who);
  const third = l.check("write", who);
  assert.equal(third.reason, "cooldown", "3 hits in 5 min double the wait");
  assert.ok(third.retryAfterSec! >= first.retryAfterSec!);
  assert.ok(events.some((e) => e.event === "rate_limit.cooldown"));

  // keep hammering: the 10th hit within 15 min blocks every endpoint for an hour
  let last = third;
  for (let i = 0; i < 7; i++) last = l.check("write", who);
  assert.equal(last.reason, "blocked");
  assert.equal(last.retryAfterSec, 3600);
  assert.equal(l.check("read", who).reason, "blocked", "the block covers other groups too");

  // after the hour, a second block within a day lasts 24 h
  c.advance(60 * MIN + 1);
  assert.equal(l.check("write", who).allowed, true);
  for (let i = 0; i < 10; i++) last = l.check("write", who);
  assert.equal(last.reason, "blocked");
  assert.equal(last.retryAfterSec, 24 * 3600);
  assert.ok(events.filter((e) => e.event === "rate_limit.blocked").length === 2);
});

test("a blocked client's requests are logged at most once a minute", () => {
  const { l, events } = limiterWith({ write: [{ name: "write", limit: 1, windowMs: MIN, scope: "client" }] });
  for (let i = 0; i < 11; i++) l.check("write", "ip:b");
  const before = events.length;
  for (let i = 0; i < 20; i++) l.check("read", "ip:b");
  assert.ok(events.length - before <= 1);
});

test("auth: successful requests are refunded, failures lock the client out", () => {
  const { l, c, events } = limiterWith({ auth: [{ name: "auth", limit: 5, windowMs: 15 * MIN, scope: "client" }] });
  const who = "ip:3.3.3.3";
  for (let i = 0; i < 20; i++) {
    const d = l.check("auth", who);
    assert.equal(d.allowed, true, `unlock ${i + 1} succeeds`);
    l.refund(d); // the route answered 200
  }
  // failures use the budget: 5 per 15 min, then 429
  for (let i = 0; i < 5; i++) {
    assert.equal(l.check("auth", who).allowed, true);
    l.recordAuthFailure(who);
  }
  assert.equal(l.check("auth", who).allowed, false);
  // spread over time, the 10th failure within an hour locks auth for 30 minutes
  c.advance(31 * MIN);
  for (let i = 0; i < 5; i++) {
    assert.equal(l.check("auth", who).allowed, true);
    l.recordAuthFailure(who);
  }
  const locked = l.check("auth", who);
  assert.equal(locked.reason, "lockout");
  assert.ok(locked.retryAfterSec! >= ABUSE.authLockout.lockMs / 1000 - 1);
  assert.ok(events.some((e) => e.event === "rate_limit.auth_lockout"));
  assert.equal(l.check("read", who).allowed, true, "the lockout is for auth only");
});

test("the global safety net spans every group", () => {
  const { l } = limiterWith({}, { name: "global", limit: 3, windowMs: 60 * MIN, scope: "client" });
  assert.equal(l.check("read", "ip:g").allowed, true);
  assert.equal(l.check("write", "ip:g").allowed, true);
  assert.equal(l.check("ai", "ip:g").allowed, true);
  const d = l.check("read", "ip:g");
  assert.equal(d.allowed, false);
  assert.equal(d.limit, 3);
});

test("stale counters are swept", () => {
  const { l, c } = limiterWith({ read: [five()] });
  l.check("read", "ip:s");
  assert.ok(l.store.counters.size > 0);
  c.advance(3 * 60 * MIN);
  l.check("read", "ip:t");
  assert.equal(l.store.counters.has("read|ip:s"), false);
});

test("client address: trusted proxy hops, IPv4-mapped, ports, IPv6 /64", () => {
  const req = (xff?: string, extra: Record<string, string> = {}) => new Request("http://x/api", { headers: { ...(xff ? { "x-forwarded-for": xff } : {}), ...extra } });
  assert.equal(clientIp(req("6.6.6.6, 203.0.113.7"), {}), "203.0.113.7", "default: one proxy appended the real address");
  assert.equal(clientIp(req("6.6.6.6, 203.0.113.7, 10.0.0.2"), { TRUST_PROXY_HOPS: "2" }), "203.0.113.7");
  assert.equal(clientIp(req("203.0.113.7"), { TRUST_PROXY_HOPS: "3" }), "203.0.113.7", "fewer entries than hops: the left-most");
  assert.equal(clientIp(req("::ffff:127.0.0.1"), {}), "127.0.0.1");
  assert.equal(clientIp(req(undefined, { "x-real-ip": "198.51.100.4" }), {}), "198.51.100.4");
  assert.equal(clientIp(req(), {}), "unknown");
  assert.equal(normalizeIp("198.51.100.4:5123"), "198.51.100.4");
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8:0:0::/64");
  assert.equal(normalizeIp("2001:db8:0:0:aaaa::1"), normalizeIp("2001:0db8::bbbb:2"), "one /64, one client");
  assert.notEqual(normalizeIp("2001:db8:0:1::1"), normalizeIp("2001:db8:0:2::1"));
  assert.equal(normalizeIp("::1"), "0:0:0:0::/64");
});

test("exemptions: the internal token and the allowlist", () => {
  const req = (h: Record<string, string> = {}) => new Request("http://x/api", { headers: h });
  const env = { RATE_LIMIT_INTERNAL_TOKEN: "s3cret", RATE_LIMIT_ALLOWLIST: "10.0.0.5, ::ffff:10.0.0.6" };
  assert.equal(isExempt(req({ "x-internal-token": "s3cret" }), "1.1.1.1", env), true);
  assert.equal(isExempt(req({ "x-internal-token": "wrong" }), "1.1.1.1", env), false);
  assert.equal(isExempt(req(), "10.0.0.5", env), true);
  assert.equal(isExempt(req(), "10.0.0.6", env), true);
  assert.equal(isExempt(req({ "x-internal-token": "s3cret" }), "1.1.1.1", {}), false, "no token configured: nothing is exempt");
});

// ─── the route wrapper ──────────────────────────────────────────────────────────────────────────────────────────────

function freshGlobal() {
  delete (globalThis as { __designdbRateLimiter?: unknown }).__designdbRateLimiter;
}

test("wrapper: headers on every response, the 429 body and Retry-After", async () => {
  freshGlobal();
  const handler = withRateLimit("upload", async () => Response.json({ ok: true }));
  const call = () => handler(new Request("http://x/api/share", { method: "POST", headers: { "x-forwarded-for": "192.0.2.10" } }), undefined);
  const first = await call();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("X-RateLimit-Limit"), "10");
  assert.equal(first.headers.get("X-RateLimit-Remaining"), "9");
  assert.ok(Number(first.headers.get("X-RateLimit-Reset")) > Date.now() / 1000);
  for (let i = 0; i < 9; i++) assert.equal((await call()).status, 200);
  const limited = await call();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) >= 1);
  assert.equal(limited.headers.get("X-RateLimit-Remaining"), "0");
  const body = await limited.json();
  assert.equal(body.error.code, "RATE_LIMIT_EXCEEDED");
  assert.equal(body.error.message, "Too many requests.");
  assert.equal(body.error.retryAfter, Number(limited.headers.get("Retry-After")));
});

test("wrapper: auth refunds 2xx and counts 401/403 as failures", async () => {
  freshGlobal();
  let status = 200;
  const handler = withRateLimit("auth", async () => Response.json({}, { status }));
  const call = () => handler(new Request("http://x/api/share/abc", { method: "POST", headers: { "x-forwarded-for": "192.0.2.20" } }), undefined);
  for (let i = 0; i < 12; i++) assert.equal((await call()).status, 200, "correct passwords never run out");
  status = 401;
  for (let i = 0; i < 5; i++) assert.equal((await call()).status, 401);
  assert.equal((await call()).status, 429, "the sixth wrong password within 15 min is refused");
});

test("wrapper: RATE_LIMIT_DISABLED and the internal token skip limiting", async () => {
  freshGlobal();
  const handler = withRateLimit("upload", async () => new Response("ok"));
  const call = (h: Record<string, string>) => handler(new Request("http://x/api/share", { method: "POST", headers: { "x-forwarded-for": "192.0.2.30", ...h } }), undefined);
  process.env.RATE_LIMIT_DISABLED = "true";
  try {
    for (let i = 0; i < 15; i++) assert.equal((await call({})).status, 200);
  } finally {
    delete process.env.RATE_LIMIT_DISABLED;
  }
  process.env.RATE_LIMIT_INTERNAL_TOKEN = "svc-token";
  try {
    for (let i = 0; i < 15; i++) {
      const r = await call({ "x-internal-token": "svc-token" });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("X-RateLimit-Limit"), null);
    }
  } finally {
    delete process.env.RATE_LIMIT_INTERNAL_TOKEN;
  }
});

test("every API route handler is rate limited", () => {
  const apiDir = join(process.cwd(), "src", "app", "api"); // npm test runs from frontend/
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === "route.ts") routes.push(p);
    }
  };
  walk(apiDir);
  assert.ok(routes.length >= 13);
  let handlers = 0;
  for (const file of routes) {
    const src = readFileSync(file, "utf8");
    const bare = src.match(/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g);
    assert.equal(bare, null, `${file} exports an unwrapped handler: ${bare}`);
    const consts = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(\w+)\(\s*"(\w+)"/g)];
    for (const m of consts) {
      assert.equal(m[2], "withRateLimit", `${file} ${m[1]} is not wrapped`);
      assert.ok(["auth", "ai", "upload", "write", "read"].includes(m[3]), `${file} ${m[1]}: unknown group ${m[3]}`);
      handlers++;
    }
    const exported = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].length;
    assert.equal(consts.length, exported, `${file}: every exported handler goes through withRateLimit(group, …)`);
  }
  assert.ok(handlers >= 20, `found ${handlers} handlers`);
});

// ─── messages ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("apiErrorMessage reads plain and rate-limit error bodies", () => {
  assert.equal(apiErrorMessage({ error: "Wrong password" }, "x"), "Wrong password");
  assert.equal(apiErrorMessage({ error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests.", retryAfter: 42 } }, "x"), "Too many requests. Try again in 42 s.");
  assert.equal(apiErrorMessage({ error: { message: "Too many failed attempts.", retryAfter: 1800 } }, "x"), "Too many failed attempts. Try again in 30 min.");
  assert.equal(apiErrorMessage({ error: { message: "Paused.", retryAfter: 86400 } }, "x"), "Paused. Try again in 24 h.");
  assert.equal(apiErrorMessage({}, "fallback"), "fallback");
  assert.equal(apiErrorMessage(null, "fallback"), "fallback");
});

test("upstream AI refusals become a 503 that never shows the provider's message", async () => {
  const groqLike = { status: 413, headers: new Headers({ "retry-after": "12" }), message: "Request too large for model in organization org_123 on tokens per minute (TPM)" };
  const res = upstreamAiBusy(groqLike)!;
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "12");
  const text = await res.text();
  assert.ok(!text.includes("org_123"));
  assert.equal(JSON.parse(text).error.code, "AI_BUSY");
  assert.equal(upstreamAiBusy({ status: 429, headers: {} })!.headers.get("Retry-After"), "30");
  assert.equal(upstreamAiBusy({ status: 400 }), null);
  assert.equal(upstreamAiBusy(new Error("boom")), null);
});
