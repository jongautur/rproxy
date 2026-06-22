import { readFile, stat } from "fs/promises";
import { prisma } from "@/lib/prisma";

const LOG_DIR = "/var/log/nginx";
// Combined log format: addr - user [time] "request" status bytes "referer" "ua"
const LOG_REGEX = /^\S+ \S+ \S+ \[([^\]]+)\] "(?:[^"]*)" (\d{3}) (\d+)/;

function truncateToHour(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
}

// Parse nginx time format: "22/Jun/2025:14:03:22 +0000"
function parseNginxDate(s: string): Date | null {
  const m = /(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})/.exec(s);
  if (!m) return null;
  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const [, day, mon, year, hh, mm, ss, tz] = m;
  const tzOffset = (parseInt(tz!.slice(1, 3)) * 60 + parseInt(tz!.slice(3, 5))) * (tz![0] === "+" ? -1 : 1);
  return new Date(Date.UTC(
    parseInt(year!), MONTHS[mon!]!, parseInt(day!),
    parseInt(hh!) + Math.floor(tzOffset / 60),
    parseInt(mm!) + (tzOffset % 60),
    parseInt(ss!)
  ));
}

interface HourBucket {
  requests: number;
  bytes: bigint;
  errors: number;
}

export async function parseLogsForProxy(proxyHostId: string, domain: string): Promise<number> {
  const safeFilename = domain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9.-]/g, "_");
  const logPath = `${LOG_DIR}/${safeFilename}.access.log`;

  // Get current file size
  let fileSize: number;
  try {
    const s = await stat(logPath);
    fileSize = s.size;
  } catch {
    return 0; // log file doesn't exist yet
  }

  // Get stored offset
  const offsetKey = `log_offset:${proxyHostId}`;
  const stored = await prisma.setting.findUnique({ where: { key: offsetKey } });
  const offset = stored ? parseInt(stored.value, 10) : 0;

  if (offset >= fileSize) return 0; // nothing new

  // Read new bytes only
  const buffer = Buffer.alloc(fileSize - offset);
  const fh = await import("fs/promises").then((m) => m.open(logPath, "r"));
  try {
    await fh.read(buffer, 0, buffer.length, offset);
  } finally {
    await fh.close();
  }

  const lines = buffer.toString("utf-8").split("\n");
  const buckets = new Map<string, HourBucket>();

  for (const line of lines) {
    const m = LOG_REGEX.exec(line);
    if (!m) continue;
    const [, timeStr, statusStr, bytesStr] = m;
    const d = parseNginxDate(timeStr!);
    if (!d) continue;
    const hour = truncateToHour(d);
    const key = hour.toISOString();
    const status = parseInt(statusStr!, 10);
    const bytes = BigInt(bytesStr ?? "0");
    const bucket = buckets.get(key) ?? { requests: 0, bytes: 0n, errors: 0 };
    bucket.requests++;
    bucket.bytes += bytes;
    if (status >= 400) bucket.errors++;
    buckets.set(key, bucket);
  }

  // Upsert all hour buckets
  for (const [hourStr, bucket] of buckets) {
    const hour = new Date(hourStr);
    await prisma.trafficStat.upsert({
      where: { proxyHostId_hour: { proxyHostId, hour } },
      create: { proxyHostId, hour, requests: bucket.requests, bytes: bucket.bytes, errors: bucket.errors },
      update: {
        requests: { increment: bucket.requests },
        bytes: { increment: bucket.bytes },
        errors: { increment: bucket.errors },
      },
    });
  }

  // Update offset
  await prisma.setting.upsert({
    where: { key: offsetKey },
    create: { key: offsetKey, value: String(fileSize) },
    update: { value: String(fileSize) },
  });

  return buckets.size;
}

export async function pruneOldTrafficStats(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.trafficStat.deleteMany({ where: { hour: { lt: cutoff } } });
}
