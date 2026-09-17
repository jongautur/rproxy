import { prisma } from "@/lib/prisma";
import type { CustomerFormData } from "@/types/api-gateway";
import type { Customer } from "@prisma/client";

// Plain CRUD — a Customer has no nginx config footprint of its own (unlike
// Api/ApiRoute), so no deploy step here.

export async function createCustomer(data: CustomerFormData, userId: string): Promise<Customer> {
  const customer = await prisma.customer.create({
    data: {
      name: data.name,
      email: data.email,
      enabled: data.enabled,
      notes: data.notes,
    },
  });

  await prisma.auditLog.create({
    data: { userId, action: "CREATE", entity: "Customer", entityId: customer.id, details: JSON.stringify({ name: customer.name }) },
  });

  return customer;
}

export async function updateCustomer(
  id: string,
  data: Partial<CustomerFormData>,
  userId: string
): Promise<Customer> {
  const customer = await prisma.customer.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: { userId, action: "UPDATE", entity: "Customer", entityId: id },
  });

  return customer;
}

export async function deleteCustomer(id: string, userId: string): Promise<void> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });

  // Cascades: apiKeys, access, routeAccess all onDelete: Cascade in schema.
  await prisma.customer.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { userId, action: "DELETE", entity: "Customer", entityId: id, details: JSON.stringify({ name: customer.name }) },
  });
}
