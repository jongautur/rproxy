import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiSchema } from "@/lib/validation";
import { updateApi, deleteApi } from "@/server/services/api-gateway/api.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;

    const api = await prisma.api.findUnique({
      where: { id },
      include: { certificate: true, routes: { orderBy: { createdAt: "asc" } } },
    });

    if (!api) return notFound("API not found");
    return ok(api);
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const api = await prisma.api.findUnique({ where: { id } });
    if (!api) return notFound("API not found");

    const body = (await req.json()) as unknown;
    const parsed = apiSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { api: updated, deploy } = await updateApi(id, parsed.data, session.id);
    return ok({ api: updated, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const api = await prisma.api.findUnique({ where: { id } });
    if (!api) return notFound("API not found");

    const deploy = await deleteApi(id, session.id);
    return ok({
      message: deploy.success ? "API deleted" : `API deleted, but nginx cleanup failed: ${deploy.output}`,
      nginxTest: deploy,
    });
  } catch (e) {
    return fromError(e);
  }
}
