import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signAccessToken, signRefreshToken, signMfaPendingToken } from "@/lib/jwt";
import { setAuthCookies } from "@/lib/cookies";
import { loginSchema } from "@/lib/validation";
import { ok, badRequest, unauthorized, tooManyRequests, fromError } from "@/lib/api-response";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    // Two windows: a per-IP cap resists distributed guessing against many
    // accounts, a per-username cap resists a single account being brute
    // forced from many IPs.
    const ipLimit = checkRateLimit(`login:ip:${ip}`, 20, 5 * 60_000);
    if (!ipLimit.allowed) {
      return tooManyRequests("Too many login attempts. Try again later.", ipLimit.retryAfterSeconds);
    }

    const body = await req.json() as unknown;

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid request", parsed.error.flatten().fieldErrors);
    }

    const { username, password } = parsed.data;

    const userLimit = checkRateLimit(`login:user:${username.toLowerCase()}`, 10, 15 * 60_000);
    if (!userLimit.allowed) {
      return tooManyRequests("Too many login attempts for this account. Try again later.", userLimit.retryAfterSeconds);
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    // Constant-time check even when user not found
    const hash = user?.passwordHash ?? "$2a$12$invalidhashforcomparison000000000000000000000";
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      return unauthorized("Invalid username or password");
    }

    // If TOTP is enabled, issue a short-lived mfa_pending token instead
    if (user.totpEnabled) {
      const mfaToken = await signMfaPendingToken({
        sub: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
      });
      // Reuse the access token cookie slot — middleware will detect mfaPending
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const IS_HTTPS = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;
      cookieStore.set("rproxy_access", mfaToken, {
        httpOnly: true,
        secure: IS_HTTPS,
        sameSite: "lax",
        path: "/",
        maxAge: 120,
      });
      return ok({ mfaRequired: true });
    }

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
      },
    });

    return ok({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (e) {
    return fromError(e);
  }
}
