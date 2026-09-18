import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiRouteSchema } from "@/lib/validation";
import { updateRoute, deleteRoute, getRoute } from "@/server/services/api-gateway/route.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string; routeId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id: apiId, routeId } = await params;

    const route = await getRoute(routeId);
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    return ok(route);
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: apiId, routeId } = await params;

    const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    const body = (await req.json()) as unknown;
    const parsed = apiRouteSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { route: updated, deploy } = await updateRoute(apiId, routeId, parsed.data, session.id);
    return ok({ route: updated, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: apiId, routeId } = await params;

    const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    const deploy = await deleteRoute(apiId, routeId, session.id);
    return ok({
      message: deploy.success ? "Route deleted" : `Route deleted, but nginx redeploy failed: ${deploy.output}`,
      nginxTest: deploy,
    });
  } catch (e) {
    return fromError(e);
  }
}
