import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import http from "http";
import { generateApiGatewayConfig } from "../api-gateway-config";
import type { Api } from "@prisma/client";
import type { ApiRouteWithAuth } from "../api-gateway-config";

// Correction 4 from the API Gateway plan: nginx's auth_request module only
// understands 2xx/401/403 from the subrequest — a bare 429 would NOT
// propagate. This suite proves the actual mechanism (auth-check returns
// 403 + X-Gateway-Deny-Reason header, nginx remaps via a named location) by
// running a REAL nginx process — not just `nginx -t` syntax validation —
// against a stub auth-check server, and curling the client-visible status
// codes. This is the thing that must be verified, not assumed.

let nginxAvailable = false;
try {
  execFileSync("nginx", ["-v"], { stdio: "ignore" });
  nginxAvailable = true;
} catch {
  nginxAvailable = false;
}

function freePort(): number {
  // High, unprivileged, unlikely-to-collide range — good enough for a
  // short-lived test process; not a hardened port-allocation strategy.
  return 20000 + Math.floor(Math.random() * 10000);
}

function waitForPort(port: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = http.request({ host: "127.0.0.1", port, path: "/", timeout: 200 }, () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        if (Date.now() > deadline) reject(new Error(`Nothing listening on ${port} after ${timeoutMs}ms`));
        else setTimeout(attempt, 50);
      });
      socket.end();
    };
    attempt();
  });
}

function httpGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (c) => { body += String(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(!nginxAvailable)("API Gateway auth_request — real nginx, end-to-end status codes", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "rproxy-gw-auth-it-"));
  const nginxPort = freePort();
  const authStubPort = freePort();
  const backendStubPort = freePort();
  const pidPath = path.join(workDir, "nginx.pid");

  let nginxProc: ChildProcess | undefined;
  let authStub: http.Server | undefined;
  let backendStub: http.Server | undefined;

  const INTERNAL_SECRET = "test-secret-not-used-in-production";
  const GOOD_KEY = "good-key";

  beforeAll(async () => {
    process.env.GATEWAY_AUTH_SECRET = INTERNAL_SECRET;
    process.env.NEXTAUTH_URL = "http://localhost:81"; // getAppPort() reads this — irrelevant here, overridden below

    // Stub backend the "authorized" request should reach.
    backendStub = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("backend reached");
    });
    await new Promise<void>((resolve) => backendStub!.listen(backendStubPort, "127.0.0.1", resolve));

    // Stub auth-check server — mimics apps/web/src/app/api/gateway/auth-check/route.ts's
    // response contract (only 200/401/403 + X-Gateway-Deny-Reason) without
    // needing a full Next.js app running.
    authStub = http.createServer((req, res) => {
      const key = req.headers["x-api-key"];
      const secret = req.headers["x-gateway-internal-secret"];
      if (secret !== INTERNAL_SECRET) { res.writeHead(401); res.end(); return; }
      if (!key) { res.writeHead(401); res.end(); return; }
      if (key === GOOD_KEY) { res.writeHead(200, { "X-Gateway-Customer-Id": "cust1" }); res.end(); return; }
      if (key === "rate-limited-key") { res.writeHead(403, { "X-Gateway-Deny-Reason": "rate_limited" }); res.end(); return; }
      if (key === "quota-key") { res.writeHead(403, { "X-Gateway-Deny-Reason": "quota_exceeded" }); res.end(); return; }
      res.writeHead(403, { "X-Gateway-Deny-Reason": "forbidden" }); res.end();
    });
    await new Promise<void>((resolve) => authStub!.listen(authStubPort, "127.0.0.1", resolve));

    const api = {
      id: "gwauth1",
      name: "Auth IT Test API",
      domain: "gw-auth-it.invalid",
      basePath: "",
      description: null,
      listenPort: nginxPort,
      httpsPort: nginxPort + 1, // unused — sslEnabled is false and no certificate is provided, but the generator validates this field unconditionally
      sslEnabled: false,
      maxRequestsPerSecond: null,
      maxBodySizeMb: null,
      corsEnabled: false,
      status: "ACTIVE",
      enabled: true,
      configPath: null,
      docsEnabled: false,
      docsTitle: null,
      docsDescription: null,
      docsVersion: null,
      docsIntro: null,
      docsAuthContent: null,
      docsErrorsContent: null,
      docsNotes: null,
      docsPublic: false,
      docsSlug: null,
      docsLogoUrl: null,
      docsCountDisabledRoutes: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      certificateId: null,
    } as Api;

    const routes = [
      {
        id: "gwauthroute1",
        apiId: "gwauth1",
        path: "/protected",
        methods: [],
        upstreamScheme: "http",
        upstreamHost: "127.0.0.1",
        upstreamPort: backendStubPort,
        upstreamPath: null,
        authRequired: true,
        maxRequestsPerSecond: null,
        enabled: true,
        upstreamAuthType: "NONE",
        upstreamAuthHeaderName: null,
        upstreamAuthValueEncrypted: null,
        upstreamAuthValue: null,
        docInclude: true,
        docSummary: null,
        docDescription: null,
        docCategory: null,
        docDeprecated: false,
        docParameters: null,
        docRequestBodyDescription: null,
        docRequestBodyExample: null,
        docResponses: null,
        docNotes: null,
        docAnyMethods: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as ApiRouteWithAuth[];

    let config = generateApiGatewayConfig({ api, routes, certificate: null });
    // Redirect the internal auth_request target at our stub instead of the
    // real app port (getAppPort() has no way to know about this test's
    // throwaway stub) — same "swap in a writable/reachable target for the
    // structural check" approach as the pid/log-path/port fixes in
    // nginx-integration.test.ts, just for a port instead of a filesystem path.
    config = config.replace(/proxy_pass http:\/\/127\.0\.0\.1:\d+\/api\/gateway\/auth-check;/, `proxy_pass http://127.0.0.1:${authStubPort};`);
    // Same log-path rewrite as the other real-nginx test, so this
    // unprivileged process can actually start nginx (not just -t it) — the
    // listen ports here are already high/unprivileged, so no port remap
    // is needed this time.
    config = config.replace(/\/var\/log\/nginx\//g, `${workDir}/`);

    const confPath = path.join(workDir, "nginx.conf");
    const full = `pid ${pidPath};\nevents {}\nhttp {\naccess_log ${workDir}/default-access.log;\nerror_log ${workDir}/default-error.log;\n${config}\n}\n`;
    writeFileSync(confPath, full, "utf-8");

    // Verify syntax first for a clearer failure than a silent daemon crash.
    execFileSync("nginx", ["-t", "-c", confPath], { stdio: "pipe" });

    nginxProc = spawn("nginx", ["-c", confPath, "-g", "daemon off;"], { stdio: "pipe" });
    await waitForPort(nginxPort);
  }, 15000);

  afterAll(() => {
    if (nginxProc && !nginxProc.killed) {
      nginxProc.kill("SIGTERM");
    } else if (existsSync(pidPath)) {
      try { execFileSync("kill", [readFileSync(pidPath, "utf-8").trim()]); } catch { /* already gone */ }
    }
    authStub?.close();
    backendStub?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns 401 when no API key is presented", async () => {
    const res = await httpGet(nginxPort, "/protected", { Host: "gw-auth-it.invalid" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for an unrecognized/forbidden key", async () => {
    const res = await httpGet(nginxPort, "/protected", { Host: "gw-auth-it.invalid", "X-Api-Key": "nonsense" });
    expect(res.status).toBe(403);
  });

  it("returns a real client-visible 429 for a rate-limited deny reason — not 403, not 500 (Correction 4)", async () => {
    const res = await httpGet(nginxPort, "/protected", { Host: "gw-auth-it.invalid", "X-Api-Key": "rate-limited-key" });
    expect(res.status).toBe(429);
  });

  it("returns a real client-visible 429 for a quota-exceeded deny reason", async () => {
    const res = await httpGet(nginxPort, "/protected", { Host: "gw-auth-it.invalid", "X-Api-Key": "quota-key" });
    expect(res.status).toBe(429);
  });

  it("proxies through to the real backend on a valid, authorized key", async () => {
    const res = await httpGet(nginxPort, "/protected", { Host: "gw-auth-it.invalid", "X-Api-Key": GOOD_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toBe("backend reached");
  });
});
