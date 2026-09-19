import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiDocsSettingsSchema } from "@/lib/validation";
import { updateApiDocsSettings, getCoverage } from "@/server/services/api-gateway/docs.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ apiId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { apiId } = await params;

    const api = await prisma.api.findUnique({ where: { id: apiId } });
    if (!api) return notFound("API not found");

    const coverage = await getCoverage(apiId);
    return ok({ api, coverage });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { apiId } = await params;

    const api = await prisma.api.findUnique({ where: { id: apiId } });
    if (!api) return notFound("API not found");

    const body = (await req.json()) as unknown;
    const parsed = apiDocsSettingsSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { api: updated, deploy } = await updateApiDocsSettings(apiId, parsed.data, session.id);
    return ok({ api: updated, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}
