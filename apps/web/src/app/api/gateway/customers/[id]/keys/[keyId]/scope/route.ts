import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { apiKeyScopeSchema } from "@/lib/validation";
import { getKeyScope, setKeyScope } from "@/server/services/api-gateway/api-key.service";
import { ok, badRequest, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string; keyId: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id: customerId, keyId } = await params;
    const scope = await getKeyScope(customerId, keyId);
    return ok(scope);
  } catch (e) {
    return fromError(e);
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId, keyId } = await params;

    const body = (await req.json()) as unknown;
    const parsed = apiKeyScopeSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const scope = await setKeyScope(customerId, keyId, parsed.data.scopeRestricted, parsed.data.routes, session.id);
    return ok(scope);
  } catch (e) {
    return fromError(e);
  }
}
