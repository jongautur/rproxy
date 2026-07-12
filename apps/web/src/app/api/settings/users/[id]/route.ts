import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, forbidden, notFound, fromError } from "@/lib/api-response";
import { z } from "zod";

interface Params { params: Promise<{ id: string }> }

const patchSchema = z.object({
  role: z.enum(["ADMIN", "VIEWER"]),
});

async function isLastAdmin(id: string): Promise<boolean> {
  const admins = await prisma.user.count({ where: { role: "ADMIN" } });
  if (admins > 1) return false;
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return user?.role === "ADMIN";
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const { id } = await params;
    const body = await req.json() as unknown;
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest("role must be ADMIN or VIEWER");

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return notFound("User not found");

    if (parsed.data.role !== "ADMIN" && (await isLastAdmin(id))) {
      return badRequest("Cannot demote the last administrator");
    }

    // Bump tokenVersion so this user's existing sessions immediately pick
    // up the new role instead of keeping the old one until their access
    // token naturally expires.
    const updated = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role, tokenVersion: { increment: 1 } },
      select: { id: true, username: true, email: true, role: true },
    });

    await prisma.auditLog.create({
      data: { userId: session.id, action: "UPDATE", entity: "User", entityId: id, details: `role=${parsed.data.role}` },
    });

    return ok({ user: updated });
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const { id } = await params;
    if (id === session.id) return badRequest("Cannot delete your own account");

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return notFound("User not found");

    if (await isLastAdmin(id)) {
      return badRequest("Cannot delete the last administrator");
    }

    await prisma.user.delete({ where: { id } });

    await prisma.auditLog.create({
      data: { userId: session.id, action: "DELETE", entity: "User", entityId: id },
    });

    return ok({ message: "User deleted" });
  } catch (e) {
    return fromError(e);
  }
}
