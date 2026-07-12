import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, unauthorized, fromError } from "@/lib/api-response";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import { setAuthCookies } from "@/lib/cookies";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(256),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json() as unknown;

    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");

    const { currentPassword, newPassword } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: session.id } });
    if (!user) return unauthorized("User not found");

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return unauthorized("Current password is incorrect");

    const hash = await bcrypt.hash(newPassword, 12);

    // Bump tokenVersion so any other outstanding access/refresh tokens for
    // this account (other devices, or a leaked token) stop working — only
    // the tokens re-issued below, carrying the new version, remain valid.
    const updated = await prisma.user.update({
      where: { id: session.id },
      data: { passwordHash: hash, mustChangePassword: false, tokenVersion: { increment: 1 } },
    });

    await setAuthCookies({
      accessToken: await signAccessToken({
        sub: updated.id,
        username: updated.username,
        role: updated.role,
        tokenVersion: updated.tokenVersion,
        mustChangePassword: false,
      }),
      refreshToken: await signRefreshToken({
        sub: updated.id,
        username: updated.username,
        role: updated.role,
        tokenVersion: updated.tokenVersion,
        mustChangePassword: false,
      }),
    });

    await prisma.auditLog.create({
      data: { userId: session.id, action: "UPDATE", entity: "User", entityId: session.id, details: "Password changed" },
    });

    return ok({ message: "Password updated" });
  } catch (e) {
    return fromError(e);
  }
}
