import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirectHostSchema } from "@/lib/validation";
import { createRedirect } from "@/server/services/redirect.service";
import { ok, created, badRequest, fromError } from "@/lib/api-response";

export async function GET() {
  try {
    await requireSession();
    const items = await prisma.redirectHost.findMany({
      include: { certificate: true },
      orderBy: { createdAt: "desc" },
    });
    return ok({ items });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;

    const parsed = redirectHostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.redirectHost.findUnique({
      where: { sourceDomain: parsed.data.sourceDomain },
    });
    if (existing) {
      return badRequest("A redirect for this domain already exists");
    }

    const { redirect, deploy } = await createRedirect(parsed.data, session.id);
    return created({ redirect, nginxResult: deploy });
  } catch (e) {
    return fromError(e);
  }
}
