import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiKeyCreateSchema } from "@/lib/validation";
import { listApiKeys, generateApiKey } from "@/server/services/api-gateway/api-key.service";
import { ok, created, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id: customerId } = await params;

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return notFound("Customer not found");

    const keys = await listApiKeys(customerId);
    return ok(keys);
  } catch (e) {
    return fromError(e);
  }
}

// Returns the plaintext key exactly once — the client must show it to the
// admin immediately and never request it again (GET only ever returns
// keyPrefix, never keyHash or the plaintext).
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId } = await params;

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return notFound("Customer not found");

    const body = (await req.json()) as unknown;
    const parsed = apiKeyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const result = await generateApiKey(customerId, parsed.data.label, parsed.data.expiresAt, session.id);
    return created(result);
  } catch (e) {
    return fromError(e);
  }
}
