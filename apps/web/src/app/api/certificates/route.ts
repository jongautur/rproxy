import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { certificateSchema } from "@/lib/validation";
import { createCertificate } from "@/server/services/certificate.service";
import { ok, created, badRequest, fromError } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("perPage") ?? "20", 10)));
    const search = searchParams.get("search") ?? "";

    const where = search
      ? { domain: { contains: search, mode: "insensitive" as const } }
      : {};

    const [items, total] = await Promise.all([
      prisma.certificate.findMany({
        where,
        include: { proxyHosts: { select: { id: true, domain: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.certificate.count({ where }),
    ]);

    return ok({ items, total, page, perPage, totalPages: Math.ceil(total / perPage) });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;

    const parsed = certificateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { certificate, output } = await createCertificate(parsed.data, session.id);
    return created({ certificate, output });
  } catch (e) {
    return fromError(e);
  }
}
