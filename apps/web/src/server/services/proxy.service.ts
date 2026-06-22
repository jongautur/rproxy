import { writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { generateNginxConfig, domainToFilename } from "@/server/config-generator/nginx-config";
import { testNginxConfig, reloadNginx } from "@/server/system/nginx";
import { nginxHelper } from "@/server/system/exec";
import type { ProxyHostFormData } from "@/types/proxy";
import type { ProxyHost } from "@prisma/client";

const STAGING_DIR = "/var/lib/rproxy/staging";
const SITES_AVAILABLE = "/etc/nginx/sites-available";

async function ensureStagingDir(): Promise<void> {
  await mkdir(STAGING_DIR, { recursive: true });
}

export interface DeployResult {
  success: boolean;
  output: string;
}

async function deployConfig(proxy: ProxyHost): Promise<DeployResult> {
  const [cert, accessList] = await Promise.all([
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
  ]);

  const config = generateNginxConfig({ proxy, certificate: cert, accessList });
  const filename = domainToFilename(proxy.domain) + ".conf";

  await ensureStagingDir();
  const stagingPath = path.join(STAGING_DIR, filename);

  // 1. Write to staging (writable by app user)
  await writeFile(stagingPath, config, "utf-8");

  // 2. Copy to sites-available via helper
  const destPath = path.join(SITES_AVAILABLE, filename);
  const copyResult = await nginxHelper("deploy", filename);
  if (copyResult.exitCode !== 0) {
    await unlink(stagingPath).catch(() => {});
    return { success: false, output: `Failed to deploy config: ${copyResult.stderr || copyResult.stdout}` };
  }

  // 3. Test nginx config
  const testResult = await testNginxConfig();
  if (!testResult.success) {
    // Rollback: remove the bad config
    await nginxHelper("remove", filename);
    await unlink(stagingPath).catch(() => {});
    return { success: false, output: `Config test failed:\n${testResult.output}` };
  }

  // 4. Enable site (symlink)
  if (proxy.enabled) {
    await nginxHelper("enable", filename);
  }

  // 5. Reload nginx
  const reloadResult = await reloadNginx();

  await unlink(stagingPath).catch(() => {});

  // 6. Update config path in DB
  await prisma.proxyHost.update({
    where: { id: proxy.id },
    data: { configPath: destPath },
  });

  return reloadResult;
}

async function removeConfig(proxy: ProxyHost): Promise<void> {
  const filename = domainToFilename(proxy.domain) + ".conf";
  await nginxHelper("remove", filename);
  await reloadNginx();
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

export async function deleteProxy(id: string, userId: string): Promise<void> {
  const proxy = await prisma.proxyHost.findUniqueOrThrow({ where: { id } });

  await removeConfig(proxy);

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
      entity: "ProxyHost",
      entityId: id,
    },
  });

  return { proxy, deploy };
}
