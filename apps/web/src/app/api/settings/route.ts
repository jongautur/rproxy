import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, forbidden, fromError } from "@/lib/api-response";
import { z } from "zod";

const updateSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  value: z.string().max(4096),
});

const ALLOWED_SETTING_KEYS = new Set([
  "app_title",
  "health_check_interval",
  "auto_renew_enabled",
  "log_max_gb",
]);

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const [users, settings] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, username: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.setting.findMany({ orderBy: { key: "asc" } }),
    ]);

    return ok({ users, settings });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const body = await req.json() as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return ok({ error: parsed.error.message }, 400);

    const { key, value } = parsed.data;
    if (!ALLOWED_SETTING_KEYS.has(key)) return ok({ error: "Unknown setting key" }, 400);

    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    return ok({ setting });
  } catch (e) {
    return fromError(e);
  }
}
