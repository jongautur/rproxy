import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setCloudflareProxied } from "@/server/services/proxy.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";
import { z } from "zod";

const toggleSchema = z.object({ proxied: z.boolean() });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const proxy = await prisma.proxyHost.findUnique({ where: { id } });
    if (!proxy) return notFound("Proxy not found");

    const body = await req.json() as unknown;
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return badRequest("Expected { proxied: boolean }");

    const updated = await setCloudflareProxied(id, parsed.data.proxied, session.id);
    return ok({ proxy: updated });
  } catch (e) {
    return fromError(e);
  }
}
