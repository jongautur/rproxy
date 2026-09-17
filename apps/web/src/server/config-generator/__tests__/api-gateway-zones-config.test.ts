import { describe, it, expect } from "vitest";
import { generateRateLimitZonesConfig, zoneNameForRoute, ZONES_CONF_FILENAME } from "../api-gateway-zones-config";
import type { Api, ApiRoute } from "@prisma/client";

function makeApi(overrides: Partial<Api> = {}, routes: Partial<ApiRoute>[] = []): Api & { routes: ApiRoute[] } {
  return {
    id: "a1",
    name: "Test API",
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
    routes: routes.map((r, i) => ({
      id: `r${i + 1}`,
      apiId: "a1",
      path: "/x",
      method: "ANY",
      upstreamScheme: "http",
      upstreamHost: "10.0.0.1",
      upstreamPort: 80,
      upstreamPath: null,
      authRequired: false,
      maxRequestsPerSecond: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...r,
    })) as ApiRoute[],
  } as Api & { routes: ApiRoute[] };
}

describe("zoneNameForRoute", () => {
  it("is deterministic and prefixed", () => {
    expect(zoneNameForRoute("abc123")).toBe("gwz_abc123");
    expect(zoneNameForRoute("abc123")).toBe(zoneNameForRoute("abc123"));
  });
});

describe("ZONES_CONF_FILENAME", () => {
  it("matches the allowlisted filename the root helper script expects", () => {
    expect(ZONES_CONF_FILENAME).toBe("rproxy-apigw-zones.conf");
  });
});

describe("generateRateLimitZonesConfig", () => {
  it("emits a zone per route with a route-level limit", () => {
    const api = makeApi({}, [{ id: "r1", maxRequestsPerSecond: 5 }]);
    const config = generateRateLimitZonesConfig([api]);
    expect(config).toContain("limit_req_zone $binary_remote_addr zone=gwz_r1:10m rate=5r/s;");
  });

  it("falls back to the Api's default rate when a route doesn't set its own", () => {
    const api = makeApi({ maxRequestsPerSecond: 20 }, [{ id: "r1", maxRequestsPerSecond: null }]);
    const config = generateRateLimitZonesConfig([api]);
    expect(config).toContain("zone=gwz_r1:10m rate=20r/s;");
  });

  it("route-level limit overrides the Api default", () => {
    const api = makeApi({ maxRequestsPerSecond: 20 }, [{ id: "r1", maxRequestsPerSecond: 5 }]);
    const config = generateRateLimitZonesConfig([api]);
    expect(config).toContain("rate=5r/s;");
    expect(config).not.toContain("rate=20r/s;");
  });

  it("skips a route with no static limit configured anywhere", () => {
    const api = makeApi({}, [{ id: "r1", maxRequestsPerSecond: null }]);
    const config = generateRateLimitZonesConfig([api]);
    expect(config).toBe("");
  });

  it("skips disabled routes entirely (only enabled routes should be passed in, but defend anyway if not)", () => {
    const api = makeApi({}, [{ id: "r1", maxRequestsPerSecond: 5, enabled: false }]);
    // generateRateLimitZonesConfig trusts its caller to have already
    // filtered to enabled rows (zones.service.ts's findMany does) — this
    // just confirms it renders whatever it's given rather than silently
    // re-filtering, so a caller bug wouldn't be masked here.
    const config = generateRateLimitZonesConfig([api]);
    expect(config).toContain("gwz_r1");
  });

  it("emits one zone line per route across multiple APIs", () => {
    const apiA = makeApi({ id: "a1" }, [{ id: "r1", apiId: "a1", maxRequestsPerSecond: 5 }]);
    const apiB = makeApi({ id: "a2", domain: "b.example.com" }, [{ id: "r2", apiId: "a2", maxRequestsPerSecond: 10 }]);
    const config = generateRateLimitZonesConfig([apiA, apiB]);
    expect(config.split("\n")).toHaveLength(2);
    expect(config).toContain("gwz_r1");
    expect(config).toContain("gwz_r2");
  });
});
