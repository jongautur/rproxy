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

interface LogOffsetState {
  offset: number;
  ino: number;
}

export function parseOffsetState(raw: string | undefined): LogOffsetState | null {
  if (!raw) return null;
  // Older versions of this function stored a bare offset integer with no
  // inode — treat that as "unknown identity" so the first read after
  // upgrade re-derives it safely (falls into the ino-mismatch reset path
  // below only if the file has since rotated; otherwise offset is reused
  // as-is).
  if (/^\d+$/.test(raw)) return { offset: parseInt(raw, 10), ino: -1 };
  try {
    const parsed = JSON.parse(raw) as Partial<LogOffsetState>;
    if (typeof parsed.offset === "number" && typeof parsed.ino === "number") {
      return { offset: parsed.offset, ino: parsed.ino };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function parseLogsForProxy(proxyHostId: string, domain: string): Promise<number> {
  const safeFilename = domain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9.-]/g, "_");
  const logPath = `${LOG_DIR}/${safeFilename}.access.log`;

  let fileSize: number;
  let ino: number;
  try {
    const s = await stat(logPath);
    fileSize = s.size;
    ino = s.ino;
  } catch {
    return 0; // log file doesn't exist yet
  }

  const offsetKey = `log_offset:${proxyHostId}`;
  const stored = await prisma.setting.findUnique({ where: { key: offsetKey } });
  const state = parseOffsetState(stored?.value);

  // Reset to the start whenever the file identity changed (rotation swapped
  // in a new inode) or the file is smaller than our last offset (truncated
  // in place, e.g. by the log-size-cap cleanup) — otherwise a rotation
  // would permanently wedge this proxy's stats at zero, since offset would
  // stay stuck above every future (smaller) fileSize forever.
  const identityChanged = state === null || (state.ino !== -1 && state.ino !== ino) || state.offset > fileSize;
  const offset = identityChanged ? 0 : state.offset;

  const persistState = async (newOffset: number): Promise<void> => {
    await prisma.setting.upsert({
      where: { key: offsetKey },
      create: { key: offsetKey, value: JSON.stringify({ offset: newOffset, ino }) },
      update: { value: JSON.stringify({ offset: newOffset, ino }) },
    });
  };

  if (offset >= fileSize) {
    // Nothing new to read, but if identity changed we still need to record
    // the reset (offset 0, new inode) so the next run compares correctly.
    if (identityChanged) await persistState(offset);
    return 0;
  }

  // Read new bytes only
  const buffer = Buffer.alloc(fileSize - offset);
  const fh = await import("fs/promises").then((m) => m.open(logPath, "r"));
  try {
    await fh.read(buffer, 0, buffer.length, offset);
  } finally {
    await fh.close();
  }

  const text = buffer.toString("utf-8");
  // Only consume up through the last newline — a line still being written
  // by nginx (no trailing \n yet) is left unread so the next parse picks up
  // the complete line instead of the offset skipping past its start.
  const lastNewline = text.lastIndexOf("\n");
  const completeText = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
  const consumedBytes = Buffer.byteLength(completeText, "utf-8");
  const lines = completeText.length > 0 ? completeText.split("\n").filter((l) => l.length > 0) : [];

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

  await persistState(offset + consumedBytes);

  return buckets.size;
}

export async function pruneOldTrafficStats(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.trafficStat.deleteMany({ where: { hour: { lt: cutoff } } });
}

// Audit logs otherwise grow unbounded — kept longer than traffic stats
// since they're the record of who changed what, not raw metrics.
export async function pruneOldAuditLogs(): Promise<void> {
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
