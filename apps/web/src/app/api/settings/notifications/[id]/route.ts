import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateChannel, testChannel, NOTIFICATION_EVENT_TYPES, type NotificationEventType } from "@/server/services/notification.service";
import { ok, notFound, badRequest, fromError } from "@/lib/api-response";
import { configSchemaFor, CHANNEL_TYPES, type ChannelType } from "@/lib/notification-config";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const eventsSchema = z.array(z.enum(NOTIFICATION_EVENT_TYPES)).min(1);

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json() as { label?: string; enabled?: boolean; config?: Record<string, unknown>; events?: unknown };
    const channel = await prisma.notificationChannel.findUnique({ where: { id } });
    if (!channel) return notFound();

    let config: Record<string, string | number | boolean> | undefined;
    if (body.config) {
      if (!CHANNEL_TYPES.includes(channel.type as ChannelType)) return badRequest("Unknown channel type");
      const parsed = configSchemaFor(channel.type as ChannelType).partial().safeParse(body.config);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      config = parsed.data as Record<string, string | number | boolean>;
    }

    let events: NotificationEventType[] | undefined;
    if (body.events !== undefined) {
      const parsed = eventsSchema.safeParse(body.events);
      if (!parsed.success) return badRequest("events must be a non-empty array of valid event types");
      events = parsed.data;
    }

    await updateChannel(id, body.label ?? channel.label, body.enabled ?? channel.enabled, config, events);
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
