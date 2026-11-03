import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { setting: { findUnique: mocks.findUnique, upsert: mocks.upsert }, proxyHost: { findMany: mocks.findMany } } }));
vi.mock("@/lib/encrypt", () => ({ encryptJson: JSON.stringify, decryptJson: JSON.parse }));
import { createLocalDnsRecord, localDnsSchema, saveLocalDns, syncLocalDns, technitiumRequest } from "../local-dns.service";
const config = { serverUrl: "https://dns.example.com", apiToken: "secret", targetIp: "192.168.1.10", enabled: true };
function stored(enabled = true) { return { value: JSON.stringify({ config: JSON.stringify({ ...config, enabled }) }) }; }
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("local DNS", () => {
  it("does nothing when unconfigured or disabled", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(stored(false));
    expect(await createLocalDnsRecord("app.example.com")).toBeUndefined();
    expect(await createLocalDnsRecord("app.example.com")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("writes a local A record with form authentication and no token in URL", async () => {
    mocks.findUnique.mockResolvedValue(stored());
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }); vi.stubGlobal("fetch", fetch);
    expect(await createLocalDnsRecord("app.example.com")).toEqual({ created: true });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://dns.example.com/api/zones/records/add");
    expect(Object.fromEntries(init.body)).toMatchObject({ token: "secret", domain: "app.example.com", type: "A", ipAddress: "192.168.1.10", overwrite: "true" });
    expect(init.redirect).toBe("error");
  });
  it("reports failures without leaking upstream secrets or throwing", async () => {
    mocks.findUnique.mockResolvedValue(stored());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "error", errorMessage: "secret" }) }));
    await expect(technitiumRequest(config, "zones/records/add")).rejects.toThrow("Technitium request failed");
    const result = await createLocalDnsRecord("app.example.com");
    expect(result?.created).toBe(false); expect(result?.error).not.toContain("secret");
  });
  it("syncs all existing hosts and reports failed domains", async () => {
    mocks.findUnique.mockResolvedValue(stored());
    mocks.findMany.mockResolvedValue([{ domain: "a.example.com" }, { domain: "b.example.com" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ status: "ok" }) }).mockRejectedValueOnce(new Error("offline")));
    expect(await syncLocalDns()).toEqual({ synced: 1, errors: ["b.example.com"] });
  });
  it("rejects unsupported URLs and invalid IPv4 targets", () => {
    for (const serverUrl of ["file:///tmp/dns", "https://user:pass@dns.example.com", "https://dns.example.com?token=x"]) expect(localDnsSchema.safeParse({ ...config, serverUrl }).success).toBe(false);
    expect(localDnsSchema.safeParse({ ...config, targetIp: "::1" }).success).toBe(false);
  });
  it("persists through encrypted JSON storage", async () => {
    await saveLocalDns(config);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: "local_dns_integration", value: stored().value } }));
  });
});
