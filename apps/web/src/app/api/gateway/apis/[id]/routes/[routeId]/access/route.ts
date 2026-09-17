import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiRouteAccessCreateSchema } from "@/lib/validation";
import { createApiRouteAccess } from "@/server/services/api-gateway/access.service";
import { ok, created, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string; routeId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id: apiId, routeId } = await params;

    const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    const overrides = await prisma.apiRouteAccess.findMany({
      where: { routeId },
      orderBy: { createdAt: "desc" },
    });
    return ok(overrides);
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: apiId, routeId } = await params;

    const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    const body = (await req.json()) as unknown;
    const parsed = apiRouteAccessCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.apiRouteAccess.findUnique({
      where: { customerId_routeId: { customerId: parsed.data.customerId, routeId } },
    });
    if (existing) return badRequest("This customer already has an override for this route");

    const access = await createApiRouteAccess(parsed.data.customerId, { ...parsed.data, routeId }, session.id);
    return created(access);
  } catch (e) {
    return fromError(e);
  }
}
