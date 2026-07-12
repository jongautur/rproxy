import { type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { ok, unauthorized, fromError } from "@/lib/api-response";
import { nginxHelper } from "@/server/system/exec";
import { pruneOldAuditLogs } from "@/server/services/log-parser";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return unauthorized("CRON_SECRET not configured");

    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(cronSecret);
    const valid = tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf);
    if (!valid) return unauthorized("Invalid cron secret");

    const setting = await prisma.setting.findUnique({ where: { key: "log_max_gb" } });
    const maxGb = Math.max(1, parseInt(setting?.value ?? "10") || 10);
    const maxBytes = maxGb * 1073741824;
    const result = await nginxHelper("log-clean", String(maxBytes));

    await pruneOldAuditLogs();

    // userId: null — cron path, not a logged-in admin. The activity UI
    // already renders a null user as "system".
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: "DELETE",
        entity: "Logs",
        details: JSON.stringify({ maxGb, cleaned: result.exitCode === 0 }),
      },
    });

    return ok({ cleaned: result.exitCode === 0, output: result.stdout });
  } catch (e) {
    return fromError(e);
  }
}
