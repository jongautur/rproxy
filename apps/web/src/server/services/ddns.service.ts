import { prisma } from "@/lib/prisma";
import { getIntegration, listZones, listARecords, upsertARecord, getPublicIp } from "@/server/services/cloudflare.service";

export type DdnsSweepResult =
  | { skipped: string }
  | { ip: string; updatedRecords: string[] };

export async function runDdnsSweep(): Promise<DdnsSweepResult> {
  const integration = await getIntegration();
  if (!integration || !integration.ddnsEnabled) {
    return { skipped: "not configured" };
  }

  const currentIp = await getPublicIp();

  if (integration.lastPublicIp === null) {
    // First run — nothing to compare against yet, just establish a baseline
    // so we don't scan-and-update records that may already be correct.
    await prisma.cloudflareIntegration.update({
      where: { id: "singleton" },
      data: { lastPublicIp: currentIp, lastCheckedAt: new Date() },
    });
    return { skipped: "baseline set" };
  }

  if (currentIp === integration.lastPublicIp) {
    await prisma.cloudflareIntegration.update({
      where: { id: "singleton" },
      data: { lastCheckedAt: new Date() },
    });
    return { skipped: "unchanged" };
  }

  const previousIp = integration.lastPublicIp;
  const zones = await listZones(integration.apiToken);
  const updatedRecords: string[] = [];

  for (const zone of zones) {
    const records = await listARecords(integration.apiToken, zone.id);
    const stale = records.filter((r) => r.content === previousIp);
    for (const record of stale) {
      await upsertARecord(integration.apiToken, zone.id, record.name, currentIp);
      updatedRecords.push(record.name);
    }
  }

  await prisma.cloudflareIntegration.update({
    where: { id: "singleton" },
    data: { lastPublicIp: currentIp, lastCheckedAt: new Date() },
  });

  return { ip: currentIp, updatedRecords };
}
