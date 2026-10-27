import { describe, it, expect } from "vitest";
import { generateNginxConfig, domainToFilename } from "../nginx-config";
import type { ProxyHost } from "@prisma/client";

function makeProxy(overrides: Partial<ProxyHost> = {}): ProxyHost {
  return {
    id: "p1",
    domain: "example.com",
    forwardScheme: "http",
    forwardHost: "10.0.0.5",
    forwardPort: 8080,
    listenPort: 80,
    httpsPort: 443,
    sslEnabled: false,
    forceHttps: false,
    http2: false,
    websocket: false,
    accessLog: true,
    errorLog: true,
    customLocations: null,
    customServer: null,
    customHeaders: null,
    status: "ACTIVE",
    enabled: true,
    configPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    certificateId: null,
    accessListId: null,
    ...overrides,
  } as ProxyHost;
}

describe("generateNginxConfig — access list default action", () => {
  it("appends 'deny all' for an allowlist (only allow rules, default deny)", () => {
    const config = generateNginxConfig({
      proxy: makeProxy(),
      certificate: null,
      accessList: {
        id: "al1",
        authEnabled: false,
        authRealm: "Restricted",
        defaultAction: "deny",
        authUsers: [],
        ipRules: [{ address: "1.2.3.4", action: "allow", sortOrder: 0 }],
      },
    });
    expect(config).toContain("allow 1.2.3.4;");
    expect(config).toContain("deny all;");
  });

  it("appends 'allow all' for a denylist (only deny rules, default allow) — regression for #10", () => {
    const config = generateNginxConfig({
      proxy: makeProxy(),
      certificate: null,
      accessList: {
        id: "al1",
        authEnabled: false,
        authRealm: "Restricted",
        defaultAction: "allow",
        authUsers: [],
        ipRules: [{ address: "9.9.9.9", action: "deny", sortOrder: 0 }],
      },
    });
    expect(config).toContain("deny 9.9.9.9;");
    expect(config).toContain("allow all;");
    // Must not fall back to the old hardcoded behavior that blocked everyone
    expect(config).not.toContain("deny all;");
  });

  it("applies no IP restriction when an access list has zero rules — auth-only lists must not be locked out", () => {
    const config = generateNginxConfig({
      proxy: makeProxy(),
      certificate: null,
      accessList: {
        id: "al1",
        authEnabled: true,
        authRealm: "Restricted",
        defaultAction: "deny",
        authUsers: [{ id: "u1", username: "admin" }],
        ipRules: [],
      },
    });
    expect(config).toContain("auth_basic ");
    expect(config).not.toContain("allow ");
    expect(config).not.toContain("deny ");
  });
});

describe("generateNginxConfig — custom 403 page", () => {
  it("omits the error_page directive when no custom 403 is configured", () => {
    const config = generateNginxConfig({ proxy: makeProxy(), certificate: null });
    expect(config).not.toContain("error_page 403");
  });

  it("adds error_page + internal location when enabled", () => {
    const config = generateNginxConfig({ proxy: makeProxy(), certificate: null, custom403Enabled: true });
    expect(config).toContain("error_page 403 /_rproxy_403.html;");
    expect(config).toContain("location = /_rproxy_403.html {");
    expect(config).toContain("internal;");
  });
});

describe("generateNginxConfig — custom directive validation", () => {
  it("rejects custom server directives that try to close the server block", () => {
    expect(() =>
      generateNginxConfig({
        proxy: makeProxy({ customServer: "return 200 'ok'; } server { listen 9999;" }),
        certificate: null,
      })
    ).toThrow(/blocked keywords/);
  });

  it("accepts a plain single-line custom directive", () => {
    const config = generateNginxConfig({
      proxy: makeProxy({ customServer: "add_header X-Test 'yes';" }),
      certificate: null,
    });
    expect(config).toContain("add_header X-Test 'yes';");
  });
});

describe("domainToFilename", () => {
  it("rejects path traversal attempts", () => {
    expect(() => domainToFilename("../../etc/passwd")).toThrow();
  });

  it("converts a wildcard domain to a safe filename", () => {
    expect(domainToFilename("*.example.com")).toBe("wildcard.example.com");
  });
});

describe("static websites", () => {
  const revision = "00000000-0000-0000-0000-000000000000";
  it("serves static files without an upstream and preserves access controls", () => {
    const config = generateNginxConfig({
      proxy: makeProxy({ hostType: "STATIC", staticRevision: revision }), certificate: null,
      accessList: { id: "al1", authEnabled: true, authRealm: "Private", defaultAction: "deny", authUsers: [{ id: "u1", username: "admin" }], ipRules: [{ address: "127.0.0.1", action: "allow", sortOrder: 0 }] },
    });
    expect(config).toContain(`/var/lib/rproxy/static-sites/p1/${revision}`);
    expect(config).toContain("try_files $uri $uri/ =404;");
    expect(config).toContain("auth_basic");
    expect(config).toContain("deny all;");
    expect(config).toContain("disable_symlinks on;");
    expect(config).toContain("location ~ /\\. { deny all; }");
    expect(config).not.toContain("proxy_pass");
    expect(config).not.toContain("upstream ");
  });
  it("supports SPA routing and handles empty sites", () => {
    expect(generateNginxConfig({ proxy: makeProxy({ hostType: "STATIC", staticRevision: revision, spaFallback: true }), certificate: null })).toContain("try_files $uri $uri/ /index.html;");
    expect(generateNginxConfig({ proxy: makeProxy({ hostType: "STATIC", staticRevision: null }), certificate: null })).toContain("return 503;");
  });
  it("rejects roots containing traversal or nginx injection", () => {
    expect(() => generateNginxConfig({ proxy: makeProxy({ hostType: "STATIC", staticRevision: "../../secret" }), certificate: null })).toThrow();
  });
  it("keeps ACME available when Force HTTPS has no certificate", () => {
    expect(generateNginxConfig({ proxy: makeProxy({ hostType: "STATIC", forceHttps: true }), certificate: null })).toContain("location ^~ /.well-known/acme-challenge/");
  });
});

describe("backup upstream", () => {
  it("renders a single plain server when no backup is set", () => {
    const config = generateNginxConfig({ proxy: makeProxy(), certificate: null });
    expect(config).toContain("    server 10.0.0.5:8080;\n}");
    expect(config).not.toContain("backup;");
    expect(config).toContain("proxy_connect_timeout 60s;");
  });

  it("adds a backup server with fast failover", () => {
    const config = generateNginxConfig({
      proxy: makeProxy({ backupHost: "10.0.0.6", backupPort: 8006 }), certificate: null,
    });
    expect(config).toContain("server 10.0.0.5:8080 max_fails=1 fail_timeout=15s;");
    expect(config).toContain("server 10.0.0.6:8006 backup;");
    expect(config).toContain("proxy_connect_timeout 3s;");
    expect(config).toContain("proxy_next_upstream error timeout http_502 http_503;");
  });

  it("rejects an invalid backup host", () => {
    expect(() => generateNginxConfig({
      proxy: makeProxy({ backupHost: "evil; include /etc/passwd", backupPort: 80 }), certificate: null,
    })).toThrow(/Invalid forward host/);
  });
});
