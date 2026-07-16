import { z } from "zod";

// Config-only schemas (no type/label) shared between channel creation
// (all fields required as appropriate) and editing (all fields optional —
// the edit UI only sends fields the admin actually changed, since masked
// secrets like password/secret/accessToken are never round-tripped back
// to the client in plaintext).
export const emailConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  username: z.string().default(""),
  password: z.string().default(""),
  from: z.string().email(),
  to: z.string().email(),
});

export const webhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().max(256).default(""),
});

export const homeAssistantConfigSchema = z.object({
  url: z.string().url(),
  accessToken: z.string().min(1),
  notificationService: z.string().max(128).default(""),
});

export const CHANNEL_TYPES = ["email", "webhook", "home_assistant"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export function configSchemaFor(type: ChannelType) {
  if (type === "email") return emailConfigSchema;
  if (type === "home_assistant") return homeAssistantConfigSchema;
  return webhookConfigSchema;
}
