import { verifyRefreshToken, signAccessToken, signRefreshToken } from "@/lib/jwt";
import { setAuthCookies, getRefreshToken } from "@/lib/cookies";
import { prisma } from "@/lib/prisma";
import { ok, unauthorized, fromError } from "@/lib/api-response";

export async function POST() {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return unauthorized("No refresh token");

    const payload = await verifyRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return unauthorized("User not found");

    const tokenPayload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };

    const [newAccess, newRefresh] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    await setAuthCookies({ accessToken: newAccess, refreshToken: newRefresh });

    return ok({ message: "Token refreshed" });
  } catch (e) {
    return fromError(e);
  }
}
