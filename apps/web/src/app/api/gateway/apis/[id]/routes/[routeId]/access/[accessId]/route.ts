import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiRouteAccessCreateSchema } from "@/lib/validation";
import { updateApiRouteAccess, deleteApiRouteAccess } from "@/server/services/api-gateway/access.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string; routeId: string; accessId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { accessId } = await params;

    const existing = await prisma.apiRouteAccess.findUnique({ where: { id: accessId } });
    if (!existing) return notFound("Access override not found");

    const body = (await req.json()) as unknown;
    const parsed = apiRouteAccessCreateSchema.omit({ customerId: true }).partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const access = await updateApiRouteAccess(existing.customerId, accessId, parsed.data, session.id);
    return ok(access);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { accessId } = await params;

    const existing = await prisma.apiRouteAccess.findUnique({ where: { id: accessId } });
    if (!existing) return notFound("Access override not found");

    await deleteApiRouteAccess(existing.customerId, accessId, session.id);
    return ok({ message: "Route access override removed" });
  } catch (e) {
    return fromError(e);
  }
}
