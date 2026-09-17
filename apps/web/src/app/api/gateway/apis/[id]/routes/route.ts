import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiRouteSchema } from "@/lib/validation";
import { createRoute } from "@/server/services/api-gateway/route.service";
import { ok, created, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id: apiId } = await params;

    const api = await prisma.api.findUnique({ where: { id: apiId } });
    if (!api) return notFound("API not found");

    const routes = await prisma.apiRoute.findMany({
      where: { apiId },
      orderBy: { createdAt: "asc" },
    });
    return ok(routes);
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: apiId } = await params;

    const api = await prisma.api.findUnique({ where: { id: apiId } });
    if (!api) return notFound("API not found");

    const body = (await req.json()) as unknown;
    const parsed = apiRouteSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    // One route per (api, path) now — its `methods` field holds the whole
    // set it accepts, rather than one row per method (see the API Gateway
    // method-scoping plan for why: a route is one location block/one
    // upstream, serving a defined method set).
    const existing = await prisma.apiRoute.findUnique({
      where: { apiId_path: { apiId, path: parsed.data.path } },
    });
    if (existing) return badRequest("A route with this path already exists on this API");

    const { route, deploy } = await createRoute(apiId, parsed.data, session.id);
    return created({ route, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}
