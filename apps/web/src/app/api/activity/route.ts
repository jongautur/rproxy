import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, fromError } from "@/lib/api-response";

export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const page     = Math.max(1, parseInt(searchParams.get("page")    ?? "1",  10));
    const perPage  = Math.min(100, Math.max(10, parseInt(searchParams.get("perPage") ?? "25", 10)));
    const action   = searchParams.get("action")  ?? "";
    const entity   = searchParams.get("entity")  ?? "";
    const userId   = searchParams.get("userId")  ?? "";
    const search   = searchParams.get("search")  ?? "";

    const where = {
      ...(action && { action: action as never }),
      ...(entity && { entity: { contains: entity, mode: "insensitive" as const } }),
      ...(userId && { userId }),
      ...(search && {
        OR: [
          { entity:    { contains: search, mode: "insensitive" as const } },
          { entityId:  { contains: search, mode: "insensitive" as const } },
          { details:   { contains: search, mode: "insensitive" as const } },
          { ipAddress: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { user: { select: { username: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return ok({ items, total, page, perPage, totalPages: Math.ceil(total / perPage) });
  } catch (e) {
    return fromError(e);
  }
}
