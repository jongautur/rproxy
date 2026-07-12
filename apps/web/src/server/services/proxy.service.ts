import path from "path";
import { prisma } from "@/lib/prisma";
import { generateNginxConfig, domainToFilename } from "@/server/config-generator/nginx-config";
import { deploySiteConfig, removeSiteConfig, setSiteEnabled, type DeployResult } from "@/server/services/nginx-deploy.service";
import type { ProxyHostFormData } from "@/types/proxy";
import type { ProxyHost } from "@prisma/client";

const SITES_AVAILABLE = "/etc/nginx/sites-available";

export type { DeployResult };

async function deployConfig(proxy: ProxyHost): Promise<DeployResult> {
  const [cert, accessList, custom403Setting] = await Promise.all([
    proxy.certificateId
      ? prisma.certificate.findUnique({ where: { id: proxy.certificateId } })
      : null,
    proxy.accessListId
      ? prisma.accessList.findUnique({
          where: { id: proxy.accessListId },
          include: {
            authUsers: { select: { id: true, username: true } },
            ipRules: { orderBy: { sortOrder: "asc" } },
          },
        })
      : null,
    prisma.setting.findUnique({ where: { key: "error_403_html" } }),
  ]);

  const custom403Enabled = !!custom403Setting?.value.trim();
  const config = generateNginxConfig({ proxy, certificate: cert, accessList, custom403Enabled });
  const filename = domainToFilename(proxy.domain) + ".conf";

  const deploy = await deploySiteConfig({ filename, config, enabled: proxy.enabled });

  // Only record the config as live once nginx actually accepted it.
  if (deploy.success) {
    await prisma.proxyHost.update({
      where: { id: proxy.id },
      data: { configPath: path.join(SITES_AVAILABLE, filename) },
    });
  }

  return deploy;
}

async function removeConfig(proxy: ProxyHost): Promise<DeployResult> {
  const filename = domainToFilename(proxy.domain) + ".conf";
  return removeSiteConfig(filename);
}

export async function redeployProxy(id: string): Promise<void> {
  const proxy = await prisma.proxyHost.findUnique({ where: { id } });
  if (proxy) await deployConfig(proxy).catch(() => {});
}

export async function createProxy(
  data: ProxyHostFormData,
  userId: string
): Promise<{ proxy: ProxyHost; deploy: DeployResult }> {
  const proxy = await prisma.proxyHost.create({
    data: {
      domain: data.domain,
      forwardScheme: data.forwardScheme,
      forwardHost: data.forwardHost,
      forwardPort: data.forwardPort,
      listenPort: data.listenPort,
      httpsPort: data.httpsPort,
      sslEnabled: data.sslEnabled,
      forceHttps: data.forceHttps,
      http2: data.http2,
      websocket: data.websocket,
      accessLog: data.accessLog,
      errorLog: data.errorLog,
      customLocations: data.customLocations,
      customServer: data.customServer,
      customHeaders: data.customHeaders ? JSON.stringify(data.customHeaders) : undefined,
      certificateId: data.certificateId,
      accessListId: data.accessListId ?? null,
      enabled: true,
    },
  });

  const deploy = await deployConfig(proxy);

  await prisma.proxyHost.update({
    where: { id: proxy.id },
    data: { status: deploy.success ? "ACTIVE" : "ERROR" },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "CREATE",
      entity: "ProxyHost",
      entityId: proxy.id,
      details: JSON.stringify({ domain: proxy.domain }),
    },
  });

  return { proxy, deploy };
}

export async function updateProxy(
  id: string,
  data: Partial<ProxyHostFormData>,
  userId: string
): Promise<{ proxy: ProxyHost; deploy: DeployResult }> {
  const existing = await prisma.proxyHost.findUniqueOrThrow({ where: { id } });

  const updated = await prisma.proxyHost.update({
    where: { id },
    data: {
      ...data,
      customHeaders: data.customHeaders ? JSON.stringify(data.customHeaders) : undefined,
    },
  });

  const deploy = await deployConfig(updated);

  await prisma.proxyHost.update({
    where: { id },
    data: { status: deploy.success ? "ACTIVE" : "ERROR" },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ProxyHost",
      entityId: id,
    },
  });

  return { proxy: updated, deploy };
}

export async function deleteProxy(id: string, userId: string): Promise<DeployResult> {
  const proxy = await prisma.proxyHost.findUniqueOrThrow({ where: { id } });

  // The DB record is deleted regardless of nginx cleanup succeeding — the
  // admin's intent to remove this host shouldn't get stuck behind a broken
  // nginx state. The caller surfaces `deploy` so a failure here (e.g.
  // reload rejected by an unrelated site) is visible instead of leaving an
  // orphaned config file with no corresponding DB row and no way to retry
  // from the UI.
  const deploy = await removeConfig(proxy);

  await prisma.proxyHost.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "DELETE",
      entity: "ProxyHost",
      entityId: id,
      details: JSON.stringify({ domain: proxy.domain }),
    },
  });

  return deploy;
}

export async function toggleProxy(
  id: string,
  enabled: boolean,
  userId: string
): Promise<{ proxy: ProxyHost; deploy: DeployResult }> {
  const proxy = await prisma.proxyHost.update({
    where: { id },
    data: { enabled },
  });

  const filename = domainToFilename(proxy.domain) + ".conf";
  const deploy = await setSiteEnabled(filename, enabled);

  await prisma.auditLog.create({
    data: {
      userId,
      action: enabled ? "ENABLE" : "DISABLE",
      entity: "ProxyHost",
      entityId: id,
    },
  });

  return { proxy, deploy };
}
