import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateNginxConfig } from "../nginx-config";
import { generateRedirectConfig } from "../redirect-config";
import { generateApiGatewayConfig } from "../api-gateway-config";
import type { ProxyHost, RedirectHost, Api, ApiRoute } from "@prisma/client";

// This is the "does the generator actually produce syntactically valid
// nginx config" check called for in the repo review — it shells out to a
// real `nginx -t`, so it only runs where nginx is installed (CI installs it
// via apt; see .github/workflows/ci.yml). It's a no-op (skipped) elsewhere
// rather than a hard failure, since requiring a system nginx install for
// `pnpm test` locally would be an unreasonable bar for a quick unit run.
//
// Computed synchronously at module scope (execFileSync is synchronous, so
// no beforeAll hook is needed) — describe.skipIf(...) below evaluates its
// condition immediately during test collection, before any beforeAll hook
// would run, so setting this flag inside a beforeAll (as an earlier version
// of this file did) meant skipIf always saw the initial `false` and the
// whole suite silently never ran, even where nginx was installed and on
// PATH (including in CI).
let nginxAvailable = false;
try {
  execFileSync("nginx", ["-v"], { stdio: "ignore" });
  nginxAvailable = true;
} catch {
  nginxAvailable = false;
}

// The API Gateway test case below uses authRequired: true routes, which
// makes generateApiGatewayConfig() require this — same pattern as
// jwt.test.ts, so this doesn't depend on `pnpm test` having .env.local
// sourced (CI sets it directly in the workflow env block).
beforeAll(() => {
  process.env.GATEWAY_AUTH_SECRET = "test-gateway-secret-not-used-in-production";
});

function runNginxT(body: string): { code: number; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "rproxy-nginx-it-"));
  const confPath = path.join(dir, "nginx.conf");
  // nginx -t validates the full config, not just syntax: it also opens
  // every referenced log file and the pid file. In production this check
  // always runs as root via `sudo nginx -t` (see testNginxConfig() in
  // nginx.ts) against the real, root-writable /var/log/nginx — but this
  // test invokes nginx directly as whatever unprivileged user runs `pnpm
  // test`, which can't create new files in that directory (mode 750,
  // root:adm). Since what this test actually needs to verify is that the
  // generator's *syntax and structure* is valid nginx — not that this
  // particular local user can write to production log paths — redirect the
  // generators' hardcoded /var/log/nginx/* log lines into this temp dir,
  // and give it a pid path in the same place.
  const withWritablePaths = body
    .replace(/\/var\/log\/nginx\//g, `${dir}/`)
    // `nginx -t` doesn't just parse syntax — it also opens (binds) every
    // declared listen socket to catch real startup failures, the same way
    // an actual `nginx -s reload` would. Ports 80/443 (redirect-config.ts
    // hardcodes these — RedirectHost has no configurable listen port,
    // unlike ProxyHost/Api) need a privileged bind this unprivileged test
    // process doesn't have; production always tests as root via `sudo
    // nginx -t`. Remap to unprivileged ports for this structural check —
    // the port number itself isn't what's under test here.
    .replace(/\blisten\s+(\[::\]:)?80\b/g, (_m, v6: string | undefined) => `listen ${v6 ?? ""}18080`)
    .replace(/\blisten\s+(\[::\]:)?443\b/g, (_m, v6: string | undefined) => `listen ${v6 ?? ""}18443`);
  // A generator that emits no access_log/error_log directive of its own
  // (redirect-config.ts, for instance) falls through to nginx's compiled-in
  // default (/var/log/nginx/access.log on Debian/Ubuntu builds) — same
  // unwritable-to-this-user path. Declaring writable defaults at the http
  // level covers that case; any generator's own access_log/error_log line
  // inside its server block still overrides these as usual.
  const httpDefaults = `access_log ${dir}/default-access.log;\nerror_log ${dir}/default-error.log;`;
  writeFileSync(
    confPath,
    `pid ${path.join(dir, "nginx.pid")};\nevents {}\nhttp {\n${httpDefaults}\n${withWritablePaths}\n}\n`,
    "utf-8"
  );
  try {
    const output = execFileSync("nginx", ["-t", "-c", confPath], { encoding: "utf-8", stdio: "pipe" });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
    return {
      code: err.status ?? 1,
      output: [err.stdout, err.stderr].map(String).join("\n"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!nginxAvailable)("nginx config integration", () => {
  it("generates a proxy host config that passes `nginx -t`", () => {
    const proxy = {
      id: "p1",
      domain: "example.com",
      forwardScheme: "http",
      forwardHost: "127.0.0.1",
      forwardPort: 8080,
      listenPort: 8081,
      httpsPort: 8443,
      sslEnabled: false,
      forceHttps: false,
      http2: false,
      websocket: true,
      accessLog: false,
      errorLog: false,
      customLocations: null,
      customServer: null,
      customHeaders: JSON.stringify({ "X-Test": "1" }),
      status: "ACTIVE",
      enabled: true,
      configPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      certificateId: null,
      accessListId: null,
    } as ProxyHost;

    const config = generateNginxConfig({ proxy, certificate: null });
    const result = runNginxT(config);
    expect(result.code, result.output).toBe(0);
  });

  it("generates a redirect host config that passes `nginx -t`", () => {
    const redirect = {
      id: "r1",
      sourceDomain: "old.example.com",
      destination: "https://new.example.com",
      redirectCode: 301,
      preservePath: true,
      sslEnabled: false,
      status: "ACTIVE",
      enabled: true,
      configPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      certificateId: null,
      accessListId: null,
    } as RedirectHost;

    const config = generateRedirectConfig({ redirect, certificate: null });
    const result = runNginxT(config);
    expect(result.code, result.output).toBe(0);
  });

  it("generates an API Gateway config (multi-route, mixed methods, basePath) that passes `nginx -t`", () => {
    const api = {
      id: "gw1",
      name: "Geocoding API",
      domain: "api.example.com",
      basePath: "/api",
      description: null,
      listenPort: 8082,
      httpsPort: 8444,
      sslEnabled: false,
      maxRequestsPerSecond: null,
      maxBodySizeMb: 10,
      corsEnabled: false,
      status: "ACTIVE",
      enabled: true,
      configPath: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      certificateId: null,
    } as Api;

    // IPs, not hostnames — a bare `proxy_pass http://host:port;` with a
    // non-IP host has no resolver configured here, so nginx -t resolves it
    // eagerly at load time and fails with "host not found" for anything
    // that isn't in this sandbox's DNS/hosts (same reason the proxy-host
    // test above uses "10.0.0.5" rather than a real hostname).
    const routes = [
      {
        id: "rt1",
        apiId: "gw1",
        path: "/v1/geocode/search",
        methods: ["GET"],
        upstreamScheme: "http",
        upstreamHost: "10.0.0.5",
        upstreamPort: 8080,
        upstreamPath: "/search",
        authRequired: true,
        maxRequestsPerSecond: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "rt2",
        apiId: "gw1",
        path: "/v1/geocode/reverse",
        methods: [],
        upstreamScheme: "http",
        upstreamHost: "10.0.0.5",
        upstreamPort: 8080,
        upstreamPath: null,
        authRequired: true,
        maxRequestsPerSecond: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as ApiRoute[];

    const config = generateApiGatewayConfig({ api, routes, certificate: null });
    const result = runNginxT(config);
    expect(result.code, result.output).toBe(0);
  });
});
