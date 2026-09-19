import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiRouteDocsSchema } from "@/lib/validation";
import { updateRouteDocs } from "@/server/services/api-gateway/docs.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ apiId: string; routeId: string }>;
}

// Doc metadata never affects nginx config (see docs.service.ts) — this
// endpoint is a plain DB write, unlike the sibling
// apis/[id]/routes/[routeId] endpoint which always redeploys.
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { apiId, routeId } = await params;

    const route = await prisma.apiRoute.findUnique({ where: { id: routeId } });
    if (!route || route.apiId !== apiId) return notFound("Route not found");

    const body = (await req.json()) as unknown;
    const parsed = apiRouteDocsSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const updated = await updateRouteDocs(apiId, routeId, parsed.data, session.id);
    return ok(updated);
  } catch (e) {
    return fromError(e);
  }
}
