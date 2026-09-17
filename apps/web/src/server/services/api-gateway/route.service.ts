import { prisma } from "@/lib/prisma";
import { redeployApi, type DeployResult } from "@/server/services/api-gateway/api.service";
import type { ApiRouteFormData } from "@/types/api-gateway";
import type { ApiRoute } from "@prisma/client";

// Routes render inline into their parent Api's server block, so any change
// here redeploys the whole Api config — same "child change redeploys
// parent" pattern used for AccessList changes against ProxyHost.

export async function createRoute(
  apiId: string,
  data: ApiRouteFormData,
  userId: string
): Promise<{ route: ApiRoute; deploy: DeployResult }> {
  const route = await prisma.apiRoute.create({
    data: {
      apiId,
      path: data.path,
      methods: data.methods,
      upstreamScheme: data.upstreamScheme,
      upstreamHost: data.upstreamHost,
      upstreamPort: data.upstreamPort,
      upstreamPath: data.upstreamPath,
      authRequired: data.authRequired,
      maxRequestsPerSecond: data.maxRequestsPerSecond,
      enabled: data.enabled ?? true,
    },
  });

  const deploy = await redeployApi(apiId);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "CREATE",
      entity: "ApiRoute",
      entityId: route.id,
      details: JSON.stringify({ apiId, path: route.path, methods: route.methods }),
    },
  });

  return { route, deploy };
}

export async function updateRoute(
  apiId: string,
  routeId: string,
  data: Partial<ApiRouteFormData>,
  userId: string
): Promise<{ route: ApiRoute; deploy: DeployResult }> {
  const route = await prisma.apiRoute.update({
    where: { id: routeId },
    data,
  });

  const deploy = await redeployApi(apiId);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ApiRoute",
      entityId: routeId,
    },
  });

  return { route, deploy };
}

export async function deleteRoute(
  apiId: string,
  routeId: string,
  userId: string
): Promise<DeployResult> {
  await prisma.apiRoute.delete({ where: { id: routeId } });

  const deploy = await redeployApi(apiId);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "DELETE",
      entity: "ApiRoute",
      entityId: routeId,
    },
  });

  return deploy;
}
