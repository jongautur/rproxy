import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { apiAccessSchema } from "@/lib/validation";
import { updateApiAccess, deleteApiAccess } from "@/server/services/api-gateway/access.service";
import { ok, badRequest, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string; accessId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId, accessId } = await params;

    const body = (await req.json()) as unknown;
    const parsed = apiAccessSchema.omit({ apiId: true }).partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const access = await updateApiAccess(customerId, accessId, parsed.data, session.id);
    return ok(access);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId, accessId } = await params;

    await deleteApiAccess(customerId, accessId, session.id);
    return ok({ message: "Access grant removed" });
  } catch (e) {
    return fromError(e);
  }
}
