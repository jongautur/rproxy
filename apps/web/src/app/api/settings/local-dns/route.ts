import { type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { ok, badRequest, fromError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { getLocalDns, saveLocalDns, localDnsSchema, technitiumRequest, LOCAL_DNS_KEY } from "@/server/services/local-dns.service";

export async function GET() {
  try {
    await requireAdmin();
    const config = await getLocalDns();
    return ok(config ? { configured: true, serverUrl: config.serverUrl, targetIp: config.targetIp, enabled: config.enabled } : { configured: false, serverUrl: "", targetIp: "", enabled: false });
  } catch (e) { return fromError(e); }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const input = await req.json();
    const existing = await getLocalDns();
    const parsed = localDnsSchema.safeParse({ ...input, apiToken: input?.apiToken || existing?.apiToken });
    if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    try { await technitiumRequest(parsed.data, "user/session/get"); }
    catch (error) { return badRequest(error instanceof Error ? error.message : "Could not connect to Technitium."); }
    await saveLocalDns(parsed.data);
    return ok({ ok: true });
  } catch (e) { return fromError(e); }
}

export async function DELETE() {
  try {
    await requireAdmin();
    await prisma.setting.deleteMany({ where: { key: LOCAL_DNS_KEY } });
    return ok({ ok: true });
  } catch (e) { return fromError(e); }
}
