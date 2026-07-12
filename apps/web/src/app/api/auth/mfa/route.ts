import { NextRequest } from "next/server";
import { verifyAccessToken, signAccessToken, signRefreshToken } from "@/lib/jwt";
import { setAuthCookies, getAccessToken } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { verifyMfaCode } from "@/server/services/totp.service";
import { ok, unauthorized, badRequest, tooManyRequests, fromError } from "@/lib/api-response";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rawToken = await getAccessToken();
    if (!rawToken) return unauthorized("No pending MFA session");

    const payload = await verifyAccessToken(rawToken);
    if (!payload.mfaPending) return unauthorized("No pending MFA session");

    // A 6-digit TOTP code has only 1,000,000 possibilities — without a
    // limit here it's brute-forceable well within the 30s validity window
    // of a code, let alone across a session's lifetime.
    const mfaLimit = checkRateLimit(`mfa:${payload.sub}`, 8, 5 * 60_000);
    if (!mfaLimit.allowed) {
      return tooManyRequests("Too many code attempts. Try again later.", mfaLimit.retryAfterSeconds);
    }

    const body = await req.json() as { code?: string };
    if (!body.code) return badRequest("code required");

    const valid = await verifyMfaCode(payload.sub, body.code);
    if (!valid) return unauthorized("Invalid code");

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, mustChangePassword: true, tokenVersion: true },
    });

    const tokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
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
