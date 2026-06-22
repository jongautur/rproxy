import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { probeProxy, recordHealthCheck } from "@/server/services/health.service";
import { ok, notFound, fromError } from "@/lib/api-response";

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    await requireSession();
    const { id } = await params;

    const proxy = await prisma.proxyHost.findUnique({ where: { id } });
    if (!proxy) return notFound("Proxy host not found");

    const result = await probeProxy(proxy);
    await recordHealthCheck(id, result);

    return ok(result);
  } catch (e) {
    return fromError(e);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireSession();
    const { id } = await params;

    const checks = await prisma.healthCheck.findMany({
      where: { proxyHostId: id },
      orderBy: { checkedAt: "desc" },
      take: 20,
    });

    return ok({ checks });
  } catch (e) {
    return fromError(e);
  }
}
