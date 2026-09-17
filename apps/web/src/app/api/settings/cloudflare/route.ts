import { type NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, fromError } from "@/lib/api-response";
import { verifyToken, saveIntegration, deleteIntegration } from "@/server/services/cloudflare.service";
import { z } from "zod";

const updateSchema = z.object({
  apiToken: z.string().min(1).max(256).optional(),
  ddnsEnabled: z.boolean().optional(),
  autoDnsEnabled: z.boolean().optional(),
  defaultProxied: z.boolean().optional(),
  proxyAfterSsl: z.boolean().optional(),
  deleteDnsWithHost: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireSession();
    const row = await prisma.cloudflareIntegration.findUnique({ where: { id: "singleton" } });
    return ok({
      configured: !!row,
      ddnsEnabled: row?.ddnsEnabled ?? false,
      autoDnsEnabled: row?.autoDnsEnabled ?? false,
      defaultProxied: row?.defaultProxied ?? false,
      proxyAfterSsl: row?.proxyAfterSsl ?? false,
      deleteDnsWithHost: row?.deleteDnsWithHost ?? false,
      lastPublicIp: row?.lastPublicIp ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
    });
  } catch (e) {
    return fromError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json() as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);

    const { apiToken, ddnsEnabled, autoDnsEnabled, defaultProxied, proxyAfterSsl, deleteDnsWithHost } = parsed.data;

    if (apiToken !== undefined) {
      const valid = await verifyToken(apiToken);
      if (!valid) return badRequest("Cloudflare rejected this API token — check it's valid and has Zone:DNS edit permission");
    }

    await saveIntegration({ apiToken, ddnsEnabled, autoDnsEnabled, defaultProxied, proxyAfterSsl, deleteDnsWithHost });
    return ok({ ok: true });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    await deleteIntegration();
    return ok({ ok: true });
  } catch (e) {
    return fromError(e);
  }
}
