import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createChannel } from "@/server/services/notification.service";
import { decryptJson } from "@/lib/encrypt";
import { ok, created, badRequest, fromError } from "@/lib/api-response";
import { z } from "zod";

const emailSchema = z.object({
  type: z.literal("email"),
  label: z.string().max(64).default("Email"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().default(""),
  password: z.string().default(""),
  from: z.string().email(),
  to: z.string().email(),
});

const webhookSchema = z.object({
  type: z.literal("webhook"),
  label: z.string().max(64).default("Webhook"),
  url: z.string().url(),
  secret: z.string().max(256).default(""),
});

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
      }
      return { ...ch, config };
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

    const base = z.object({ type: z.enum(["email", "webhook"]) }).safeParse(body);
    if (!base.success) return badRequest("type must be email or webhook");

    if (base.data.type === "email") {
      const parsed = emailSchema.safeParse(body);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      const { type, label, ...config } = parsed.data;
      await createChannel(type, label, config as Record<string, string | number | boolean>);
    } else {
      const parsed = webhookSchema.safeParse(body);
      if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
      const { type, label, ...config } = parsed.data;
      await createChannel(type, label, config as Record<string, string | number | boolean>);
    }

    return created({ ok: true });
  } catch (e) {
    return fromError(e);
  }
}
