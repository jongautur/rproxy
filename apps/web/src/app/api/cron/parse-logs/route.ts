import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { parseLogsForProxy, pruneOldTrafficStats } from "@/server/services/log-parser";
import { ok, fromError } from "@/lib/api-response";

function unauthorized(msg = "Unauthorized") {
  return Response.json({ success: false, error: msg }, { status: 401 });
}

export async function POST(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return unauthorized("Cron not configured");

    const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(cronSecret);
    const valid = tokenBuf.length === secretBuf.length && timingSafeEqual(tokenBuf, secretBuf);
    if (!valid) return unauthorized("Invalid cron secret");

    const proxies = await prisma.proxyHost.findMany({
      where: { enabled: true, accessLog: true },
      select: { id: true, domain: true },
    });

    let totalBuckets = 0;
    for (const proxy of proxies) {
      totalBuckets += await parseLogsForProxy(proxy.id, proxy.domain);
    }

    await pruneOldTrafficStats();

    return ok({ parsed: proxies.length, newBuckets: totalBuckets });
  } catch (e) {
    return fromError(e);
  }
}
