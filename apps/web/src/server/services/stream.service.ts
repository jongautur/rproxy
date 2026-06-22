import { writeFile } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/prisma";
import { testNginxConfig, reloadNginx } from "@/server/system/nginx";
import { nginxHelper } from "@/server/system/exec";
import { streamToFilename, generateStreamConfig } from "@/server/config-generator/stream-config";
import type { StreamHost } from "@prisma/client";

const STAGING_DIR = "/var/lib/rproxy/staging";

async function deployStreamConfig(host: StreamHost): Promise<void> {
  const filename = streamToFilename(host.name);
  const config = generateStreamConfig(host);
  await writeFile(join(STAGING_DIR, filename), config, "utf8");
  await nginxHelper("stream-deploy", filename);
}

export async function createStream(
  data: { name: string; protocol: string; listenPort: number; forwardHost: string; forwardPort: number },
  userId: string
): Promise<StreamHost> {
  const filename = streamToFilename(data.name);

  const stream = await prisma.streamHost.create({
    data: { ...data, configPath: `/etc/nginx/stream.d/${filename}` },
  });

  await deployStreamConfig(stream);
  await testNginxConfig();
  await reloadNginx();

  await prisma.auditLog.create({
    data: { userId, action: "CREATE", entity: "StreamHost", entityId: stream.id },
  });

  return stream;
}

export async function updateStream(
  id: string,
  data: Partial<{ name: string; protocol: string; listenPort: number; forwardHost: string; forwardPort: number }>,
  userId: string
): Promise<StreamHost> {
  const existing = await prisma.streamHost.findUniqueOrThrow({ where: { id } });

  // Remove old config file before rename
  if (data.name && data.name !== existing.name) {
    const oldFilename = streamToFilename(existing.name);
    await nginxHelper("stream-remove", oldFilename);
  }

  const stream = await prisma.streamHost.update({ where: { id }, data });
  const filename = streamToFilename(stream.name);
  await prisma.streamHost.update({ where: { id }, data: { configPath: `/etc/nginx/stream.d/${filename}` } });

  if (stream.enabled) {
    await deployStreamConfig(stream);
    await testNginxConfig();
    await reloadNginx();
  }

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "StreamHost", entityId: id },
  });

  return stream;
}

export async function deleteStream(id: string, userId: string): Promise<void> {
  const stream = await prisma.streamHost.findUniqueOrThrow({ where: { id } });
  const filename = streamToFilename(stream.name);

  await nginxHelper("stream-remove", filename);
  await reloadNginx();
  await prisma.streamHost.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "StreamHost", entityId: id },
  });
}

export async function toggleStream(id: string, userId: string): Promise<StreamHost> {
  const stream = await prisma.streamHost.findUniqueOrThrow({ where: { id } });
  const filename = streamToFilename(stream.name);

  const updated = await prisma.streamHost.update({
    where: { id },
    data: { enabled: !stream.enabled },
  });

  if (updated.enabled) {
    await deployStreamConfig(updated);
  } else {
    await nginxHelper("stream-remove", filename);
  }
  await reloadNginx();

  await prisma.auditLog.create({
    data: { userId, action: updated.enabled ? "ENABLE" : "DISABLE", entity: "StreamHost", entityId: id },
  });

  return updated;
}
