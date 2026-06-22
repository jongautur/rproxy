import { verifyAccessToken, verifyRefreshToken, signAccessToken, signRefreshToken } from "./jwt";
import { getAccessToken, getRefreshToken, setAuthCookies } from "./cookies";
import { prisma } from "./prisma";
import type { SessionUser } from "@/types/auth";

export async function getSession(): Promise<SessionUser | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    return {
      id: payload.sub,
      username: payload.username,
      email: "",
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function getSessionOrRefresh(): Promise<SessionUser | null> {
  const token = await getAccessToken();

  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      return {
        id: payload.sub,
        username: payload.username,
        email: "",
        role: payload.role,
      };
    } catch {
      // fall through to refresh
    }
  }

  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const payload = await verifyRefreshToken(refreshToken);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;

    const newTokens = {
      accessToken: await signAccessToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      }),
      refreshToken: await signRefreshToken({
        sub: user.id,
        username: user.username,
        role: user.role,
      }),
    };

    await setAuthCookies(newTokens);

    return { id: user.id, username: user.username, email: user.email, role: user.role };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSessionOrRefresh();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requireAdmin(): Promise<SessionUser> {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    throw new Error("Forbidden");
  }
  return session;
}
