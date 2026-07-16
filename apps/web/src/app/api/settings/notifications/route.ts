import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createChannel, NOTIFICATION_EVENT_TYPES } from "@/server/services/notification.service";
import { decryptJson } from "@/lib/encrypt";
import { ok, created, badRequest, fromError } from "@/lib/api-response";
import { z } from "zod";
import { emailConfigSchema, webhookConfigSchema, homeAssistantConfigSchema } from "@/lib/notification-config";

const eventsField = z.array(z.enum(NOTIFICATION_EVENT_TYPES)).min(1).default([...NOTIFICATION_EVENT_TYPES]);

const emailSchema = z.object({
  type: z.literal("email"),
  label: z.string().max(64).default("Email"),
  events: eventsField,
}).merge(emailConfigSchema);

const webhookSchema = z.object({
  type: z.literal("webhook"),
  label: z.string().max(64).default("Webhook"),
  events: eventsField,
}).merge(webhookConfigSchema);

const homeAssistantSchema = z.object({
  type: z.literal("home_assistant"),
  label: z.string().max(64).default("Home Assistant"),
  events: eventsField,
}).merge(homeAssistantConfigSchema);

export async function GET() {
  try {
    await requireSession();
    const channels = await prisma.notificationChannel.findMany({ orderBy: { createdAt: "asc" } });
    // Return channels with config decrypted but password/secret masked
    const safe = channels.map((ch) => {
      let config: Record<string, string> = {};
      try { config = decryptJson(ch.config); } catch { /* ignore */ }
      if (ch.type === "email") {
        config = { ...config, password: config.password ? "••••••••" : "" };
      } else if (ch.type === "webhook") {
        config = { ...config, secret: config.secret ? "••••••••" : "" };
      } else if (ch.type === "home_assistant") {
        config = { ...config, accessToken: config.accessToken ? "••••••••" : "" };
      }
      let events: string[] = [...NOTIFICATION_EVENT_TYPES];
      try {
        const parsed = JSON.parse(ch.events) as unknown;
        if (Array.isArray(parsed)) events = parsed as string[];
      } catch { /* ignore, fall back to all */ }
      return { ...ch, config, events };
    });
    return ok({ channels: safe });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json() as unknown;

    const base = z.object({ type: z.enum(["email", "webhook", "home_assistant"]) }).safeParse(body);
    if (!base.success) return badRequest("type must be email, webhook, or home_assistant");

    if (base.data.type === "email") {
      const parsed = emailSchema.safeParse(body);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      const { type, label, events, ...config } = parsed.data;
      await createChannel(type, label, config as Record<string, string | number | boolean>, events);
    } else if (base.data.type === "home_assistant") {
      const parsed = homeAssistantSchema.safeParse(body);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      const { type, label, events, ...config } = parsed.data;
      await createChannel(type, label, config as Record<string, string | number | boolean>, events);
    } else {
      const parsed = webhookSchema.safeParse(body);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      const { type, label, events, ...config } = parsed.data;
      await createChannel(type, label, config as Record<string, string | number | boolean>, events);
    }

    return created({ ok: true });
  } catch (e) {
    return fromError(e);
  }
}
