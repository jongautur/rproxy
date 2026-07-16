import { prisma } from "@/lib/prisma";
import { fireNotification } from "@/server/services/notification.service";
import type { ProxyHost } from "@prisma/client";
import https from "https";
import net from "net";

export interface ProbeResult {
  status: "UP" | "DOWN";
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

function probeHttps(host: string, port: number, start: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: host, port, path: "/", method: "HEAD", rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        const responseTime = Date.now() - start;
        const statusCode = res.statusCode ?? 0;
        // Any HTTP response means the backend is reachable; only errors/timeouts mean DOWN
        resolve({ status: statusCode > 0 ? "UP" : "DOWN", statusCode, responseTime });
        res.resume();
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: "DOWN", responseTime: Date.now() - start, error: "Timeout after 5s" }); });
    req.on("error", (e) => { resolve({ status: "DOWN", responseTime: Date.now() - start, error: e.message }); });
    req.end();
  });
}

function probeTcp(host: string, port: number, start: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.connect(port, host, () => { socket.destroy(); resolve({ status: "UP", responseTime: Date.now() - start }); });
    socket.on("timeout", () => { socket.destroy(); resolve({ status: "DOWN", responseTime: Date.now() - start, error: "Timeout after 5s" }); });
    socket.on("error", (e) => { resolve({ status: "DOWN", responseTime: Date.now() - start, error: e.message }); });
  });
}

export async function probeProxy(proxy: ProxyHost): Promise<ProbeResult> {
  const scheme = (proxy.forwardScheme ?? "http") as string;
  const start = Date.now();

  // gRPC: TCP connectivity check (no HTTP semantics)
  if (scheme === "grpc" || scheme === "grpcs") {
    return probeTcp(proxy.forwardHost, proxy.forwardPort, start);
  }

  // HTTPS: use native https module so we can disable cert verification
  if (scheme === "https") {
    return probeHttps(proxy.forwardHost, proxy.forwardPort, start);
  }

  // HTTP
  const url = `http://${proxy.forwardHost}:${proxy.forwardPort}/`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let statusCode: number;
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "manual", method: "HEAD" });
      statusCode = res.status;
    } finally {
      clearTimeout(timer);
    }
    const responseTime = Date.now() - start;
    return { status: statusCode > 0 ? "UP" : "DOWN", statusCode, responseTime };
  } catch (e) {
    const err = e as Error;
    return { status: "DOWN", responseTime: Date.now() - start, error: err.name === "AbortError" ? "Timeout after 5s" : (err.message ?? "Connection refused") };
  }
}

// Keeps at most 50 rows per host. A single windowed DELETE across the whole
// table costs one round-trip regardless of host count — the old approach
// (findMany + deleteMany per host) was 2N queries per sweep and was a
// meaningful chunk of the DB contention described below.
async function pruneOldHealthChecks(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM health_checks
    WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY proxy_host_id ORDER BY checked_at DESC) AS rn
        FROM health_checks
      ) ranked
      WHERE rn > 50
    )
  `;
}

function fireTransitionNotification(domain: string, result: ProbeResult): void {
  if (result.status === "DOWN") {
    void fireNotification({
      type: "host_down",
      title: `${domain} is DOWN`,
      body: `Proxy host ${domain} is no longer reachable.${result.error ? "\nError: " + result.error : ""}`,
      hostName: domain,
      status: 0,
    });
  } else {
    void fireNotification({
      type: "host_up",
      title: `${domain} recovered`,
      body: `Proxy host ${domain} is back online.${result.responseTime ? " Response time: " + result.responseTime + "ms" : ""}`,
      hostName: domain,
      status: 1,
    });
  }
}

// Used by the manual "probe" button (single host) — POST /api/proxies/[id]/health.
export async function recordHealthCheck(proxyId: string, result: ProbeResult): Promise<void> {
  const previous = await prisma.healthCheck.findFirst({
    where: { proxyHostId: proxyId },
    orderBy: { checkedAt: "desc" },
    select: { status: true },
  });

  await prisma.healthCheck.create({
    data: {
      proxyHostId: proxyId,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error ?? null,
    },
  });

  if (previous && previous.status !== result.status) {
    const proxy = await prisma.proxyHost.findUnique({ where: { id: proxyId }, select: { domain: true } });
    fireTransitionNotification(proxy?.domain ?? proxyId, result);
  }

  await pruneOldHealthChecks();
}

// Probes every enabled proxy host concurrently and persists all results in a
// small, fixed number of queries regardless of host count — used by both the
// dashboard's "refresh on page load" batch call and the background cron
// sweep. Previously each host was a fully separate HTTP request back into
// this app (POST /api/proxies/[id]/health), each paying its own session
// re-validation query, proxy lookup, previous-status lookup, insert, and
// prune (findMany+deleteMany) — under concurrency those N-in-parallel DB
// round trips queued against Prisma's connection pool, which is why probing
// "all hosts at once" measured ~50ms per host versus ~2-5ms one at a time.
// The fix isn't to reduce parallelism on the network probes (those are fine
// concurrent) — it's to stop doing per-host DB work N times over.
export async function runHealthSweep(): Promise<Record<string, ProbeResult>> {
  const hosts = await prisma.proxyHost.findMany({ where: { enabled: true } });
  if (hosts.length === 0) return {};

  const previousByHost = await getLatestHealthChecks();

  const results = await Promise.all(
    hosts.map(async (host) => ({ host, result: await probeProxy(host) }))
  );

  await prisma.healthCheck.createMany({
    data: results.map(({ host, result }) => ({
      proxyHostId: host.id,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error ?? null,
    })),
  });

  for (const { host, result } of results) {
    const previousStatus = previousByHost[host.id]?.status;
    if (previousStatus && previousStatus !== result.status) {
      fireTransitionNotification(host.domain, result);
    }
  }

  await pruneOldHealthChecks();

  return Object.fromEntries(results.map(({ host, result }) => [host.id, result]));
}

export async function getLatestHealthChecks(): Promise<
  Record<string, { status: string; responseTime?: number | null; checkedAt: Date }>
> {
  const results = await prisma.$queryRaw<
    { proxy_host_id: string; status: string; response_time: number | null; checked_at: Date }[]
  >`
    SELECT DISTINCT ON (proxy_host_id)
      proxy_host_id, status, response_time, checked_at
    FROM health_checks
    ORDER BY proxy_host_id, checked_at DESC
  `;
  return Object.fromEntries(
    results.map((r) => [r.proxy_host_id, { status: r.status, responseTime: r.response_time, checkedAt: r.checked_at }])
  );
}
