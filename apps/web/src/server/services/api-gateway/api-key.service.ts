import { prisma } from "@/lib/prisma";
import { generateApiKeyPair } from "@/lib/api-key";
import type { ApiKeyPublic, ApiKeyWithPlaintext } from "@/types/api-gateway";
import { Prisma, type ApiKey, type ApiRouteMethod } from "@prisma/client";

function toPublic(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    customerId: key.customerId,
    label: key.label,
    keyPrefix: key.keyPrefix,
    enabled: key.enabled,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    scopeRestricted: key.scopeRestricted,
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
  };
}

export async function listApiKeys(customerId: string): Promise<ApiKeyPublic[]> {
  const keys = await prisma.apiKey.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
  });
  return keys.map(toPublic);
}

// Returns the plaintext key exactly once — callers must never persist or
// log it. Retries on the vanishingly unlikely event of a prefix collision
// (24 bytes of secret entropy makes a hash collision practically
// impossible, but the prefix alone is only 4 bytes / 8 hex chars).
export async function generateApiKey(
  customerId: string,
  label: string,
  expiresAt: Date | undefined,
  userId: string
): Promise<ApiKeyWithPlaintext> {
  await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

  for (let attempt = 0; attempt < 5; attempt++) {
    const generated = generateApiKeyPair();
    try {
      const apiKey = await prisma.apiKey.create({
        data: {
          customerId,
          label,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
          expiresAt,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: "CREATE",
          entity: "ApiKey",
          entityId: apiKey.id,
          details: JSON.stringify({ customerId, keyPrefix: apiKey.keyPrefix }),
        },
      });

      return { apiKey: toPublic(apiKey), plaintextKey: generated.plaintext };
    } catch (e) {
      const isUniqueConflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!isUniqueConflict || attempt === 4) throw e;
    }
  }
  throw new Error("Failed to generate a unique API key after several attempts");
}

// Temporary pause/resume — reversible, unlike revoke below.
export async function toggleApiKey(customerId: string, keyId: string, enabled: boolean, userId: string): Promise<ApiKeyPublic> {
  const existing = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  const apiKey = await prisma.apiKey.update({ where: { id: keyId }, data: { enabled } });

  await prisma.auditLog.create({
    data: { userId, action: enabled ? "ENABLE" : "DISABLE", entity: "ApiKey", entityId: keyId },
  });

  return toPublic(apiKey);
}

// Permanent, irreversible — sets revokedAt in addition to disabling, so a
// revoked key stays distinguishable from one merely paused.
export async function revokeApiKey(customerId: string, keyId: string, userId: string): Promise<ApiKeyPublic> {
  const existing = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  const apiKey = await prisma.apiKey.update({
    where: { id: keyId },
    data: { enabled: false, revokedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: { userId, action: "DISABLE", entity: "ApiKey", entityId: keyId, details: JSON.stringify({ revoked: true }) },
  });

  return toPublic(apiKey);
}

export interface KeyScopeRoute {
  routeId: string;
  path: string;
  apiName: string;
  // The route's OWN full method set (empty = any) — the UI needs this to
  // know what's pickable for the sub-scope below.
  routeMethods: string[];
  // This key's chosen subset for the route; empty = inherit routeMethods
  // in full (the default — "default is what the route is").
  methods: string[];
}

export interface KeyScope {
  scopeRestricted: boolean;
  routes: KeyScopeRoute[];
}

export async function getKeyScope(customerId: string, keyId: string): Promise<KeyScope> {
  const apiKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
  if (apiKey.customerId !== customerId) throw new Error("Not found");

  const scopes = await prisma.apiKeyRouteScope.findMany({
    where: { apiKeyId: keyId },
    include: { route: { include: { api: { select: { name: true } } } } },
  });

  return {
    scopeRestricted: apiKey.scopeRestricted,
    routes: scopes.map((s) => ({
      routeId: s.routeId,
      path: s.route.path,
      apiName: s.route.api.name,
      routeMethods: s.route.methods,
      methods: s.methods,
    })),
  };
}

interface ScopeRouteInput {
  routeId: string;
  methods: ApiRouteMethod[];
}

// Replaces the key's entire route allowlist (and each route's method
// sub-scope) in one call — a simpler mental model for a checklist-style UI
// than incremental add/remove endpoints. `routes` is only consulted when
// scopeRestricted is true (an unrestricted key ignores it — nothing to gain
// from persisting a selection it doesn't use, and it keeps this function's
// contract simple: restricted rows always reflect what's actually being
// enforced right now, never a stale "what you picked before you turned
// restriction off" left dangling in a way that could confuse a direct DB read).
export async function setKeyScope(
  customerId: string,
  keyId: string,
  scopeRestricted: boolean,
  routes: ScopeRouteInput[],
  userId: string
): Promise<KeyScope> {
  const apiKey = await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } });
  if (apiKey.customerId !== customerId) throw new Error("Not found");

  const uniqueRoutes = [...new Map(routes.map((r) => [r.routeId, r])).values()];

  if (scopeRestricted && uniqueRoutes.length > 0) {
    const validRoutes = await prisma.apiRoute.findMany({
      where: { id: { in: uniqueRoutes.map((r) => r.routeId) } },
      select: { id: true, methods: true },
    });
    if (validRoutes.length !== uniqueRoutes.length) {
      throw new Error("One or more route IDs are invalid");
    }
    const routeById = new Map(validRoutes.map((r) => [r.id, r]));
    for (const { routeId, methods } of uniqueRoutes) {
      const route = routeById.get(routeId)!;
      // A route with an empty (ANY) method set can have its key-level
      // subset drawn from any of the known methods; otherwise the subset
      // must be contained in the route's own set — a key can only ever
      // narrow what the route allows, never grant more than the route does.
      const ALL_METHODS: ApiRouteMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
      const allowedPool = route.methods.length > 0 ? route.methods : ALL_METHODS;
      if (methods.some((m) => !allowedPool.includes(m))) {
        throw new Error(`Method scope for route ${routeId} is not a subset of what the route itself allows`);
      }
    }
  }

  await prisma.$transaction([
    prisma.apiKey.update({ where: { id: keyId }, data: { scopeRestricted } }),
    prisma.apiKeyRouteScope.deleteMany({ where: { apiKeyId: keyId } }),
    ...(scopeRestricted
      ? uniqueRoutes.map(({ routeId, methods }) =>
          prisma.apiKeyRouteScope.create({ data: { apiKeyId: keyId, routeId, methods } })
        )
      : []),
  ]);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ApiKey",
      entityId: keyId,
      details: JSON.stringify({ scopeRestricted, routeCount: scopeRestricted ? uniqueRoutes.length : 0 }),
    },
  });

  return getKeyScope(customerId, keyId);
}
