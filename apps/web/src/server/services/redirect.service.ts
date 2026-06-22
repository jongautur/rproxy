import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { generateRedirectConfig, domainToRedirectFilename } from "@/server/config-generator/redirect-config";
import { testNginxConfig, reloadNginx } from "@/server/system/nginx";
import { nginxHelper } from "@/server/system/exec";
import type { RedirectHostFormData } from "@/types/redirect";
import type { RedirectHost } from "@prisma/client";

const STAGING_DIR = "/var/lib/rproxy/staging";
const SITES_AVAILABLE = "/etc/nginx/sites-available";

async function ensureStagingDir(): Promise<void> {
  await mkdir(STAGING_DIR, { recursive: true });
}

export interface DeployResult {
  success: boolean;
  output: string;
}

async function deployRedirectConfig(redirect: RedirectHost): Promise<DeployResult> {
  const certificate = redirect.certificateId
    ? await prisma.certificate.findUnique({ where: { id: redirect.certificateId } })
    : null;

  const config = generateRedirectConfig({ redirect, certificate });
  const filename = domainToRedirectFilename(redirect.sourceDomain) + ".conf";

  await ensureStagingDir();
  const stagingPath = path.join(STAGING_DIR, filename);

  await writeFile(stagingPath, config, "utf-8");

  const copyResult = await nginxHelper("deploy", filename);
  if (copyResult.exitCode !== 0) {
    await unlink(stagingPath).catch(() => {});
    return { success: false, output: `Failed to deploy config: ${copyResult.stderr || copyResult.stdout}` };
  }

  const testResult = await testNginxConfig();
  if (!testResult.success) {
    await nginxHelper("remove", filename);
    await unlink(stagingPath).catch(() => {});
    return { success: false, output: `Config test failed:\n${testResult.output}` };
  }

  if (redirect.enabled) {
    await nginxHelper("enable", filename);
  }

  const reloadResult = await reloadNginx();
  await unlink(stagingPath).catch(() => {});

  await prisma.redirectHost.update({
    where: { id: redirect.id },
    data: { configPath: path.join(SITES_AVAILABLE, filename) },
  });

  return reloadResult;
}

async function removeRedirectConfig(redirect: RedirectHost): Promise<void> {
  const filename = domainToRedirectFilename(redirect.sourceDomain) + ".conf";
  await nginxHelper("remove", filename);
  await reloadNginx();
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

export async function deleteRedirect(id: string, userId: string): Promise<void> {
  const redirect = await prisma.redirectHost.findUniqueOrThrow({ where: { id } });

  await removeRedirectConfig(redirect);
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

  if (enabled) {
    await nginxHelper("enable", filename);
  } else {
    await nginxHelper("disable", filename);
  }

  const deploy = await reloadNginx();

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
