import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import Redis from "ioredis";

// Real-Redis integration test (not mocked) for the rate/quota enforcement
// this phase adds — the thing actually worth verifying here is the atomic
// INCR+EXPIRE behavior and the fail-open/fail-closed switch against a real
// server, not just that the code calls the right ioredis methods. Skips
// cleanly if Redis isn't reachable, same pattern as the nginx-dependent
// integration tests (nginxAvailable in nginx-integration.test.ts).
//
// Probed with top-level await, NOT inside a beforeAll — describe.skipIf()
// below evaluates its condition immediately during test collection, before
// any beforeAll hook would run, so setting this flag inside beforeAll (as
// an earlier version of this file did, and exactly the bug already fixed
// once in nginx-integration.test.ts) means skipIf always sees the initial
// `false` and the whole suite silently never runs, even with Redis
// installed and reachable.
const probeClient = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  connectTimeout: 500,
});
let redisAvailable = false;
try {
  await probeClient.connect();
  await probeClient.ping();
  redisAvailable = true;
} catch {
  redisAvailable = false;
}

afterAll(async () => {
  await probeClient.quit().catch(() => {});
});

describe.skipIf(!redisAvailable)("checkRateAndQuota — real Redis", () => {
  afterEach(async () => {
    // Sweep the real key prefixes checkRateAndQuota generates, scoped to
    // the customerId this file uses, so repeated runs don't accumulate.
    const gwKeys = await probeClient.keys("rl:gwauthtest-customer:*");
    const qKeys = await probeClient.keys("q:*:gwauthtest-customer:*");
    if (gwKeys.length) await probeClient.del(...gwKeys);
    if (qKeys.length) await probeClient.del(...qKeys);
  });

  it("allows requests under the rate limit and blocks over it, in the same second", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const customerId = "gwauthtest-customer";
    const routeId = "gwauthtest-route-rate";
    const limits = { rateLimit: 3, dailyScopeId: "x", monthlyScopeId: "x" };

    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkRateAndQuota(customerId, routeId, limits));
    }
    const allowed = results.filter((r) => r.ok).length;
    const denied = results.filter((r) => !r.ok);
    expect(allowed).toBe(3);
    expect(denied).toHaveLength(2);
    expect(denied.every((r) => !r.ok && r.reason === "rate_limited")).toBe(true);
  });

  it("enforces a daily quota across calls and reports quota_exceeded", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const customerId = "gwauthtest-customer";
    const routeId = "gwauthtest-route-quota";
    const limits = { dailyQuota: 2, dailyScopeId: routeId, monthlyScopeId: "x" };

    const r1 = await checkRateAndQuota(customerId, routeId, limits);
    const r2 = await checkRateAndQuota(customerId, routeId, limits);
    const r3 = await checkRateAndQuota(customerId, routeId, limits);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
    expect(!r3.ok && r3.reason).toBe("quota_exceeded");
  });

  it("shares the daily quota bucket across two routes that share the api-level scope", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const customerId = "gwauthtest-customer";
    const apiScope = "gwauthtest-api-shared-quota";
    const limits = { dailyQuota: 2, dailyScopeId: apiScope, monthlyScopeId: "x" };

    // Two different routeIds, same dailyScopeId — rate is keyed per-route
    // (routeId), but quota is keyed by the resolved scope, so both calls
    // should count against the SAME quota bucket.
    const r1 = await checkRateAndQuota(customerId, "route-a", limits);
    const r2 = await checkRateAndQuota(customerId, "route-b", limits);
    const r3 = await checkRateAndQuota(customerId, "route-a", limits);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(false);
  });

  it("keeps rate limiting keyed per-route even when quota is shared", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const customerId = "gwauthtest-customer";
    const limits = { rateLimit: 1, dailyScopeId: "x", monthlyScopeId: "x" };

    const routeA1 = await checkRateAndQuota(customerId, "route-a-rate", limits);
    const routeB1 = await checkRateAndQuota(customerId, "route-b-rate", limits);
    // Different routes, same second — each has its own rate bucket, so
    // both of these first hits should be allowed independently.
    expect(routeA1.ok).toBe(true);
    expect(routeB1.ok).toBe(true);
  });

  it("skips Redis entirely and returns ok when no limits are configured", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const result = await checkRateAndQuota("gwauthtest-customer", "unused-route", { dailyScopeId: "x", monthlyScopeId: "x" });
    expect(result.ok).toBe(true);
  });
});

describe.skipIf(!redisAvailable)("checkRateAndQuota — fail-open/fail-closed on Redis outage", () => {
  // Simulates a Redis outage by making the shared client's multi() throw,
  // rather than pointing REDIS_URL at an unreachable host — the ioredis
  // client is a module-scoped singleton (see lib/redis.ts), so swapping
  // REDIS_URL after it's already connected wouldn't actually change what
  // it talks to. Spying on multi() exercises the exact same try/catch path
  // in checkRateAndQuota that a real connection drop would.
  it("fails open by default (GATEWAY_REDIS_FAIL_OPEN unset/true) when Redis errors", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const { redis } = await import("@/lib/redis");
    const original = process.env.GATEWAY_REDIS_FAIL_OPEN;
    delete process.env.GATEWAY_REDIS_FAIL_OPEN;
    const spy = vi.spyOn(redis, "multi").mockImplementation(() => {
      throw new Error("simulated Redis outage");
    });
    try {
      const result = await checkRateAndQuota("gwauthtest-customer", "route", { rateLimit: 1, dailyScopeId: "x", monthlyScopeId: "x" });
      expect(result.ok).toBe(true);
    } finally {
      spy.mockRestore();
      process.env.GATEWAY_REDIS_FAIL_OPEN = original;
    }
  });

  it("fails closed when GATEWAY_REDIS_FAIL_OPEN=false and Redis errors", async () => {
    const { checkRateAndQuota } = await import("../gateway-auth.service");
    const { redis } = await import("@/lib/redis");
    const original = process.env.GATEWAY_REDIS_FAIL_OPEN;
    process.env.GATEWAY_REDIS_FAIL_OPEN = "false";
    const spy = vi.spyOn(redis, "multi").mockImplementation(() => {
      throw new Error("simulated Redis outage");
    });
    try {
      await expect(
        checkRateAndQuota("gwauthtest-customer", "route", { rateLimit: 1, dailyScopeId: "x", monthlyScopeId: "x" })
      ).rejects.toThrow("simulated Redis outage");
    } finally {
      spy.mockRestore();
      process.env.GATEWAY_REDIS_FAIL_OPEN = original;
    }
  });
});

// Pure function, no DB/Redis needed — always runs, no skipIf.
describe("isRouteInScope", () => {
  it("is always true for an unrestricted key, regardless of scopedRoutes content or method", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    expect(isRouteInScope({ scopeRestricted: false, scopedRoutes: [] }, "route-a", "GET")).toBe(true);
    expect(isRouteInScope({ scopeRestricted: false, scopedRoutes: [{ routeId: "route-b", methods: [] }] }, "route-a", "DELETE")).toBe(true);
  });

  it("is true only for routes in scopedRoutes when restricted", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    const apiKey = { scopeRestricted: true, scopedRoutes: [{ routeId: "route-a", methods: [] }, { routeId: "route-b", methods: [] }] };
    expect(isRouteInScope(apiKey, "route-a", "GET")).toBe(true);
    expect(isRouteInScope(apiKey, "route-b", "GET")).toBe(true);
    expect(isRouteInScope(apiKey, "route-c", "GET")).toBe(false);
  });

  it("blocks everything when restricted with zero scoped routes — the 'fully locked' state, not silently unrestricted", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    expect(isRouteInScope({ scopeRestricted: true, scopedRoutes: [] }, "route-a", "GET")).toBe(false);
  });

  it("inherits every method the route allows when the per-route methods subset is empty", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    const apiKey = { scopeRestricted: true, scopedRoutes: [{ routeId: "route-a", methods: [] }] };
    expect(isRouteInScope(apiKey, "route-a", "GET")).toBe(true);
    expect(isRouteInScope(apiKey, "route-a", "POST")).toBe(true);
    expect(isRouteInScope(apiKey, "route-a", "DELETE")).toBe(true);
  });

  it("restricts to the explicit method subset when one is set", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    const apiKey = { scopeRestricted: true, scopedRoutes: [{ routeId: "route-a", methods: ["GET"] }] };
    expect(isRouteInScope(apiKey, "route-a", "GET")).toBe(true);
    expect(isRouteInScope(apiKey, "route-a", "POST")).toBe(false);
  });

  it("implies HEAD whenever GET is in the method subset, mirroring nginx's own limit_except semantics", async () => {
    const { isRouteInScope } = await import("../gateway-auth.service");
    const apiKey = { scopeRestricted: true, scopedRoutes: [{ routeId: "route-a", methods: ["GET"] }] };
    expect(isRouteInScope(apiKey, "route-a", "HEAD")).toBe(true);

    const postOnly = { scopeRestricted: true, scopedRoutes: [{ routeId: "route-a", methods: ["POST"] }] };
    expect(isRouteInScope(postOnly, "route-a", "HEAD")).toBe(false);
  });
});
