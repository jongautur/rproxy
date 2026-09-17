import path from "path";
import { prisma } from "@/lib/prisma";
import { generateApiGatewayConfig, apiConfigFilename } from "@/server/config-generator/api-gateway-config";
import { deployConfigBatch, setSiteEnabled, type DeployResult } from "@/server/services/nginx-deploy.service";
import { buildZonesBatchEntry } from "@/server/services/api-gateway/zones.service";
import type { ApiFormData } from "@/types/api-gateway";
import type { Api } from "@prisma/client";

const SITES_AVAILABLE = "/etc/nginx/sites-available";

export type { DeployResult };

// Always deploys the shared limit_req_zone file together with the Api's own
// site file, in one atomic batch — a route's rate limit can add, change, or
// remove a zone name the site file references, and there is no safe order
// for two separate deploys to happen in (see deployConfigBatch's doc
// comment / Correction 6 in the API Gateway plan). The extra zones query
// and file write is cheap; always taking this path removes an entire class
// of "did this specific change touch rate limits" detection bugs.
async function deployConfig(api: Api): Promise<DeployResult> {
  const [routes, certificate, zonesEntry] = await Promise.all([
    prisma.apiRoute.findMany({ where: { apiId: api.id }, orderBy: { createdAt: "asc" } }),
    api.certificateId ? prisma.certificate.findUnique({ where: { id: api.certificateId } }) : null,
    buildZonesBatchEntry(),
  ]);

  const config = generateApiGatewayConfig({ api, routes, certificate });
  const filename = apiConfigFilename(api.domain);

  const deploy = await deployConfigBatch([
    zonesEntry,
    { kind: "site", filename, config, enabled: api.enabled },
  ]);

  // Only record the config as live once nginx actually accepted it — same
  // convention as proxy.service.ts's deployConfig.
  if (deploy.success) {
    await prisma.api.update({
      where: { id: api.id },
      data: { configPath: path.join(SITES_AVAILABLE, filename) },
    });
  }

  return deploy;
}

async function removeConfig(api: Api): Promise<DeployResult> {
  const filename = apiConfigFilename(api.domain);
  // Exclude this Api from the zones recompute — it (and its routes) are
  // about to be gone, but the DB row hasn't been deleted yet at the point
  // this runs (see deleteApi below), so the query would otherwise still
  // include zones this deploy is meant to remove.
  const zonesEntry = await buildZonesBatchEntry(api.id);
  return deployConfigBatch([
    zonesEntry,
    { kind: "site", filename, config: "", remove: true },
  ]);
}

// Re-renders and redeploys an existing Api's config without changing any of
// its own fields — used by route.service.ts whenever a child ApiRoute is
// created/updated/deleted, since routes render inline into the parent Api's
// server block.
export async function redeployApi(apiId: string): Promise<DeployResult> {
  const api = await prisma.api.findUniqueOrThrow({ where: { id: apiId } });
  const deploy = await deployConfig(api);
  await prisma.api.update({
    where: { id: apiId },
    data: { status: deploy.success ? "ACTIVE" : "ERROR" },
  });
  return deploy;
}

export async function createApi(
  data: ApiFormData,
  userId: string
): Promise<{ api: Api; deploy: DeployResult }> {
  const api = await prisma.api.create({
    data: {
      name: data.name,
      domain: data.domain,
      basePath: data.basePath ?? "",
      description: data.description,
      listenPort: data.listenPort,
      httpsPort: data.httpsPort,
      sslEnabled: data.sslEnabled,
      maxRequestsPerSecond: data.maxRequestsPerSecond,
      maxBodySizeMb: data.maxBodySizeMb,
      corsEnabled: data.corsEnabled,
      certificateId: data.certificateId,
      enabled: true,
    },
  });

  const deploy = await deployConfig(api);

  await prisma.api.update({
    where: { id: api.id },
    data: { status: deploy.success ? "ACTIVE" : "ERROR" },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "CREATE",
      entity: "Api",
      entityId: api.id,
      details: JSON.stringify({ domain: api.domain }),
    },
  });

  return { api, deploy };
}

export async function updateApi(
  id: string,
  data: Partial<ApiFormData>,
  userId: string
): Promise<{ api: Api; deploy: DeployResult }> {
  const updated = await prisma.api.update({
    where: { id },
    data,
  });

  const deploy = await deployConfig(updated);

  await prisma.api.update({
    where: { id },
    data: { status: deploy.success ? "ACTIVE" : "ERROR" },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "Api",
      entityId: id,
    },
  });

  return { api: updated, deploy };
}

export async function deleteApi(id: string, userId: string): Promise<DeployResult> {
  const api = await prisma.api.findUniqueOrThrow({ where: { id } });

  // Same convention as proxy.service.ts's deleteProxy: the DB record is
  // removed regardless of nginx cleanup outcome — an admin's intent to
  // delete shouldn't get stuck behind a broken nginx state. Cascading
  // deletes remove the Api's ApiRoute/ApiAccess rows automatically.
  const deploy = await removeConfig(api);
  await prisma.api.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "DELETE",
      entity: "Api",
      entityId: id,
      details: JSON.stringify({ domain: api.domain }),
    },
  });

  return deploy;
}

export async function toggleApi(
  id: string,
  enabled: boolean,
  userId: string
): Promise<{ api: Api; deploy: DeployResult }> {
  const api = await prisma.api.update({ where: { id }, data: { enabled } });

  const filename = apiConfigFilename(api.domain);
  const deploy = await setSiteEnabled(filename, enabled);

  await prisma.auditLog.create({
    data: {
      userId,
      action: enabled ? "ENABLE" : "DISABLE",
      entity: "Api",
      entityId: id,
    },
  });

  return { api, deploy };
}
