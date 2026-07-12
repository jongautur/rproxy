import path from "path";
import { prisma } from "@/lib/prisma";
import { generateRedirectConfig, domainToRedirectFilename } from "@/server/config-generator/redirect-config";
import { deploySiteConfig, removeSiteConfig, setSiteEnabled, type DeployResult } from "@/server/services/nginx-deploy.service";
import type { RedirectHostFormData } from "@/types/redirect";
import type { RedirectHost } from "@prisma/client";

const SITES_AVAILABLE = "/etc/nginx/sites-available";

export type { DeployResult };

async function deployRedirectConfig(redirect: RedirectHost): Promise<DeployResult> {
  const certificate = redirect.certificateId
    ? await prisma.certificate.findUnique({ where: { id: redirect.certificateId } })
    : null;

  const config = generateRedirectConfig({ redirect, certificate });
  const filename = domainToRedirectFilename(redirect.sourceDomain) + ".conf";

  const deploy = await deploySiteConfig({ filename, config, enabled: redirect.enabled });

  if (deploy.success) {
    await prisma.redirectHost.update({
      where: { id: redirect.id },
      data: { configPath: path.join(SITES_AVAILABLE, filename) },
    });
  }

  return deploy;
}

async function removeRedirectConfig(redirect: RedirectHost): Promise<DeployResult> {
  const filename = domainToRedirectFilename(redirect.sourceDomain) + ".conf";
  return removeSiteConfig(filename);
}

export async function createRedirect(
  data: RedirectHostFormData,
  userId: string
): Promise<{ redirect: RedirectHost; deploy: DeployResult }> {
  const redirect = await prisma.redirectHost.create({
    data: {
      sourceDomain: data.sourceDomain,
      destination: data.destination,
      redirectCode: data.redirectCode,
      preservePath: data.preservePath,
      sslEnabled: data.sslEnabled,
      certificateId: data.certificateId ?? null,
      enabled: true,
    },
  });

  const deploy = await deployRedirectConfig(redirect);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "CREATE",
      entity: "RedirectHost",
      entityId: redirect.id,
      details: JSON.stringify({ sourceDomain: redirect.sourceDomain, destination: redirect.destination }),
    },
  });

  return { redirect, deploy };
}

export async function updateRedirect(
  id: string,
  data: Partial<RedirectHostFormData>,
  userId: string
): Promise<{ redirect: RedirectHost; deploy: DeployResult }> {
  const updated = await prisma.redirectHost.update({
    where: { id },
    data: {
      ...data,
      certificateId: data.certificateId ?? null,
    },
  });

  const deploy = await deployRedirectConfig(updated);

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "RedirectHost",
      entityId: id,
    },
  });

  return { redirect: updated, deploy };
}

export async function deleteRedirect(id: string, userId: string): Promise<DeployResult> {
  const redirect = await prisma.redirectHost.findUniqueOrThrow({ where: { id } });

  const deploy = await removeRedirectConfig(redirect);
  await prisma.redirectHost.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "DELETE",
      entity: "RedirectHost",
      entityId: id,
      details: JSON.stringify({ sourceDomain: redirect.sourceDomain }),
    },
  });

  return deploy;
}

export async function toggleRedirect(
  id: string,
  enabled: boolean,
  userId: string
): Promise<{ redirect: RedirectHost; deploy: DeployResult }> {
  const redirect = await prisma.redirectHost.update({
    where: { id },
    data: { enabled },
  });

  const filename = domainToRedirectFilename(redirect.sourceDomain) + ".conf";
  const deploy = await setSiteEnabled(filename, enabled);

  await prisma.auditLog.create({
    data: {
      userId,
      action: enabled ? "ENABLE" : "DISABLE",
      entity: "RedirectHost",
      entityId: id,
    },
  });

  return { redirect, deploy };
}
