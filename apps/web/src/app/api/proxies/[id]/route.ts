import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proxyHostSchema } from "@/lib/validation";
import { updateProxy, deleteProxy, toggleProxy } from "@/server/services/proxy.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;

    const proxy = await prisma.proxyHost.findUnique({
      where: { id },
      include: { certificate: true },
    });

    if (!proxy) return notFound("Proxy not found");
    return ok(proxy);
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const proxy = await prisma.proxyHost.findUnique({ where: { id } });
    if (!proxy) return notFound("Proxy not found");

    const body = await req.json() as unknown;

    // Support partial updates (PATCH)
    const parsed = proxyHostSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { proxy: updated, deploy } = await updateProxy(id, parsed.data, session.id);
    return ok({ proxy: updated, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const proxy = await prisma.proxyHost.findUnique({ where: { id } });
    if (!proxy) return notFound("Proxy not found");

    const deploy = await deleteProxy(id, session.id);
    return ok({
      message: deploy.success
        ? "Proxy deleted"
        : `Proxy deleted, but nginx cleanup failed: ${deploy.output}`,
      nginxTest: deploy,
    });
  } catch (e) {
    return fromError(e);
  }
}
