import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  listZones: vi.fn(),
  listARecords: vi.fn(),
  upsertARecord: vi.fn(),
  getPublicIp: vi.fn(),
  prismaUpdate: vi.fn(),
}));

vi.mock("@/server/services/cloudflare.service", () => ({
  getIntegration: mocks.getIntegration,
  listZones: mocks.listZones,
  listARecords: mocks.listARecords,
  upsertARecord: mocks.upsertARecord,
  getPublicIp: mocks.getPublicIp,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { cloudflareIntegration: { update: mocks.prismaUpdate } },
}));

import { runDdnsSweep } from "../ddns.service";

describe("runDdnsSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when not configured", async () => {
    mocks.getIntegration.mockResolvedValue(null);
    const result = await runDdnsSweep();
    expect(result).toEqual({ skipped: "not configured" });
    expect(mocks.getPublicIp).not.toHaveBeenCalled();
  });

  it("skips when DDNS is disabled", async () => {
    mocks.getIntegration.mockResolvedValue({ apiToken: "t", ddnsEnabled: false, autoDnsEnabled: false, lastPublicIp: "1.2.3.4" });
    const result = await runDdnsSweep();
    expect(result).toEqual({ skipped: "not configured" });
  });

  it("sets a baseline on the first run without touching any zone", async () => {
    mocks.getIntegration.mockResolvedValue({ apiToken: "t", ddnsEnabled: true, autoDnsEnabled: false, lastPublicIp: null });
    mocks.getPublicIp.mockResolvedValue("203.0.113.1");
    const result = await runDdnsSweep();
    expect(result).toEqual({ skipped: "baseline set" });
    expect(mocks.listZones).not.toHaveBeenCalled();
    expect(mocks.prismaUpdate).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { lastPublicIp: "203.0.113.1", lastCheckedAt: expect.any(Date) },
    });
  });

  it("skips zone calls when the IP is unchanged", async () => {
    mocks.getIntegration.mockResolvedValue({ apiToken: "t", ddnsEnabled: true, autoDnsEnabled: false, lastPublicIp: "203.0.113.1" });
    mocks.getPublicIp.mockResolvedValue("203.0.113.1");
    const result = await runDdnsSweep();
    expect(result).toEqual({ skipped: "unchanged" });
    expect(mocks.listZones).not.toHaveBeenCalled();
  });

  it("updates only the A records that pointed at the previous IP", async () => {
    mocks.getIntegration.mockResolvedValue({ apiToken: "t", ddnsEnabled: true, autoDnsEnabled: false, lastPublicIp: "203.0.113.1" });
    mocks.getPublicIp.mockResolvedValue("203.0.113.99");
    mocks.listZones.mockResolvedValue([{ id: "z1", name: "example.com" }]);
    mocks.listARecords.mockResolvedValue([
      { id: "r1", name: "example.com", content: "203.0.113.1", type: "A" },
      { id: "r2", name: "other.example.com", content: "198.51.100.5", type: "A" },
    ]);
    mocks.upsertARecord.mockResolvedValue({ id: "r1" });

    const result = await runDdnsSweep();

    expect(mocks.upsertARecord).toHaveBeenCalledTimes(1);
    expect(mocks.upsertARecord).toHaveBeenCalledWith("t", "z1", "example.com", "203.0.113.99");
    expect(result).toEqual({ ip: "203.0.113.99", updatedRecords: ["example.com"] });
  });
});
