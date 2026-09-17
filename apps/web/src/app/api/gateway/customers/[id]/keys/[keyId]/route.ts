import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { toggleApiKey, revokeApiKey } from "@/server/services/api-gateway/api-key.service";
import { ok, badRequest, fromError } from "@/lib/api-response";
import { z } from "zod";

const toggleSchema = z.object({ enabled: z.boolean() });

interface RouteParams {
  params: Promise<{ id: string; keyId: string }>;
}

// PATCH pauses/resumes a key (reversible). DELETE permanently revokes it
// (irreversible — sets revokedAt in addition to disabling).
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId, keyId } = await params;

    const body = (await req.json()) as unknown;
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return badRequest("Expected { enabled: boolean }");

    const apiKey = await toggleApiKey(customerId, keyId, parsed.data.enabled, session.id);
    return ok(apiKey);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId, keyId } = await params;

    const apiKey = await revokeApiKey(customerId, keyId, session.id);
    return ok({ message: "API key revoked", apiKey });
  } catch (e) {
    return fromError(e);
  }
}
