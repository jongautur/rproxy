import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// Lazy singleton, mirrors lib/prisma.ts — reused across the PM2 fork-mode
// single instance rather than reconnecting per request.
export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
    // Never block the caller indefinitely waiting to (re)connect — the
    // gateway-auth fail-open path (see gateway-auth.service.ts) depends on
    // Redis errors surfacing quickly rather than hanging the request.
    maxRetriesPerRequest: 1,
    lazyConnect: false,
  });

redis.on("error", (err) => {
  // Logged here (not swallowed silently) so a persistent outage is visible
  // in normal process logs even before gateway-auth's own fail-open
  // logging kicks in per-request.
  console.error("[redis] connection error:", err.message);
});

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
