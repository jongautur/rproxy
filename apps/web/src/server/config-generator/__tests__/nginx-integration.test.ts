import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateNginxConfig } from "../nginx-config";
import { generateRedirectConfig } from "../redirect-config";
import type { ProxyHost, RedirectHost } from "@prisma/client";

// This is the "does the generator actually produce syntactically valid
// nginx config" check called for in the repo review — it shells out to a
// real `nginx -t`, so it only runs where nginx is installed (CI installs it
// via apt; see .github/workflows/ci.yml). It's a no-op (skipped) elsewhere
// rather than a hard failure, since requiring a system nginx install for
// `pnpm test` locally would be an unreasonable bar for a quick unit run.
let nginxAvailable = false;
beforeAll(() => {
  try {
    execFileSync("nginx", ["-v"], { stdio: "ignore" });
    nginxAvailable = true;
  } catch {
    nginxAvailable = false;
  }
});

function runNginxT(body: string): { code: number; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "rproxy-nginx-it-"));
  const confPath = path.join(dir, "nginx.conf");
  writeFileSync(confPath, `events {}\nhttp {\n${body}\n}\n`, "utf-8");
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
});
