import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiAccessSchema } from "@/lib/validation";
import { listApiAccess, createApiAccess } from "@/server/services/api-gateway/access.service";
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

    const access = await listApiAccess(customerId);
    return ok(access);
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id: customerId } = await params;

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return notFound("Customer not found");

    const body = (await req.json()) as unknown;
    const parsed = apiAccessSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.apiAccess.findUnique({
      where: { customerId_apiId: { customerId, apiId: parsed.data.apiId } },
    });
    if (existing) return badRequest("This customer already has a grant for this API");

    const access = await createApiAccess(customerId, parsed.data, session.id);
    return created(access);
  } catch (e) {
    return fromError(e);
  }
}
