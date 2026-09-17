import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const resolve4Mock = vi.hoisted(() => vi.fn());

vi.mock("dns", () => {
  class MockResolver {
    setServers = vi.fn();
    resolve4 = resolve4Mock;
  }
  return { Resolver: MockResolver };
});

import { matchZoneForDomain, getPublicIp, waitForDnsPropagation } from "../cloudflare.service";

describe("matchZoneForDomain", () => {
  const zones = [
    { id: "z1", name: "example.com" },
    { id: "z2", name: "other.org" },
  ];

  it("matches an apex domain directly", () => {
    expect(matchZoneForDomain("example.com", zones)).toEqual(zones[0]);
  });

  it("matches a subdomain by walking up to the registrable zone", () => {
    expect(matchZoneForDomain("app.example.com", zones)).toEqual(zones[0]);
    expect(matchZoneForDomain("deep.sub.example.com", zones)).toEqual(zones[0]);
  });

  it("returns null when no zone matches", () => {
    expect(matchZoneForDomain("unrelated.net", zones)).toBeNull();
  });

  it("does not match a domain that merely shares a suffix without a label boundary", () => {
    // "notexample.com" must not match zone "example.com"
    expect(matchZoneForDomain("notexample.com", zones)).toBeNull();
  });
});

describe("getPublicIp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the ip= line from the Cloudflare trace response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("fl=1\nip=203.0.113.7\nts=123\n"),
    }));
    await expect(getPublicIp()).resolves.toBe("203.0.113.7");
  });

  it("throws if the response has no ip= line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("fl=1\nts=123\n"),
    }));
    await expect(getPublicIp()).rejects.toThrow();
  });

  it("throws when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve("") }));
    await expect(getPublicIp()).rejects.toThrow();
  });
});

describe("waitForDnsPropagation", () => {
  beforeEach(() => {
    resolve4Mock.mockReset();
  });

  it("returns true immediately when the first lookup already matches", async () => {
    resolve4Mock.mockImplementation((_domain: string, cb: (err: Error | null, addrs?: string[]) => void) => cb(null, ["203.0.113.7"]));
    const result = await waitForDnsPropagation("example.com", "203.0.113.7", { intervalMs: 10, timeoutMs: 50 });
    expect(result).toBe(true);
    expect(resolve4Mock).toHaveBeenCalledTimes(1);
  });

  it("returns true once a later poll matches", async () => {
    let call = 0;
    resolve4Mock.mockImplementation((_domain: string, cb: (err: Error | null, addrs?: string[]) => void) => {
      call++;
      if (call < 3) return cb(null, ["198.51.100.1"]);
      return cb(null, ["203.0.113.7"]);
    });
    const result = await waitForDnsPropagation("example.com", "203.0.113.7", { intervalMs: 10, timeoutMs: 200 });
    expect(result).toBe(true);
    expect(call).toBe(3);
  });

  it("returns false after the timeout when the IP never matches", async () => {
    resolve4Mock.mockImplementation((_domain: string, cb: (err: Error | null, addrs?: string[]) => void) => cb(null, ["198.51.100.1"]));
    const result = await waitForDnsPropagation("example.com", "203.0.113.7", { intervalMs: 10, timeoutMs: 25 });
    expect(result).toBe(false);
  });

  it("treats resolver errors (e.g. NXDOMAIN) as not-yet-propagated and keeps polling", async () => {
    let call = 0;
    resolve4Mock.mockImplementation((_domain: string, cb: (err: Error | null, addrs?: string[]) => void) => {
      call++;
      if (call === 1) return cb(new Error("NXDOMAIN"));
      return cb(null, ["203.0.113.7"]);
    });
    const result = await waitForDnsPropagation("example.com", "203.0.113.7", { intervalMs: 10, timeoutMs: 200 });
    expect(result).toBe(true);
  });
});
