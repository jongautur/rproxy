import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, conflict, fromError } from "@/lib/api-response";
import { z } from "zod";

const schema = z.object({
  firstName: z.string().max(64).optional(),
  lastName: z.string().max(64).optional(),
  email: z.string().email().max(256).optional(),
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, . _ -").optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.id },
      select: { id: true, username: true, email: true, firstName: true, lastName: true, role: true },
    });
    return ok({ user });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json() as unknown;

    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");

    const { firstName, lastName, email, username } = parsed.data;

    if (username) {
      const existing = await prisma.user.findUnique({ where: { username } });
      if (existing && existing.id !== session.id) return conflict("Username already taken");
    }
    if (email) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== session.id) return conflict("Email already in use");
    }

    const user = await prisma.user.update({
      where: { id: session.id },
      data: {
        ...(firstName !== undefined && { firstName: firstName || null }),
        ...(lastName !== undefined && { lastName: lastName || null }),
        ...(email && { email }),
        ...(username && { username }),
      },
      select: { id: true, username: true, email: true, firstName: true, lastName: true, role: true },
    });

    await prisma.auditLog.create({
      data: { userId: session.id, action: "UPDATE", entity: "User", entityId: session.id, details: "Profile updated" },
    });

    return ok({ user });
  } catch (e) {
    return fromError(e);
  }
}
