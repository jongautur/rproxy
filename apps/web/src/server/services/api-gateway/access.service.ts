import { prisma } from "@/lib/prisma";
import type { ApiAccessFormData, ApiRouteAccessFormData } from "@/types/api-gateway";
import type { ApiAccess, ApiRouteAccess } from "@prisma/client";

// ApiAccess is the actual grant (customer can call anything under this Api
// at all); ApiRouteAccess only overrides limits for one route and can only
// exist meaningfully alongside a corresponding ApiAccess row — see the
// schema comment on ApiRouteAccess for why this is two models rather than
// one with a nullable routeId.

export async function listApiAccess(customerId: string) {
  return prisma.apiAccess.findMany({
    where: { customerId },
    include: { api: { select: { id: true, name: true, domain: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createApiAccess(
  customerId: string,
  data: ApiAccessFormData,
  userId: string
): Promise<ApiAccess> {
  await Promise.all([
    prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
    prisma.api.findUniqueOrThrow({ where: { id: data.apiId } }),
  ]);

  const access = await prisma.apiAccess.create({
    data: {
      customerId,
      apiId: data.apiId,
      enabled: data.enabled,
      rateLimitOverride: data.rateLimitOverride,
      dailyQuota: data.dailyQuota,
      monthlyQuota: data.monthlyQuota,
      expiresAt: data.expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "CREATE", entity: "ApiAccess", entityId: access.id, details: JSON.stringify({ customerId, apiId: data.apiId }) },
  });

  return access;
}

export async function updateApiAccess(
  customerId: string,
  accessId: string,
  data: Partial<ApiAccessFormData>,
  userId: string
): Promise<ApiAccess> {
  const existing = await prisma.apiAccess.findUniqueOrThrow({ where: { id: accessId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  const access = await prisma.apiAccess.update({
    where: { id: accessId },
    data: {
      enabled: data.enabled,
      rateLimitOverride: data.rateLimitOverride,
      dailyQuota: data.dailyQuota,
      monthlyQuota: data.monthlyQuota,
      expiresAt: data.expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "ApiAccess", entityId: accessId },
  });

  return access;
}

export async function deleteApiAccess(customerId: string, accessId: string, userId: string): Promise<void> {
  const existing = await prisma.apiAccess.findUniqueOrThrow({ where: { id: accessId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  // Cascades any ApiRouteAccess rows tied to routes under this Api? No —
  // ApiRouteAccess cascades from Customer/ApiRoute deletion, not from
  // ApiAccess deletion (it's not a child FK of ApiAccess in the schema).
  // Revoking the API-wide grant while a route-level override row still
  // exists is fine: gateway-auth resolution always checks ApiAccess first,
  // so an orphaned ApiRouteAccess with no matching ApiAccess simply grants
  // nothing.
  await prisma.apiAccess.delete({ where: { id: accessId } });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "ApiAccess", entityId: accessId },
  });
}

export async function createApiRouteAccess(
  customerId: string,
  data: ApiRouteAccessFormData,
  userId: string
): Promise<ApiRouteAccess> {
  await Promise.all([
    prisma.customer.findUniqueOrThrow({ where: { id: customerId } }),
    prisma.apiRoute.findUniqueOrThrow({ where: { id: data.routeId } }),
  ]);

  const access = await prisma.apiRouteAccess.create({
    data: {
      customerId,
      routeId: data.routeId,
      enabled: data.enabled,
      rateLimitOverride: data.rateLimitOverride,
      dailyQuota: data.dailyQuota,
      monthlyQuota: data.monthlyQuota,
      expiresAt: data.expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "CREATE", entity: "ApiRouteAccess", entityId: access.id, details: JSON.stringify({ customerId, routeId: data.routeId }) },
  });

  return access;
}

export async function updateApiRouteAccess(
  customerId: string,
  accessId: string,
  data: Partial<ApiRouteAccessFormData>,
  userId: string
): Promise<ApiRouteAccess> {
  const existing = await prisma.apiRouteAccess.findUniqueOrThrow({ where: { id: accessId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  const access = await prisma.apiRouteAccess.update({
    where: { id: accessId },
    data: {
      enabled: data.enabled,
      rateLimitOverride: data.rateLimitOverride,
      dailyQuota: data.dailyQuota,
      monthlyQuota: data.monthlyQuota,
      expiresAt: data.expiresAt,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "ApiRouteAccess", entityId: accessId },
  });

  return access;
}

export async function deleteApiRouteAccess(customerId: string, accessId: string, userId: string): Promise<void> {
  const existing = await prisma.apiRouteAccess.findUniqueOrThrow({ where: { id: accessId } });
  if (existing.customerId !== customerId) throw new Error("Not found");

  await prisma.apiRouteAccess.delete({ where: { id: accessId } });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "ApiRouteAccess", entityId: accessId },
  });
}
