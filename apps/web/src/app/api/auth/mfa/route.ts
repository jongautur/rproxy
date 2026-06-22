import { NextRequest } from "next/server";
import { verifyAccessToken, signAccessToken, signRefreshToken } from "@/lib/jwt";
import { setAuthCookies, getAccessToken } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { verifyMfaCode } from "@/server/services/totp.service";
import { ok, unauthorized, badRequest, fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rawToken = await getAccessToken();
    if (!rawToken) return unauthorized("No pending MFA session");

    const payload = await verifyAccessToken(rawToken);
    if (!payload.mfaPending) return unauthorized("No pending MFA session");

    const body = await req.json() as { code?: string };
    if (!body.code) return badRequest("code required");

    const valid = await verifyMfaCode(payload.sub, body.code);
    if (!valid) return unauthorized("Invalid code");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, mustChangePassword: true },
    });

    const tokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    await setAuthCookies({ accessToken, refreshToken });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown",
        details: JSON.stringify({ method: "totp" }),
      },
    });

    return ok({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (e) {
    return fromError(e);
  }
}
