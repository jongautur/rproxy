import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { proxyHostSchema } from "@/lib/validation";
import { createProxy } from "@/server/services/proxy.service";
import { ok, created, badRequest, forbidden, fromError } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("perPage") ?? "20", 10)));
    const search = searchParams.get("search") ?? "";
    const rawStatus = searchParams.get("status");
    const VALID_STATUSES = new Set(["ACTIVE", "DISABLED", "ERROR"]);
    const status = rawStatus && VALID_STATUSES.has(rawStatus) ? rawStatus : undefined;

    const where = {
      ...(search && {
        OR: [
          { domain: { contains: search, mode: "insensitive" as const } },
          { forwardHost: { contains: search, mode: "insensitive" as const } },
        ],
      }),
      ...(status && { status: status as "ACTIVE" | "DISABLED" | "ERROR" }),
    };

    const [items, total] = await Promise.all([
      prisma.proxyHost.findMany({
        where,
        include: { certificate: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.proxyHost.count({ where }),
    ]);

    return ok({
      items,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;

    const parsed = proxyHostSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.proxyHost.findUnique({
      where: { domain: parsed.data.domain },
    });
    if (existing) {
      return badRequest("A proxy for this domain already exists");
    }

    const { proxy, deploy } = await createProxy(parsed.data, session.id);

    return created({ proxy, nginxTest: deploy });
  } catch (e) {
    return fromError(e);
  }
}
