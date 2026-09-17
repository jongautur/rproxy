import path from "path";
import { prisma } from "@/lib/prisma";
import { generateNginxConfig, domainToFilename } from "@/server/config-generator/nginx-config";
import { deploySiteConfig, removeSiteConfig, setSiteEnabled, type DeployResult } from "@/server/services/nginx-deploy.service";
import { getIntegration, resolveZoneForDomain, upsertARecord, getPublicIp, deleteARecord, setRecordProxied, listZones, matchZoneForDomain, findARecord } from "@/server/services/cloudflare.service";
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

export interface DnsRecordResult {
  created: boolean;
  error?: string;
}

// Best-effort — a Cloudflare hiccup or misconfigured zone must never block
// proxy creation, since the proxy itself is fully functional without DNS
// automation (the admin can always create the A record manually).
async function autoCreateDnsRecord(proxy: ProxyHost): Promise<DnsRecordResult | undefined> {
  const integration = await getIntegration();
  if (!integration?.autoDnsEnabled) return undefined;

  try {
    const zone = await resolveZoneForDomain(integration.apiToken, proxy.domain);
    if (!zone) {
      return { created: false, error: `No Cloudflare zone found for ${proxy.domain}` };
    }
    const ip = integration.lastPublicIp ?? await getPublicIp();
    const record = await upsertARecord(integration.apiToken, zone.id, proxy.domain, ip, { proxied: integration.defaultProxied });
    await prisma.proxyHost.update({
      where: { id: proxy.id },
      data: { cloudflareRecordId: record.id, cloudflareProxied: integration.defaultProxied },
    });
    return { created: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`Cloudflare DNS auto-create failed for ${proxy.domain}:`, error);
    return { created: false, error };
  }
}

// Best-effort, same as autoCreateDnsRecord — a Cloudflare hiccup must never
// block deleting the proxy itself. Only acts on records rproxy created
// (tracked via cloudflareRecordId), so it never touches unrelated records.
async function autoDeleteDnsRecord(proxy: ProxyHost): Promise<void> {
  if (!proxy.cloudflareRecordId) return;

  try {
    const integration = await getIntegration();
    if (!integration?.deleteDnsWithHost) return;

    const zone = await resolveZoneForDomain(integration.apiToken, proxy.domain);
    if (!zone) return;

    await deleteARecord(integration.apiToken, zone.id, proxy.cloudflareRecordId);
  } catch (e) {
    console.error(`Cloudflare DNS auto-delete failed for ${proxy.domain}:`, e instanceof Error ? e.message : String(e));
  }
}

export async function redeployProxy(id: string): Promise<void> {
  const proxy = await prisma.proxyHost.findUnique({ where: { id } });
  if (proxy) await deployConfig(proxy).catch(() => {});
}

export async function createProxy(
  data: ProxyHostFormData,
  userId: string
): Promise<{ proxy: ProxyHost; deploy: DeployResult; dnsRecord?: DnsRecordResult }> {
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
  const dnsRecord = await autoCreateDnsRecord(proxy);

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

  return { proxy, deploy, dnsRecord };
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
  await autoDeleteDnsRecord(proxy);

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

export async function setCloudflareProxied(id: string, proxied: boolean, userId: string): Promise<ProxyHost> {
  const proxy = await prisma.proxyHost.findUniqueOrThrow({ where: { id } });
  if (!proxy.cloudflareRecordId) {
    throw new Error("This proxy has no Cloudflare-managed DNS record");
  }

  const integration = await getIntegration();
  if (!integration) throw new Error("Cloudflare is not connected");

  const zone = await resolveZoneForDomain(integration.apiToken, proxy.domain);
  if (!zone) throw new Error(`No Cloudflare zone found for ${proxy.domain}`);

  await setRecordProxied(integration.apiToken, zone.id, proxy.cloudflareRecordId, proxied);

  const updated = await prisma.proxyHost.update({
    where: { id },
    data: { cloudflareProxied: proxied },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ProxyHost",
      entityId: id,
      details: JSON.stringify({ cloudflareProxied: proxied }),
    },
  });

  return updated;
}

export interface SyncCloudflareResult {
  linked: number;
  alreadyLinked: number;
  notFound: number;
  errors: string[];
}

// Backfills cloudflareRecordId/cloudflareProxied for proxies that predate
// the Cloudflare integration (or were created while it was disabled) by
// looking up each domain's existing A record — read-only, never creates or
// modifies a DNS record, so it's safe to run repeatedly.
export async function syncCloudflareRecords(userId: string): Promise<SyncCloudflareResult> {
  const integration = await getIntegration();
  if (!integration) throw new Error("Cloudflare is not connected");

  const zones = await listZones(integration.apiToken);
  const proxies = await prisma.proxyHost.findMany({
    select: { id: true, domain: true, cloudflareRecordId: true },
  });

  const result: SyncCloudflareResult = { linked: 0, alreadyLinked: 0, notFound: 0, errors: [] };

  for (const proxy of proxies) {
    if (proxy.cloudflareRecordId) {
      result.alreadyLinked++;
      continue;
    }

    try {
      const zone = matchZoneForDomain(proxy.domain, zones);
      if (!zone) {
        result.notFound++;
        continue;
      }

      const record = await findARecord(integration.apiToken, zone.id, proxy.domain);
      if (!record) {
        result.notFound++;
        continue;
      }

      await prisma.proxyHost.update({
        where: { id: proxy.id },
        data: { cloudflareRecordId: record.id, cloudflareProxied: record.proxied },
      });
      result.linked++;
    } catch (e) {
      result.errors.push(`${proxy.domain}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action: "UPDATE",
      entity: "ProxyHost",
      details: JSON.stringify({ cloudflareSync: result }),
    },
  });

  return result;
}
