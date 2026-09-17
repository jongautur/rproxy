import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toggleApi } from "@/server/services/api-gateway/api.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";
import { z } from "zod";

const toggleSchema = z.object({ enabled: z.boolean() });

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const api = await prisma.api.findUnique({ where: { id } });
    if (!api) return notFound("API not found");

    const body = (await req.json()) as unknown;
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return badRequest("Expected { enabled: boolean }");

    const { api: updated, deploy } = await toggleApi(id, parsed.data.enabled, session.id);
    return ok({ api: updated, nginxReload: deploy });
  } catch (e) {
    return fromError(e);
  }
}
