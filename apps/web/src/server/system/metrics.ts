import { readFile } from "fs/promises";
import { getNginxVersion } from "./nginx";
import type { SystemInfo } from "@/types/system";

async function getMemoryInfo(): Promise<SystemInfo["memory"]> {
  const raw = await readFile("/proc/meminfo", "utf-8");
  const parse = (key: string): number => {
    const match = new RegExp(`^${key}:\\s+(\\d+)`,"m").exec(raw);
    return match ? parseInt(match[1]!, 10) * 1024 : 0;
  };
  const total = parse("MemTotal");
  const free = parse("MemFree");
  const buffers = parse("Buffers");
  const cached = parse("Cached");
  const sreclaimable = parse("SReclaimable");
  const used = total - free - buffers - cached - sreclaimable;

  return {
    total,
    used: Math.max(0, used),
    free: free + buffers + cached,
    usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
  };
}

async function getDiskInfo(): Promise<SystemInfo["disk"]> {
  // Read disk usage from /proc/mounts + statvfs via Node's fs.statfs (Node 18+)
  try {
    const { statfs } = await import("fs/promises");
    const stats = await statfs("/");
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - stats.bfree * stats.bsize;
    return {
      total,
      used,
      free,
      usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
    };
  } catch {
    return { total: 0, used: 0, free: 0, usagePercent: 0 };
  }
}

async function getLoadAverage(): Promise<[number, number, number]> {
  const raw = await readFile("/proc/loadavg", "utf-8");
  const parts = raw.split(" ");
  return [
    parseFloat(parts[0] ?? "0"),
    parseFloat(parts[1] ?? "0"),
    parseFloat(parts[2] ?? "0"),
  ];
}

async function getUptime(): Promise<number> {
  const raw = await readFile("/proc/uptime", "utf-8");
  return parseFloat(raw.split(" ")[0] ?? "0");
}

async function getCpuUsage(): Promise<{ usage: number; cores: number }> {
  const raw1 = await readFile("/proc/stat", "utf-8");
  await new Promise((r) => setTimeout(r, 200));
  const raw2 = await readFile("/proc/stat", "utf-8");

  function parseCpu(raw: string) {
    const line = /^cpu\s+(.+)$/.exec(raw)?.at(1) ?? "";
    const nums = line.split(" ").map(Number);
    const user = nums[0] ?? 0;
    const nice = nums[1] ?? 0;
    const system = nums[2] ?? 0;
    const idle = nums[3] ?? 0;
    const iowait = nums[4] ?? 0;
    const irq = nums[5] ?? 0;
    const softirq = nums[6] ?? 0;
    const total = user + nice + system + idle + iowait + irq + softirq;
    return { idle, total };
  }

  const c1 = parseCpu(raw1);
  const c2 = parseCpu(raw2);
  const diffTotal = c2.total - c1.total;
  const diffIdle = c2.idle - c1.idle;
  const usage = diffTotal > 0 ? Math.round(((diffTotal - diffIdle) / diffTotal) * 100) : 0;

  const cpuCount = (raw1.match(/^cpu\d/gm) ?? []).length;

  return { usage, cores: cpuCount || 1 };
}

async function getHostname(): Promise<string> {
  const raw = await readFile("/proc/sys/kernel/hostname", "utf-8");
  return raw.trim();
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const [memory, disk, loadAverage, uptime, cpu, hostname, nginxVersion] = await Promise.all([
    getMemoryInfo(),
    getDiskInfo(),
    getLoadAverage(),
    getUptime(),
    getCpuUsage(),
    getHostname(),
    getNginxVersion().catch(() => "unknown"),
  ]);

  return {
    hostname,
    uptime,
    loadAverage,
    cpu,
    memory,
    disk,
    nginxVersion,
    nodeVersion: process.version,
  };
}
