import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-key";
import type { McpTokenScope, Role } from "@prisma/client";

// Bearer tokens for /api/mcp. Same shape and hashing as API Gateway keys
// (lib/api-key.ts — see its header comment for why SHA-256 and not bcrypt),
// with a distinct "rpm_" label so a leaked token is recognisable as an
// rproxy management credential rather than a gateway customer key.

const PREFIX_LABEL = "rpm";
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

export interface McpTokenPublic {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: McpTokenScope;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface McpPrincipal {
  tokenId: string;
  userId: string;
  username: string;
  role: Role;
  // Effective scope: a WRITE token whose user is no longer ADMIN is
  // downgraded to READ here rather than rejected outright, so read-only
  // agents keep working through a demotion.
  scope: McpTokenScope;
}

const publicSelect = {
  id: true,
  name: true,
  tokenPrefix: true,
  scope: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

export function generateMcpToken(): { plaintext: string; tokenPrefix: string; tokenHash: string } {
  const tokenPrefix = `${PREFIX_LABEL}_${randomBytes(4).toString("hex")}`;
  const plaintext = `${tokenPrefix}_${randomBytes(24).toString("base64url")}`;
  return { plaintext, tokenPrefix, tokenHash: hashApiKey(plaintext) };
}

export async function listMcpTokens(userId: string): Promise<McpTokenPublic[]> {
  return prisma.mcpToken.findMany({
    where: { userId },
    select: publicSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function createMcpToken(
  user: { id: string; role: Role },
  data: { name: string; scope: McpTokenScope; expiresInDays?: number },
  ipAddress?: string
): Promise<{ token: McpTokenPublic; plaintext: string }> {
  if (data.scope === "WRITE" && user.role !== "ADMIN") {
    throw new Error("Forbidden");
  }

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { tokenVersion: true } });
  const { plaintext, tokenPrefix, tokenHash } = generateMcpToken();
  const expiresAt = data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null;

  const token = await prisma.mcpToken.create({
    data: {
      userId: user.id,
      name: data.name,
      tokenPrefix,
      tokenHash,
      scope: data.scope,
      tokenVersion: dbUser.tokenVersion,
      expiresAt,
    },
    select: publicSelect,
  });

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "CREATE",
      entity: "McpToken",
      entityId: token.id,
      details: JSON.stringify({ name: token.name, prefix: token.tokenPrefix, scope: token.scope }),
      ipAddress,
    },
  });

  return { token, plaintext };
}

export async function revokeMcpToken(userId: string, tokenId: string, ipAddress?: string): Promise<McpTokenPublic> {
  const existing = await prisma.mcpToken.findUnique({ where: { id: tokenId } });
  if (!existing || existing.userId !== userId) throw new Error("Not found");

  const token = await prisma.mcpToken.update({
    where: { id: tokenId },
    data: { revokedAt: existing.revokedAt ?? new Date() },
    select: publicSelect,
  });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "McpToken", entityId: tokenId, details: JSON.stringify({ prefix: token.tokenPrefix }), ipAddress },
  });

  return token;
}

// Returns null for every failure mode (unknown, revoked, expired, stale
// tokenVersion, malformed) — the caller answers all of them with the same
// 401 so the response doesn't reveal which check failed.
export async function authenticateMcpToken(plaintext: string): Promise<McpPrincipal | null> {
  if (!plaintext.startsWith(`${PREFIX_LABEL}_`) || plaintext.length > 128) return null;

  const token = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashApiKey(plaintext) },
    include: { user: { select: { id: true, username: true, role: true, tokenVersion: true, mustChangePassword: true } } },
  });
  if (!token) return null;
  if (token.revokedAt) return null;
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;
  if (token.user.tokenVersion !== token.tokenVersion) return null;
  if (token.user.mustChangePassword) return null;

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    await prisma.mcpToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }

  return {
    tokenId: token.id,
    userId: token.user.id,
    username: token.user.username,
    role: token.user.role,
    scope: token.scope === "WRITE" && token.user.role === "ADMIN" ? "WRITE" : "READ",
  };
}
