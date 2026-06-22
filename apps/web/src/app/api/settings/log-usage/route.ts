import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, fromError } from "@/lib/api-response";
import { nginxHelper } from "@/server/system/exec";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    const [sizeResult, setting] = await Promise.all([
      nginxHelper("log-size"),
      prisma.setting.findUnique({ where: { key: "log_max_gb" } }),
    ]);
    const usedBytes = parseInt(sizeResult.stdout) || 0;
    const maxGb = Math.max(1, parseInt(setting?.value ?? "10") || 10);
    return ok({ usedBytes, maxGb });
  } catch (e) {
    return fromError(e);
  }
}
