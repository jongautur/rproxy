import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, forbidden, fromError } from "@/lib/api-response";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Username: letters, numbers, _ and - only"),
  email: z.string().email(),
  password: z.string().min(8).max(256),
  role: z.enum(["ADMIN", "VIEWER"]).default("VIEWER"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const body = await req.json() as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");

    const { username, email, password, role } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existing) return badRequest("Username or email already in use");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, passwordHash, role },
      select: { id: true, username: true, email: true, role: true, createdAt: true },
    });

    await prisma.auditLog.create({
      data: { userId: session.id, action: "CREATE", entity: "User", entityId: user.id },
    });

    return ok({ user });
  } catch (e) {
    return fromError(e);
  }
}
