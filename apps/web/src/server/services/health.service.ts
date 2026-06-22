import { prisma } from "@/lib/prisma";
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

export async function recordHealthCheck(proxyId: string, result: ProbeResult): Promise<void> {
  await prisma.healthCheck.create({
    data: {
      proxyHostId: proxyId,
      status: result.status,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      error: result.error ?? null,
    },
  });

  const old = await prisma.healthCheck.findMany({
    where: { proxyHostId: proxyId },
    orderBy: { checkedAt: "desc" },
    skip: 50,
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.healthCheck.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  }
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
