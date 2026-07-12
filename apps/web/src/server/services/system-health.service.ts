import { access, constants, mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { getNginxStatus } from "@/server/system/nginx";

const STAGING_DIR = "/var/lib/rproxy/staging";

export interface HealthCheck {
  status: "up" | "down";
  detail?: string;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  checks: {
    database: HealthCheck;
    nginx: HealthCheck;
    disk: HealthCheck;
    acme: HealthCheck;
  };
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "up" };
  } catch (e) {
    return { status: "down", detail: e instanceof Error ? e.message : "query failed" };
  }
}

async function checkNginx(): Promise<HealthCheck> {
  try {
    const { running } = await getNginxStatus();
    return running ? { status: "up" } : { status: "down", detail: "systemctl reports nginx inactive" };
  } catch (e) {
    return { status: "down", detail: e instanceof Error ? e.message : "status check failed" };
  }
}

async function checkDisk(): Promise<HealthCheck> {
  const probePath = path.join(STAGING_DIR, `.health-${process.pid}`);
  try {
    await mkdir(STAGING_DIR, { recursive: true });
    await writeFile(probePath, "ok");
    await unlink(probePath);
    return { status: "up" };
  } catch (e) {
    return { status: "down", detail: e instanceof Error ? e.message : "staging dir not writable" };
  }
}

async function checkAcme(): Promise<HealthCheck> {
  const home = process.env.HOME;
  if (!home) return { status: "down", detail: "HOME not set" };
  try {
    await access(`${home}/.acme.sh/acme.sh`, constants.X_OK);
    return { status: "up" };
  } catch {
    return { status: "down", detail: "acme.sh not found or not executable" };
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [database, nginx, disk, acme] = await Promise.all([
    checkDatabase(), checkNginx(), checkDisk(), checkAcme(),
  ]);

  const status = [database, nginx, disk, acme].every((c) => c.status === "up") ? "ok" : "degraded";

  return { status, checks: { database, nginx, disk, acme } };
}
