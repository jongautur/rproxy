import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signAccessToken, signRefreshToken } from "@/lib/jwt";
import { setAuthCookies } from "@/lib/cookies";
import { loginSchema } from "@/lib/validation";
import { ok, badRequest, unauthorized, fromError } from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid request", parsed.error.flatten().fieldErrors);
    }

    const { username, password } = parsed.data;

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
