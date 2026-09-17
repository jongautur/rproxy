import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-key";
import { redis } from "@/lib/redis";

// Identity + authorization checks always run against Postgres. Rate/quota
// enforcement is customer-level and shared across a customer's keys, so it
// runs against Redis (keyed by customerId, never apiKeyId) rather than a
// per-request Postgres write — see the API Gateway plan's Correction 2/5.

export type DenyReason = "forbidden" | "rate_limited" | "quota_exceeded";

export type AccessCheckResult =
  | { ok: true; customerId: string }
  | { ok: false; status: 401 | 403; denyReason?: DenyReason };

function isExpired(expiresAt: Date | null): boolean {
  return !!expiresAt && expiresAt.getTime() <= Date.now();
}

// Pure and independently unit-testable (no Prisma/Redis) — see
// gateway-auth.service.test.ts. scopeRestricted=false (the default) means
// unrestricted regardless of whatever rows happen to exist in
// scopedRoutes; a restricted key with zero remaining rows (e.g. every
// scoped route was since deleted) is correctly blocked from everything,
// not silently reopened — see the ApiKey.scopeRestricted schema comment.
//
// Once route-scope passes, also checks the per-route method sub-scope: an
// empty `methods` array on the matching ApiKeyRouteScope row means "inherit
// whatever the route itself allows" (already enforced by nginx's
// limit_except at the route level, so nothing further to check here); a
// non-empty array further restricts this specific key to that subset.
// HEAD is implicitly allowed whenever GET is, mirroring nginx's own
// limit_except semantics so the two enforcement points stay consistent.
export function isRouteInScope(
  apiKey: { scopeRestricted: boolean; scopedRoutes: { routeId: string; methods: string[] }[] },
  routeId: string,
  method: string
): boolean {
  if (!apiKey.scopeRestricted) return true;
  const scope = apiKey.scopedRoutes.find((s) => s.routeId === routeId);
  if (!scope) return false;
  if (scope.methods.length === 0) return true;
  return scope.methods.includes(method) || (method === "HEAD" && scope.methods.includes("GET"));
}

// If Redis is briefly unreachable, GATEWAY_REDIS_FAIL_OPEN (default true)
// lets customer traffic through without rate/quota enforcement rather than
// taking every API offline — the static per-route nginx `limit_req` ceiling
// (see api-gateway-config.ts) is unaffected either way, since it doesn't
// depend on the app or Redis at all, so backends stay protected from raw
// volume even during an outage. Identity/authorization checks above are
// never bypassed by this — only the Redis-dependent layer is.
function failOpen(): boolean {
  return (process.env.GATEWAY_REDIS_FAIL_OPEN ?? "true") !== "false";
}

export interface EffectiveLimits {
  rateLimit?: number;
  dailyQuota?: number;
  dailyScopeId: string;
  monthlyQuota?: number;
  monthlyScopeId: string;
}

// Route-level override wins per-field over the API-wide grant; a field left
// null on the override inherits the API-wide value. The *scope* a quota is
// tracked against follows the same per-field rule: a quota only tracks
// against the route specifically when the override itself defines that
// field, otherwise it's the api-wide bucket shared by every route lacking
// its own override (see the plan's "bucketing rule").
function resolveEffectiveLimits(
  apiId: string,
  routeId: string,
  apiAccess: { rateLimitOverride: number | null; dailyQuota: number | null; monthlyQuota: number | null },
  routeAccess: { rateLimitOverride: number | null; dailyQuota: number | null; monthlyQuota: number | null } | null
): EffectiveLimits {
  return {
    rateLimit: routeAccess?.rateLimitOverride ?? apiAccess.rateLimitOverride ?? undefined,
    dailyQuota: routeAccess?.dailyQuota ?? apiAccess.dailyQuota ?? undefined,
    dailyScopeId: routeAccess?.dailyQuota != null ? routeId : apiId,
    monthlyQuota: routeAccess?.monthlyQuota ?? apiAccess.monthlyQuota ?? undefined,
    monthlyScopeId: routeAccess?.monthlyQuota != null ? routeId : apiId,
  };
}

function endOfDayUnix(now: Date): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() / 1000);
}

function endOfMonthUnix(now: Date): number {
  return Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
}

export type RateQuotaResult = { ok: true } | { ok: false; reason: "rate_limited" | "quota_exceeded" };

// Rate limiting is always keyed per physical route hit (short-horizon
// throttle, doesn't need to be shared across routes); quota is keyed per
// the resolved scope above (customer-wide per Api by default, or
// route-scoped when a route override defines its own quota). One pipelined
// round trip for the checks; INCR+EXPIRE(AT) unconditionally on every call
// rather than branching on "is this the first hit" — the window identifier
// is already baked into the key name, so a redundant EXPIRE is harmless.
export async function checkRateAndQuota(customerId: string, routeId: string, limits: EffectiveLimits): Promise<RateQuotaResult> {
  if (!limits.rateLimit && !limits.dailyQuota && !limits.monthlyQuota) {
    return { ok: true }; // nothing configured at this layer — only the static nginx ceiling applies
  }

  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const ym = now.toISOString().slice(0, 7).replace(/-/g, "");

  const rateKey = limits.rateLimit ? `rl:${customerId}:${routeId}:${Math.floor(Date.now() / 1000)}` : undefined;
  const dayKey = limits.dailyQuota ? `q:day:${customerId}:${limits.dailyScopeId}:${ymd}` : undefined;
  const monthKey = limits.monthlyQuota ? `q:month:${customerId}:${limits.monthlyScopeId}:${ym}` : undefined;

  try {
    const pipeline = redis.multi();
    if (rateKey) { pipeline.incr(rateKey); pipeline.expire(rateKey, 2); }
    if (dayKey) { pipeline.incr(dayKey); pipeline.expireat(dayKey, endOfDayUnix(now)); }
    if (monthKey) { pipeline.incr(monthKey); pipeline.expireat(monthKey, endOfMonthUnix(now)); }

    const results = await pipeline.exec();
    if (!results) throw new Error("Redis pipeline returned null (connection not ready)");

    // Each key contributes two results (INCR, EXPIRE) in the order pushed above.
    let i = 0;
    if (rateKey) {
      const count = results[i]![1] as number;
      i += 2;
      if (count > limits.rateLimit!) return { ok: false, reason: "rate_limited" };
    }
    if (dayKey) {
      const count = results[i]![1] as number;
      i += 2;
      if (count > limits.dailyQuota!) return { ok: false, reason: "quota_exceeded" };
    }
    if (monthKey) {
      const count = results[i]![1] as number;
      i += 2;
      if (count > limits.monthlyQuota!) return { ok: false, reason: "quota_exceeded" };
    }

    return { ok: true };
  } catch (err) {
    console.error("[gateway-auth] Redis unavailable for rate/quota check:", err instanceof Error ? err.message : err);
    if (failOpen()) return { ok: true };
    throw err;
  }
}

// Usage/lastUsed accumulate in Redis only — never a per-request Postgres
// write (see the plan's Correction 5). A periodic flush (usage-flush
// cron, added alongside the Analytics UI) reads and clears these into the
// persisted ApiUsage rollup. Fire-and-forget: never awaited by the caller,
// so a Redis hiccup here can't add latency to — or fail — the auth decision
// that's already been made.
function recordUsage(customerId: string, apiId: string, routeId: string, apiKeyId: string, outcome: "allowed" | "denied" | "throttled"): void {
  const hourBucket = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  const usageKey = `usage:${customerId}:${apiId}:${routeId}:${hourBucket}`;
  const pipeline = redis.multi();
  pipeline.hincrby(usageKey, outcome, 1);
  if (outcome === "allowed") {
    pipeline.set(`lastused:${apiKeyId}`, new Date().toISOString());
  }
  pipeline.exec().catch((err) => {
    console.error("[gateway-auth] Redis usage counter write failed (non-fatal):", err instanceof Error ? err.message : err);
  });
}

export async function checkAccess(
  presentedKey: string | null,
  apiId: string,
  routeId: string,
  method: string
): Promise<AccessCheckResult> {
  if (!presentedKey) return { ok: false, status: 401 };

  const keyHash = hashApiKey(presentedKey);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: { customer: true, scopedRoutes: true },
  });

  // Look up by hash, never by comparing the presented key to a stored
  // plaintext (there is no stored plaintext) — the hash comparison itself
  // is a DB index equality check, not a secret comparison in application
  // code, so there's no timing-attack surface to worry about here the way
  // there would be for a manual string compare.
  if (!apiKey) return { ok: false, status: 401 };

  if (!apiKey.enabled || apiKey.revokedAt || isExpired(apiKey.expiresAt)) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "denied");
    return { ok: false, status: 403, denyReason: "forbidden" };
  }

  // A property of the key itself, cheapest check to run first since the
  // data's already loaded — see isRouteInScope's doc comment.
  if (!isRouteInScope(apiKey, routeId, method)) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "denied");
    return { ok: false, status: 403, denyReason: "forbidden" };
  }

  if (!apiKey.customer.enabled) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "denied");
    return { ok: false, status: 403, denyReason: "forbidden" };
  }

  const apiAccess = await prisma.apiAccess.findUnique({
    where: { customerId_apiId: { customerId: apiKey.customerId, apiId } },
  });
  if (!apiAccess || !apiAccess.enabled || isExpired(apiAccess.expiresAt)) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "denied");
    return { ok: false, status: 403, denyReason: "forbidden" };
  }

  // A route-level override row can ITSELF deny this specific route even
  // though the API-wide grant exists — its presence means "this route is
  // explicitly configured for this customer," and a disabled/expired
  // override is an explicit block, not something to fall back past.
  const routeAccess = await prisma.apiRouteAccess.findUnique({
    where: { customerId_routeId: { customerId: apiKey.customerId, routeId } },
  });
  if (routeAccess && (!routeAccess.enabled || isExpired(routeAccess.expiresAt))) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "denied");
    return { ok: false, status: 403, denyReason: "forbidden" };
  }

  const limits = resolveEffectiveLimits(apiId, routeId, apiAccess, routeAccess);
  const rateQuotaResult = await checkRateAndQuota(apiKey.customerId, routeId, limits);

  if (!rateQuotaResult.ok) {
    recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "throttled");
    return { ok: false, status: 403, denyReason: rateQuotaResult.reason };
  }

  recordUsage(apiKey.customerId, apiId, routeId, apiKey.id, "allowed");
  return { ok: true, customerId: apiKey.customerId };
}
