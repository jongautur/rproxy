import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, unauthorized, fromError } from "@/lib/api-response";

export async function GET() {
  try {
    const session = await requireSession();

    const user = await prisma.user.findUnique({
      where: { id: session.id },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    if (!user) return unauthorized("User not found");

    return ok(user);
  } catch (e) {
    return fromError(e);
  }
}
