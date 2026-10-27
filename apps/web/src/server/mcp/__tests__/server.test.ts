import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Protocol-level test of the MCP surface over a real client/server pair:
// which tools each scope can see, and that the shared zod schemas reject bad
// input before any service (and therefore any nginx deploy) is reached.
// Prisma and the services are mocked — the services themselves are covered
// by their own tests and the nginx integration tests.

const prismaMock = vi.hoisted(() => ({
  proxyHost: { findUnique: vi.fn(), findMany: vi.fn() },
  streamHost: { findUnique: vi.fn() },
}));
const createProxy = vi.hoisted(() => vi.fn());
const toggleStream = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/server/services/proxy.service", () => ({ createProxy, updateProxy: vi.fn(), toggleProxy: vi.fn() }));
vi.mock("@/server/services/stream.service", () => ({ createStream: vi.fn(), updateStream: vi.fn(), toggleStream }));
vi.mock("@/server/services/redirect.service", () => ({}));
vi.mock("@/server/services/certificate.service", () => ({}));
vi.mock("@/server/services/access-list.service", () => ({}));
vi.mock("@/server/services/health.service", () => ({}));
vi.mock("@/server/services/api-gateway/route.service", () => ({}));

const { buildMcpServer } = await import("../server");

async function connect(scope: "READ" | "WRITE") {
  const server = buildMcpServer({ tokenId: "t1", userId: "u1", username: "agent", role: "ADMIN", scope }, "127.0.0.1");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("rproxy MCP server", () => {
  it("exposes only read tools to a READ token", async () => {
    const client = await connect("READ");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list_proxy_hosts");
    expect(names).toContain("whoami");
    expect(names.some((n) => n.startsWith("create_") || n.startsWith("update_") || n.startsWith("set_"))).toBe(false);
  });

  it("adds write tools for a WRITE token, and never any delete tool", async () => {
    const client = await connect("WRITE");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["create_proxy_host", "update_proxy_host", "create_gateway_route", "request_certificate"]));
    expect(names.some((n) => n.includes("delete"))).toBe(false);
  });

  it("whoami reports the principal", async () => {
    const client = await connect("READ");
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(JSON.parse(text(result))).toEqual({ username: "agent", role: "ADMIN", scope: "READ" });
  });

  it("rejects a blocked custom directive before reaching the service", async () => {
    const client = await connect("WRITE");
    const result = await client.callTool({
      name: "create_proxy_host",
      arguments: { domain: "app.example.com", forwardHost: "10.0.0.5", forwardPort: 8080, customServer: "include /etc/passwd;" },
    });
    expect(result.isError).toBe(true);
    expect(createProxy).not.toHaveBeenCalled();
  });

  it("refuses a duplicate domain", async () => {
    prismaMock.proxyHost.findUnique.mockResolvedValue({ id: "existing" });
    const client = await connect("WRITE");
    const result = await client.callTool({
      name: "create_proxy_host",
      arguments: { domain: "app.example.com", forwardHost: "10.0.0.5", forwardPort: 8080 },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/already exists/);
    expect(createProxy).not.toHaveBeenCalled();
  });

  it("creates a proxy with schema defaults applied and flags a failed nginx test as an error", async () => {
    prismaMock.proxyHost.findUnique.mockResolvedValue(null);
    createProxy.mockResolvedValue({ proxy: { id: "p1" }, deploy: { success: false, output: "nginx: [emerg] boom" } });
    const client = await connect("WRITE");
    const result = await client.callTool({
      name: "create_proxy_host",
      arguments: { domain: "app.example.com", forwardHost: "10.0.0.5", forwardPort: 8080 },
    });
    expect(createProxy).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "app.example.com", listenPort: 80, forwardScheme: "http" }),
      "u1"
    );
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("boom");
  });

  it("set_stream_host_enabled is a no-op when the state already matches", async () => {
    prismaMock.streamHost.findUnique.mockResolvedValue({ enabled: true });
    const client = await connect("WRITE");
    const result = await client.callTool({ name: "set_stream_host_enabled", arguments: { id: "s1", enabled: true } });
    expect(result.isError).toBeFalsy();
    expect(toggleStream).not.toHaveBeenCalled();
  });
});
