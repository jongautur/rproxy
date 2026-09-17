import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";

export interface UsageFlushResult {
  usageKeysFlushed: number;
  lastUsedKeysFlushed: number;
}

// hourBucket is "YYYYMMDDHH" (UTC) — see the format gateway-auth.service.ts
// writes when it increments a usage:* key.
function parseHourBucket(bucket: string): Date {
  const year = Number(bucket.slice(0, 4));
  const month = Number(bucket.slice(4, 6)) - 1;
  const day = Number(bucket.slice(6, 8));
  const hour = Number(bucket.slice(8, 10));
  return new Date(Date.UTC(year, month, day, hour));
}

// Atomically hands off a key to a private "flushing" name before reading it,
// rather than plain HGETALL-then-DEL — a request that increments the
// original key between those two calls would otherwise have its count
// silently dropped along with the rest. RENAME is a single atomic Redis
// operation: anything that increments the ORIGINAL key name after the
// rename just recreates it fresh, to be picked up by the next flush cycle
// instead of being lost. Returns null if the key no longer exists (already
// flushed by a concurrent run, or genuinely gone).
async function claimKeyForFlush(key: string): Promise<string | null> {
  const flushingKey = `${key}:flushing:${process.pid}:${Date.now()}`;
  try {
    await redis.rename(key, flushingKey);
    return flushingKey;
  } catch {
    return null;
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

// Reads and clears the Redis-side usage/lastUsed counters gateway-auth.service.ts
// writes on every proxied request, persisting them into the ApiUsage rollup
// and ApiKey.lastUsedAt — the thing that makes this flush necessary at all
// (rather than writing Postgres directly on the request path) is that the
// request path must stay fast; this runs on a slow, periodic cron instead.
export async function flushUsageToPostgres(): Promise<UsageFlushResult> {
  let usageKeysFlushed = 0;
  let lastUsedKeysFlushed = 0;

  for (const key of await scanKeys("usage:*")) {
    // Skip a key that's mid-flush from a still-running previous invocation.
    if (key.includes(":flushing:")) continue;

    const flushingKey = await claimKeyForFlush(key);
    if (!flushingKey) continue;

    const data = await redis.hgetall(flushingKey);
    await redis.del(flushingKey);
    if (Object.keys(data).length === 0) continue;

    const parts = key.split(":");
    const [, customerId, apiId, routeId, hourBucket] = parts;
    if (!customerId || !apiId || !routeId || !hourBucket) continue;
    const hour = parseHourBucket(hourBucket);

    const allowed = Number(data.allowed ?? 0);
    const denied = Number(data.denied ?? 0);
    const throttled = Number(data.throttled ?? 0);

    await prisma.apiUsage.upsert({
      where: { customerId_apiId_routeId_hour: { customerId, apiId, routeId, hour } },
      create: { customerId, apiId, routeId, hour, allowed, denied, throttled },
      update: {
        allowed: { increment: allowed },
        denied: { increment: denied },
        throttled: { increment: throttled },
      },
    });
    usageKeysFlushed++;
  }

  for (const key of await scanKeys("lastused:*")) {
    if (key.includes(":flushing:")) continue;

    const flushingKey = await claimKeyForFlush(key);
    if (!flushingKey) continue;

    const value = await redis.get(flushingKey);
    await redis.del(flushingKey);
    if (!value) continue;

    const apiKeyId = key.slice("lastused:".length);
    const newLastUsedAt = new Date(value);
    if (Number.isNaN(newLastUsedAt.getTime())) continue;

    try {
      await prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: newLastUsedAt } });
      lastUsedKeysFlushed++;
    } catch {
      // The key (or its parent ApiKey row) was deleted between the Redis
      // write and this flush — not a failure worth surfacing.
    }
  }

  return { usageKeysFlushed, lastUsedKeysFlushed };
}

// 30-day retention, matching TrafficStat's pruneOldTrafficStats convention
// (see log-parser.ts).
const RETENTION_DAYS = 30;

export async function pruneOldApiUsage(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.apiUsage.deleteMany({ where: { hour: { lt: cutoff } } });
  return result.count;
}
