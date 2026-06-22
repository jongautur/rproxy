import { safeExec, sudoExec } from "./exec";
import { prisma } from "@/lib/prisma";
import type { NginxStatus } from "@/types/system";

export async function getNginxStatus(): Promise<NginxStatus> {
  const [isActiveResult, versionResult] = await Promise.all([
    sudoExec("/bin/systemctl", ["is-active", "nginx"]),
    safeExec("/usr/sbin/nginx", ["-v"]),
  ]);

  const running = isActiveResult.stdout === "active";

  const lastReloadSetting = await prisma.setting.findUnique({
    where: { key: "nginx_last_reload" },
  });
  const lastReloadSuccessSetting = await prisma.setting.findUnique({
    where: { key: "nginx_last_reload_success" },
  });
  const lastReloadOutputSetting = await prisma.setting.findUnique({
    where: { key: "nginx_last_reload_output" },
  });

  let activeConnections: number | undefined;
  if (running) {
    try {
      const statusResult = await sudoExec("/bin/systemctl", ["status", "nginx"]);
      const match = /Active connections: (\d+)/.exec(statusResult.stdout);
      if (match?.[1]) activeConnections = parseInt(match[1], 10);
    } catch {
      // nginx status stub not always available
    }
  }

  return {
    running,
    activeConnections,
    lastReload: lastReloadSetting?.value ? new Date(lastReloadSetting.value) : undefined,
    lastReloadSuccess: lastReloadSuccessSetting?.value === "true",
    lastReloadOutput: lastReloadOutputSetting?.value ?? undefined,
  };
}

export async function testNginxConfig(): Promise<{ success: boolean; output: string }> {
  const result = await sudoExec("/usr/sbin/nginx", ["-t"]);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return { success: result.exitCode === 0, output };
}

export async function reloadNginx(): Promise<{ success: boolean; output: string }> {
  const testResult = await testNginxConfig();
  if (!testResult.success) {
    return { success: false, output: `Config test failed:\n${testResult.output}` };
  }

  const result = await sudoExec("/bin/systemctl", ["reload", "nginx"]);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const success = result.exitCode === 0;

  await prisma.setting.upsert({
    where: { key: "nginx_last_reload" },
    create: { key: "nginx_last_reload", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });
  await prisma.setting.upsert({
    where: { key: "nginx_last_reload_success" },
    create: { key: "nginx_last_reload_success", value: String(success) },
    update: { value: String(success) },
  });
  await prisma.setting.upsert({
    where: { key: "nginx_last_reload_output" },
    create: { key: "nginx_last_reload_output", value: output },
    update: { value: output },
  });

  return { success, output };
}

export async function getNginxVersion(): Promise<string> {
  const result = await safeExec("/usr/sbin/nginx", ["-v"]);
  const raw = result.stderr || result.stdout;
  const match = /nginx\/([0-9.]+)/.exec(raw);
  return match?.[1] ?? "unknown";
}
