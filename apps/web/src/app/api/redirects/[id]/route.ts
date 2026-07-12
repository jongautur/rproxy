import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectHostSchema } from "@/lib/validation";
import { updateRedirect, deleteRedirect, toggleRedirect } from "@/server/services/redirect.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireSession();
    const { id } = await params;
    const redirect = await prisma.redirectHost.findUnique({
      where: { id },
      include: { certificate: true },
    });
    if (!redirect) return notFound();
    return ok(redirect);
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = await req.json() as unknown;

    if (typeof body === "object" && body !== null && "enabled" in body) {
      const { enabled } = body as { enabled: boolean };
      const { redirect, deploy } = await toggleRedirect(id, enabled, session.id);
      return ok({ redirect, nginxResult: deploy });
    }

    const parsed = redirectHostSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { redirect, deploy } = await updateRedirect(id, parsed.data, session.id);
    return ok({ redirect, nginxResult: deploy });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const deploy = await deleteRedirect(id, session.id);
    return ok({ deleted: true, nginxResult: deploy });
  } catch (e) {
    return fromError(e);
  }
}
