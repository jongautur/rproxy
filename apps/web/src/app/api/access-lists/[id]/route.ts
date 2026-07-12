import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { ok, forbidden, fromError } from "@/lib/api-response";
import { z } from "zod";
import {
  getAccessList, updateAccessList, deleteAccessList,
  isValidIpOrCidr, isValidHtpasswdUsername,
} from "@/server/services/access-list.service";

const ipRuleSchema = z.object({
  address: z.string().min(1).max(50).refine(isValidIpOrCidr, "Invalid IP address or CIDR"),
  action: z.enum(["allow", "deny"]),
});

const updateSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9 _-]+$/).optional(),
  authEnabled: z.boolean().optional(),
  authRealm: z.string().max(128).optional(),
  defaultAction: z.enum(["allow", "deny"]).optional(),
  addUsers: z.array(z.object({
    username: z.string().min(1).max(64).refine(isValidHtpasswdUsername, "Invalid username"),
    password: z.string().min(1).max(256),
  })).optional(),
  deleteUserIds: z.array(z.string()).optional(),
  ipRules: z.array(ipRuleSchema).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const list = await getAccessList(id).catch(() => null);
    if (!list) return ok({ error: "Not found" }, 404);
    return ok({ list });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const { id } = await params;
    const body = await req.json() as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return ok({ error: parsed.error.message }, 400);

    const data = parsed.data;
    const list = await updateAccessList(id, {
      ...data,
      ipRules: data.ipRules?.map((r, i) => ({ ...r, sortOrder: i })),
    });
    return ok({ list });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const { id } = await params;
    await deleteAccessList(id);
    return ok({ deleted: true });
  } catch (e) {
    return fromError(e);
  }
}
