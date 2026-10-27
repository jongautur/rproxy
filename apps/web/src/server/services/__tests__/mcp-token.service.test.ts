import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashApiKey } from "@/lib/api-key";

const prismaMock = vi.hoisted(() => ({
  mcpToken: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { authenticateMcpToken, generateMcpToken } = await import("../mcp-token.service");

function row(overrides: Record<string, unknown> = {}, userOverrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    scope: "WRITE",
    tokenVersion: 3,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: new Date(),
    user: { id: "u1", username: "jon", role: "ADMIN", tokenVersion: 3, mustChangePassword: false, ...userOverrides },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.mcpToken.update.mockResolvedValue({});
});

describe("generateMcpToken", () => {
  it("produces an rpm_ token whose stored hash matches the plaintext", () => {
    const { plaintext, tokenPrefix, tokenHash } = generateMcpToken();
    expect(plaintext.startsWith(`${tokenPrefix}_`)).toBe(true);
    expect(tokenPrefix).toMatch(/^rpm_[0-9a-f]{8}$/);
    expect(tokenHash).toBe(hashApiKey(plaintext));
  });
});

describe("authenticateMcpToken", () => {
  it("looks the token up by hash and returns the principal", async () => {
    prismaMock.mcpToken.findUnique.mockResolvedValue(row());
    const principal = await authenticateMcpToken("rpm_abcd1234_secret");
    expect(prismaMock.mcpToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashApiKey("rpm_abcd1234_secret") } }));
    expect(principal).toEqual({ tokenId: "t1", userId: "u1", username: "jon", role: "ADMIN", scope: "WRITE" });
  });

  it("rejects non-rpm strings without a DB lookup", async () => {
    expect(await authenticateMcpToken("rpk_gateway_key")).toBeNull();
    expect(prismaMock.mcpToken.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", null],
    ["revoked", row({ revokedAt: new Date() })],
    ["expired", row({ expiresAt: new Date(Date.now() - 1000) })],
    ["stale tokenVersion", row({}, { tokenVersion: 4 })],
    ["user must change password", row({}, { mustChangePassword: true })],
  ])("returns null when %s", async (_label, value) => {
    prismaMock.mcpToken.findUnique.mockResolvedValue(value);
    expect(await authenticateMcpToken("rpm_abcd1234_secret")).toBeNull();
  });

  it("downgrades a WRITE token to READ once its user is no longer ADMIN", async () => {
    prismaMock.mcpToken.findUnique.mockResolvedValue(row({}, { role: "VIEWER" }));
    expect((await authenticateMcpToken("rpm_abcd1234_secret"))?.scope).toBe("READ");
  });

  it("throttles lastUsedAt writes", async () => {
    prismaMock.mcpToken.findUnique.mockResolvedValue(row({ lastUsedAt: new Date() }));
    await authenticateMcpToken("rpm_abcd1234_secret");
    expect(prismaMock.mcpToken.update).not.toHaveBeenCalled();

    prismaMock.mcpToken.findUnique.mockResolvedValue(row({ lastUsedAt: new Date(Date.now() - 120_000) }));
    await authenticateMcpToken("rpm_abcd1234_secret");
    expect(prismaMock.mcpToken.update).toHaveBeenCalledTimes(1);
  });
});
