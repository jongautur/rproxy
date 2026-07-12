import { prisma } from "@/lib/prisma";
import { deployStreamConfig, removeStreamConfig, type DeployResult } from "@/server/services/nginx-deploy.service";
import { streamToFilename, generateStreamConfig } from "@/server/config-generator/stream-config";
import type { StreamHost } from "@prisma/client";

export type { DeployResult };

async function deploy(host: StreamHost): Promise<DeployResult> {
  const filename = streamToFilename(host.name);
  const config = generateStreamConfig(host);
  return deployStreamConfig({ filename, config });
}

async function applyDeployStatus(id: string, deploy: DeployResult): Promise<StreamHost> {
  return prisma.streamHost.update({
    where: { id },
    data: {
      status: deploy.success ? "ACTIVE" : "ERROR",
      lastDeployError: deploy.success ? null : deploy.output,
    },
  });
}

export async function createStream(
  data: { name: string; protocol: string; listenPort: number; forwardHost: string; forwardPort: number },
  userId: string
): Promise<{ stream: StreamHost; deploy: DeployResult }> {
  const filename = streamToFilename(data.name);

  const stream = await prisma.streamHost.create({
    data: { ...data, configPath: `/etc/nginx/stream.d/${filename}` },
  });

  const deployResult = await deploy(stream);
  const updated = await applyDeployStatus(stream.id, deployResult);

  await prisma.auditLog.create({
    data: { userId, action: "CREATE", entity: "StreamHost", entityId: stream.id },
  });

  return { stream: updated, deploy: deployResult };
}

export async function updateStream(
  id: string,
  data: Partial<{ name: string; protocol: string; listenPort: number; forwardHost: string; forwardPort: number }>,
  userId: string
): Promise<{ stream: StreamHost; deploy: DeployResult }> {
  const existing = await prisma.streamHost.findUniqueOrThrow({ where: { id } });

  // Remove old config file before rename so a stale file isn't left behind.
  if (data.name && data.name !== existing.name) {
    const oldFilename = streamToFilename(existing.name);
    await removeStreamConfig(oldFilename);
  }

  let stream = await prisma.streamHost.update({ where: { id }, data });
  const filename = streamToFilename(stream.name);
  stream = await prisma.streamHost.update({ where: { id }, data: { configPath: `/etc/nginx/stream.d/${filename}` } });

  let deployResult: DeployResult = { success: true, output: "Stream disabled — not deployed." };
  if (stream.enabled) {
    deployResult = await deploy(stream);
  }
  const updated = await applyDeployStatus(id, deployResult);

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "StreamHost", entityId: id },
  });

  return { stream: updated, deploy: deployResult };
}

export async function deleteStream(id: string, userId: string): Promise<void> {
  const stream = await prisma.streamHost.findUniqueOrThrow({ where: { id } });
  const filename = streamToFilename(stream.name);

  await removeStreamConfig(filename);
  await prisma.streamHost.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "StreamHost", entityId: id },
  });
}

export async function toggleStream(id: string, userId: string): Promise<{ stream: StreamHost; deploy: DeployResult }> {
  const stream = await prisma.streamHost.findUniqueOrThrow({ where: { id } });
  const filename = streamToFilename(stream.name);
  const nextEnabled = !stream.enabled;

  let updated = await prisma.streamHost.update({
    where: { id },
    data: { enabled: nextEnabled },
  });

  const deployResult = nextEnabled
    ? await deploy(updated)
    : await removeStreamConfig(filename);

  updated = await applyDeployStatus(id, deployResult);

  await prisma.auditLog.create({
    data: { userId, action: nextEnabled ? "ENABLE" : "DISABLE", entity: "StreamHost", entityId: id },
  });

  return { stream: updated, deploy: deployResult };
}
