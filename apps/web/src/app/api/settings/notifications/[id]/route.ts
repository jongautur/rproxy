import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateChannel, testChannel } from "@/server/services/notification.service";
import { ok, notFound, fromError } from "@/lib/api-response";

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json() as { label?: string; enabled?: boolean; config?: Record<string, string | number | boolean> };
    const channel = await prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) return notFound();
    await updateChannel(id, body.label ?? channel.label, body.enabled ?? channel.enabled, body.config);
    return ok({ updated: true });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.notificationChannel.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json() as { action?: string };
    if (body.action === "test") {
      const result = await testChannel(id);
      return ok(result);
    }
    return ok({ ok: false, error: "Unknown action" });
  } catch (e) {
    return fromError(e);
  }
}
