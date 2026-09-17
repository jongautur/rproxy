import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerSchema } from "@/lib/validation";
import { updateCustomer, deleteCustomer } from "@/server/services/api-gateway/customer.service";
import { listApiKeys } from "@/server/services/api-gateway/api-key.service";
import { listApiAccess } from "@/server/services/api-gateway/access.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return notFound("Customer not found");

    const [apiKeys, access] = await Promise.all([listApiKeys(id), listApiAccess(id)]);

    return ok({ ...customer, apiKeys, access });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return notFound("Customer not found");

    const body = (await req.json()) as unknown;
    const parsed = customerSchema.partial().safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const updated = await updateCustomer(id, parsed.data, session.id);
    return ok(updated);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return notFound("Customer not found");

    await deleteCustomer(id, session.id);
    return ok({ message: "Customer deleted" });
  } catch (e) {
    return fromError(e);
  }
}
