import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxyHost } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), audit: vi.fn(), deploy: vi.fn(), stage: vi.fn(), rm: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  proxyHost: { findUniqueOrThrow: mocks.find, update: mocks.update },
  setting: { findUnique: vi.fn().mockResolvedValue(null) },
  auditLog: { create: mocks.audit },
} }));
vi.mock("@/server/services/cloudflare.service", () => ({}));
vi.mock("@/server/services/nginx-deploy.service", () => ({ deploySiteConfig: mocks.deploy }));
vi.mock("fs/promises", () => ({ rm: mocks.rm }));
vi.mock("@/server/static-sites", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/static-sites")>(), stageSite: mocks.stage,
}));
import { uploadStaticSite } from "../proxy.service";

const oldRevision = "00000000-0000-0000-0000-000000000000";
const newRevision = "11111111-1111-1111-1111-111111111111";
const proxy = {
  id: "host1", domain: "static.example.com", hostType: "STATIC", staticRevision: oldRevision,
  forwardHost: "localhost", forwardPort: 80, forwardScheme: "http",
  listenPort: 80, httpsPort: 443, enabled: true, certificateId: null, accessListId: null,
} as ProxyHost;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(proxy);
  mocks.stage.mockResolvedValue(newRevision);
  mocks.deploy.mockResolvedValue({ success: true, output: "ok" });
  mocks.update.mockResolvedValue({ ...proxy, staticRevision: newRevision });
});
describe("static site publishing", () => {
  it("publishes a fully staged version before recording it as current", async () => {
    const result = await uploadStaticSite(proxy.id, [], "admin1");
    expect(mocks.deploy.mock.calls[0]![0].config).toContain(newRevision);
    expect(mocks.stage.mock.invocationCallOrder[0]!).toBeLessThan(mocks.deploy.mock.invocationCallOrder[0]!);
    expect(result.proxy.staticRevision).toBe(newRevision);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ staticRevision: newRevision }) }));
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it("keeps the current revision and removes the candidate on deployment rejection", async () => {
    mocks.deploy.mockResolvedValue({ success: false, output: "bad config" });
    const result = await uploadStaticSite(proxy.id, [], "admin1");
    expect(result.proxy.staticRevision).toBe(oldRevision);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining(newRevision), { recursive: true, force: true });
  });
  it("does not deploy when staging fails", async () => {
    mocks.stage.mockRejectedValue(new Error("write failed"));
    await expect(uploadStaticSite(proxy.id, [], "admin1")).rejects.toThrow("write failed");
    expect(mocks.deploy).not.toHaveBeenCalled();
  });
  it("restores the previous config if recording the new revision fails", async () => {
    mocks.update.mockImplementation(async ({ data }) => {
      if (data.staticRevision === newRevision) throw new Error("database write failed");
      return proxy;
    });
    await expect(uploadStaticSite(proxy.id, [], "admin1")).rejects.toThrow("database write failed");
    expect(mocks.deploy).toHaveBeenCalledTimes(2);
    expect(mocks.deploy.mock.calls[1]![0].config).toContain(oldRevision);
    expect(mocks.rm).not.toHaveBeenCalled();
  });
  it("serializes uploads for the same host", async () => {
    let release!: () => void;
    mocks.stage.mockImplementationOnce(() => new Promise<string>(resolve => { release = () => resolve(newRevision); }));
    const first = uploadStaticSite(proxy.id, [], "admin1");
    const second = uploadStaticSite(proxy.id, [], "admin1");
    await vi.waitFor(() => expect(mocks.stage).toHaveBeenCalledTimes(1));
    expect(mocks.find).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(mocks.stage).toHaveBeenCalledTimes(2);
  });
});
