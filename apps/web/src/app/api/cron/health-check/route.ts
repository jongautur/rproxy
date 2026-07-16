import { type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { runHealthSweep } from "@/server/services/health.service";
import { ok, unauthorized, fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return unauthorized("CRON_SECRET not configured");
    }

    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(cronSecret);
    const valid = tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf);
    if (!valid) {
      return unauthorized("Invalid cron secret");
    }

    const results = await runHealthSweep();
    return ok({ message: "Health sweep complete", hostsChecked: Object.keys(results).length });
  } catch (e) {
    return fromError(e);
  }
}
