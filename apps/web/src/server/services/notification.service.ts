import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "@/lib/encrypt";

export interface NotificationEvent {
  type: "host_down" | "host_up" | "cert_expiring" | "cert_renewal_failed";
  title: string;
  body: string;
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string;
}

interface WebhookConfig {
  url: string;
  secret?: string;
}

async function sendEmail(config: EmailConfig, event: NotificationEvent): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
  });

  await transport.sendMail({
    from: config.from,
    to: config.to,
    subject: `[rproxy] ${event.title}`,
    text: event.body,
    html: `<p>${event.body.replace(/\n/g, "<br>")}</p>`,
  });
}

async function sendWebhook(config: WebhookConfig, event: NotificationEvent): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.secret) headers["X-Webhook-Secret"] = config.secret;

  const res = await fetch(config.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ event: event.type, title: event.title, body: event.body, timestamp: new Date().toISOString() }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

export async function fireNotification(event: NotificationEvent): Promise<void> {
  const channels = await prisma.notificationChannel.findMany({ where: { enabled: true } });
  const errors: string[] = [];

  for (const channel of channels) {
    try {
      const config = decryptJson(channel.config);
      if (channel.type === "email") {
        await sendEmail(config as unknown as EmailConfig, event);
      } else if (channel.type === "webhook") {
        await sendWebhook(config as unknown as WebhookConfig, event);
      }
    } catch (e) {
      errors.push(`${channel.type}(${channel.id}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length > 0) {
    console.error("[notifications] delivery errors:", errors.join("; "));
  }
}

export async function testChannel(id: string): Promise<{ success: boolean; error?: string }> {
  const channel = await prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
  try {
    const config = decryptJson(channel.config);
    const event: NotificationEvent = {
      type: "host_up",
      title: "rproxy notification test",
      body: "This is a test notification from rproxy. If you received this, your notification channel is working correctly.",
    };
    if (channel.type === "email") {
      await sendEmail(config as unknown as EmailConfig, event);
    } else {
      await sendWebhook(config as unknown as WebhookConfig, event);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createChannel(
  type: "email" | "webhook",
  label: string,
  config: Record<string, string | number | boolean>
): Promise<void> {
  const strConfig = Object.fromEntries(
    Object.entries(config).map(([k, v]) => [k, String(v)])
  );
  await prisma.notificationChannel.create({
    data: { type, label, config: encryptJson(strConfig) },
  });
}

export async function updateChannel(
  id: string,
  label: string,
  enabled: boolean,
  config?: Record<string, string | number | boolean>
): Promise<void> {
  const data: { label: string; enabled: boolean; config?: string } = { label, enabled };
  if (config) {
    const strConfig = Object.fromEntries(
      Object.entries(config).map(([k, v]) => [k, String(v)])
    );
    data.config = encryptJson(strConfig);
  }
  await prisma.notificationChannel.update({ where: { id }, data });
}
