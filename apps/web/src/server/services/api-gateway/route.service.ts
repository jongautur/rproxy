import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/encrypt";
import { redeployApi, type DeployResult } from "@/server/services/api-gateway/api.service";
import type { ApiRouteFormData, ApiRoutePublic } from "@/types/api-gateway";
import type { ApiRoute, ApiRouteAuthType } from "@prisma/client";

// Routes render inline into their parent Api's server block, so any change
// here redeploys the whole Api config — same "child change redeploys
// parent" pattern used for AccessList changes against ProxyHost.

// Strips the encrypted upstream-auth secret before a route ever reaches an
// API response — callers only need to know one is set, never its value
// (same "configured" pattern as the Cloudflare integration's apiToken).
function toPublicRoute(route: ApiRoute): ApiRoutePublic {
  const { upstreamAuthValueEncrypted, ...rest } = route;
  return { ...rest, upstreamAuthConfigured: !!upstreamAuthValueEncrypted };
}

interface UpstreamAuthFields {
  upstreamAuthType: ApiRouteAuthType;
  upstreamAuthHeaderName: string | null;
  upstreamAuthValueEncrypted?: string | null;
}

// Shared by create/update: given the requested auth type/header/plaintext
// value, produces the Prisma fields to write. `existingHeaderName` lets an
// update keep a previously-set header name when the caller didn't resend
// one (still applies the "X-Api-Key" default for a brand-new API_KEY route).
function resolveUpstreamAuthFields(
  type: ApiRouteAuthType,
  headerName: string | undefined,
  value: string | undefined,
  existingHeaderName?: string | null
): UpstreamAuthFields {
  if (type === "NONE") {
    return { upstreamAuthType: "NONE", upstreamAuthHeaderName: null, upstreamAuthValueEncrypted: null };
  }
  const fields: UpstreamAuthFields = {
    upstreamAuthType: type,
    upstreamAuthHeaderName: type === "API_KEY" ? (headerName?.trim() || existingHeaderName || "X-Api-Key") : null,
  };
  // Empty/omitted value on an update means "keep the existing secret" — the
  // key is simply left out of the returned object so Prisma doesn't touch it.
  if (value) {
    fields.upstreamAuthValueEncrypted = encryptJson({ value });
  }
  return fields;
}

export async function createRoute(
  apiId: string,
  data: ApiRouteFormData,
  userId: string
): Promise<{ route: ApiRoutePublic; deploy: DeployResult }> {
  const authType = data.upstreamAuthType ?? "NONE";
  if (authType !== "NONE" && !data.upstreamAuthValue) {
    throw new Error("An upstream auth value is required when upstream auth is enabled");
  }

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
      ...resolveUpstreamAuthFields(authType, data.upstreamAuthHeaderName, data.upstreamAuthValue),
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

  return { route: toPublicRoute(route), deploy };
}

export async function updateRoute(
  apiId: string,
  routeId: string,
  data: Partial<ApiRouteFormData>,
  userId: string
): Promise<{ route: ApiRoutePublic; deploy: DeployResult }> {
  const { upstreamAuthType, upstreamAuthHeaderName, upstreamAuthValue, ...rest } = data;

  let authFields: UpstreamAuthFields | Record<string, never> = {};
  if (upstreamAuthType !== undefined) {
    const existing = await prisma.apiRoute.findUniqueOrThrow({ where: { id: routeId }, select: { upstreamAuthHeaderName: true } });
    authFields = resolveUpstreamAuthFields(upstreamAuthType, upstreamAuthHeaderName, upstreamAuthValue, existing.upstreamAuthHeaderName);
  }

  const route = await prisma.apiRoute.update({
    where: { id: routeId },
    data: { ...rest, ...authFields },
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

  return { route: toPublicRoute(route), deploy };
}

export async function listRoutes(apiId: string): Promise<ApiRoutePublic[]> {
  const routes = await prisma.apiRoute.findMany({ where: { apiId }, orderBy: { createdAt: "asc" } });
  return routes.map(toPublicRoute);
}

export async function getRoute(routeId: string): Promise<ApiRoutePublic | null> {
  const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
  return route ? toPublicRoute(route) : null;
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
