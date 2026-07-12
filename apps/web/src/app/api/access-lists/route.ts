import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { ok, forbidden, fromError } from "@/lib/api-response";
import { z } from "zod";
import {
  createAccessList, listAccessLists,
  isValidIpOrCidr, isValidHtpasswdUsername,
} from "@/server/services/access-list.service";

const ipRuleSchema = z.object({
  address: z.string().min(1).max(50).refine(isValidIpOrCidr, "Invalid IP address or CIDR"),
  action: z.enum(["allow", "deny"]),
});

const createSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9 _-]+$/, "Name contains invalid characters"),
  authEnabled: z.boolean().default(false),
  authRealm: z.string().max(128).default("Restricted"),
  defaultAction: z.enum(["allow", "deny"]).default("deny"),
  users: z.array(z.object({
    username: z.string().min(1).max(64).refine(isValidHtpasswdUsername, "Invalid username characters"),
    password: z.string().min(1).max(256),
  })).default([]),
  ipRules: z.array(ipRuleSchema).default([]),
});

export async function GET() {
  try {
    await requireSession();
    const lists = await listAccessLists();
    return ok({ lists });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const body = await req.json() as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return ok({ error: parsed.error.message }, 400);

    const list = await createAccessList({
      ...parsed.data,
      ipRules: parsed.data.ipRules.map((r, i) => ({ ...r, sortOrder: i })),
    });
    return ok({ list }, 201);
  } catch (e) {
    return fromError(e);
  }
}
