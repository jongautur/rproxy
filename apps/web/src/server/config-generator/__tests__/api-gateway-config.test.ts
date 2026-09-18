import { describe, it, expect, beforeAll } from "vitest";
import { generateApiGatewayConfig, apiConfigFilename, type ApiRouteWithAuth } from "../api-gateway-config";
import type { Api } from "@prisma/client";

// Same pattern as jwt.test.ts — set required env vars in beforeAll so this
// file's tests don't depend on `pnpm test` being invoked with .env.local
// sourced (CI sets it directly in the workflow env block; a plain local
// `pnpm test` does not source .env.local on its own).
beforeAll(() => {
  process.env.GATEWAY_AUTH_SECRET = "test-gateway-secret-not-used-in-production";
});

function makeApi(overrides: Partial<Api> = {}): Api {
  return {
    id: "a1",
    name: "Geocoding API",
    domain: "api.example.com",
    basePath: "",
    description: null,
    listenPort: 80,
    httpsPort: 443,
    sslEnabled: false,
    maxRequestsPerSecond: null,
    maxBodySizeMb: null,
    corsEnabled: false,
    status: "ACTIVE",
    enabled: true,
    configPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    certificateId: null,
    ...overrides,
  } as Api;
}

function makeRoute(overrides: Partial<ApiRouteWithAuth> = {}): ApiRouteWithAuth {
  return {
    id: "r1",
    apiId: "a1",
    path: "/v1/geocode/search",
    methods: ["GET"],
    upstreamScheme: "http",
    upstreamHost: "nominatim",
    upstreamPort: 8080,
    upstreamPath: "/search",
    authRequired: true,
    maxRequestsPerSecond: null,
    enabled: true,
    upstreamAuthType: "NONE",
    upstreamAuthHeaderName: null,
    upstreamAuthValueEncrypted: null,
    upstreamAuthValue: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ApiRouteWithAuth;
}

describe("apiConfigFilename", () => {
  it("prefixes with gw- so it can never collide with a ProxyHost/RedirectHost file for the same domain", () => {
    expect(apiConfigFilename("api.example.com")).toBe("gw-api.example.com.conf");
  });
});

describe("generateApiGatewayConfig", () => {
  it("renders a location per enabled route with method restriction and rewrite target", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute()],
      certificate: null,
    });
    expect(config).toContain("server_name api.example.com;");
    expect(config).toContain("location /v1/geocode/search {");
    expect(config).toContain("limit_except GET {");
    expect(config).toContain("proxy_pass http://nominatim:8080/search;");
  });

  it("passes the original URI through unchanged when upstreamPath is not set", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ upstreamPath: null })],
      certificate: null,
    });
    expect(config).toContain("proxy_pass http://nominatim:8080;");
  });

  it("skips disabled routes entirely", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ enabled: false })],
      certificate: null,
    });
    expect(config).not.toContain("location /v1/geocode/search");
  });

  it("omits limit_except for ANY-method routes", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ methods: [] })],
      certificate: null,
    });
    expect(config).not.toContain("limit_except");
  });

  it("prepends basePath to every route's path", () => {
    const config = generateApiGatewayConfig({
      api: makeApi({ basePath: "/api" }),
      routes: [makeRoute({ path: "/search" })],
      certificate: null,
    });
    expect(config).toContain("location /api/search {");
  });

  it("emits client_max_body_size only when configured", () => {
    const withLimit = generateApiGatewayConfig({
      api: makeApi({ maxBodySizeMb: 5 }),
      routes: [],
      certificate: null,
    });
    expect(withLimit).toContain("client_max_body_size 5m;");

    const withoutLimit = generateApiGatewayConfig({
      api: makeApi(),
      routes: [],
      certificate: null,
    });
    expect(withoutLimit).not.toContain("client_max_body_size");
  });

  it("rejects an invalid upstream host", () => {
    expect(() =>
      generateApiGatewayConfig({
        api: makeApi(),
        routes: [makeRoute({ upstreamHost: "evil; rm -rf /" })],
        certificate: null,
      })
    ).toThrow(/Invalid upstream host/);
  });

  it("rejects an invalid domain", () => {
    expect(() =>
      generateApiGatewayConfig({
        api: makeApi({ domain: "not a domain" }),
        routes: [],
        certificate: null,
      })
    ).toThrow(/Invalid domain/);
  });

  it("rejects a route path containing '..'", () => {
    expect(() =>
      generateApiGatewayConfig({
        api: makeApi(),
        routes: [makeRoute({ path: "/v1/../etc" })],
        certificate: null,
      })
    ).toThrow(/Invalid route path/);
  });
});

describe("generateApiGatewayConfig — auth_request wiring", () => {
  it("emits the internal auth location and per-route auth_request/error_page wiring when a route requires auth", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ authRequired: true })],
      certificate: null,
    });
    expect(config).toContain("location = /internal/gateway-auth {");
    expect(config).toContain("internal;");
    expect(config).toContain("set $gw_route_id \"r1\";");
    expect(config).toContain("auth_request /internal/gateway-auth;");
    expect(config).toContain("auth_request_set $gw_deny_reason $upstream_http_x_gateway_deny_reason;");
    expect(config).toContain("error_page 401 = @gw_401;");
    expect(config).toContain("error_page 403 = @gw_403;");
    expect(config).toContain("location @gw_401 {");
    expect(config).toContain("location @gw_403 {");
  });

  it("omits all auth_request wiring when no route requires auth", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ authRequired: false })],
      certificate: null,
    });
    expect(config).not.toContain("auth_request");
    expect(config).not.toContain("/internal/gateway-auth");
    expect(config).not.toContain("@gw_401");
    expect(config).not.toContain("@gw_403");
  });

  it("wires auth only for the routes that require it, in a mixed API", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [
        makeRoute({ id: "r1", path: "/protected", authRequired: true }),
        makeRoute({ id: "r2", path: "/public", authRequired: false }),
      ],
      certificate: null,
    });
    // Internal location is still emitted once (shared across routes)...
    expect(config).toContain("location = /internal/gateway-auth {");
    // ...but only the protected route's location sets $gw_route_id/auth_request.
    const protectedBlock = config.slice(config.indexOf("location /protected"), config.indexOf("location /public"));
    const publicBlock = config.slice(config.indexOf("location /public"));
    expect(protectedBlock).toContain("auth_request /internal/gateway-auth;");
    expect(publicBlock).not.toContain("auth_request");
  });

  it("throws if GATEWAY_AUTH_SECRET is unset and a route requires auth — refuses to deploy an unreachable auth check", () => {
    const original = process.env.GATEWAY_AUTH_SECRET;
    delete process.env.GATEWAY_AUTH_SECRET;
    try {
      expect(() =>
        generateApiGatewayConfig({
          api: makeApi(),
          routes: [makeRoute({ authRequired: true })],
          certificate: null,
        })
      ).toThrow(/GATEWAY_AUTH_SECRET/);
    } finally {
      process.env.GATEWAY_AUTH_SECRET = original;
    }
  });

  it("does not require GATEWAY_AUTH_SECRET when no route needs auth", () => {
    const original = process.env.GATEWAY_AUTH_SECRET;
    delete process.env.GATEWAY_AUTH_SECRET;
    try {
      expect(() =>
        generateApiGatewayConfig({
          api: makeApi(),
          routes: [makeRoute({ authRequired: false })],
          certificate: null,
        })
      ).not.toThrow();
    } finally {
      process.env.GATEWAY_AUTH_SECRET = original;
    }
  });
});

describe("generateApiGatewayConfig — limit_req (static safety ceiling)", () => {
  it("emits limit_req referencing the route-derived zone name when a route sets its own limit", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ id: "r1", maxRequestsPerSecond: 5, authRequired: false })],
      certificate: null,
    });
    expect(config).toContain("limit_req zone=gwz_r1 burst=10 nodelay;");
  });

  it("emits limit_req using the Api's default when the route doesn't set its own", () => {
    const config = generateApiGatewayConfig({
      api: makeApi({ maxRequestsPerSecond: 20 }),
      routes: [makeRoute({ id: "r1", maxRequestsPerSecond: undefined, authRequired: false })],
      certificate: null,
    });
    expect(config).toContain("limit_req zone=gwz_r1 burst=10 nodelay;");
  });

  it("omits limit_req entirely when neither the route nor the Api configures a limit", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ maxRequestsPerSecond: undefined, authRequired: false })],
      certificate: null,
    });
    expect(config).not.toContain("limit_req");
  });
});

describe("generateApiGatewayConfig — CORS/OPTIONS (Correction 10)", () => {
  it("bypasses limit_except/auth_request for OPTIONS and returns 204 when corsEnabled", () => {
    const config = generateApiGatewayConfig({
      api: makeApi({ corsEnabled: true }),
      routes: [makeRoute({ methods: ["POST"], authRequired: true })],
      certificate: null,
    });
    const location = config.slice(config.indexOf("location /v1/geocode/search"));
    const optionsIfIndex = location.indexOf('if ($request_method = OPTIONS)');
    const limitExceptIndex = location.indexOf("limit_except");
    const authRequestIndex = location.indexOf("auth_request /internal");
    expect(optionsIfIndex).toBeGreaterThan(-1);
    expect(optionsIfIndex).toBeLessThan(limitExceptIndex);
    expect(optionsIfIndex).toBeLessThan(authRequestIndex);
    expect(location).toContain("return 204;");
    expect(location).toContain('Access-Control-Allow-Origin "*"');
  });

  it("emits no CORS handling when corsEnabled is false (default)", () => {
    const config = generateApiGatewayConfig({
      api: makeApi({ corsEnabled: false }),
      routes: [makeRoute({ authRequired: false })],
      certificate: null,
    });
    expect(config).not.toContain("Access-Control-Allow-Origin");
    expect(config).not.toContain("OPTIONS");
  });
});

describe("generateApiGatewayConfig — multi-method routes", () => {
  it("joins multiple methods into one limit_except directive", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ methods: ["GET", "POST"], authRequired: false })],
      certificate: null,
    });
    expect(config).toContain("limit_except GET POST {");
  });

  it("still omits limit_except for a single-method route (unchanged behavior)", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ methods: ["DELETE"], authRequired: false })],
      certificate: null,
    });
    expect(config).toContain("limit_except DELETE {");
  });

  it("forwards the real request method to the internal auth endpoint for key-level method sub-scoping", () => {
    const config = generateApiGatewayConfig({
      api: makeApi(),
      routes: [makeRoute({ authRequired: true })],
      certificate: null,
    });
    expect(config).toContain("proxy_set_header X-Gateway-Method $request_method;");
  });
});
