import { verifyAccessToken, verifyRefreshToken, signAccessToken, signRefreshToken } from "./jwt";
import { getAccessToken, getRefreshToken, setAuthCookies } from "./cookies";
import { prisma } from "./prisma";
import type { SessionUser } from "@/types/auth";

// Re-checks the token's claims against the current DB row: the user must
// still exist, and tokenVersion must match (it's bumped on role/password
// change or forced logout). This is what actually revokes access mid-token
// -lifetime — without it, a demoted/deleted admin or a password-changed
// account keeps working for the rest of the token's validity window purely
// because the signature still checks out. Returns the *current* DB role —
// never the (potentially stale) role embedded in the JWT.
async function loadCurrentUser(id: string, tokenVersion: number): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, email: true, role: true, tokenVersion: true },
  });
  if (!user) return null;
  if (user.tokenVersion !== tokenVersion) return null;
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

export async function getSession(): Promise<SessionUser | null> {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    const payload = await verifyAccessToken(token);
    return await loadCurrentUser(payload.sub, payload.tokenVersion);
  } catch {
    return null;
  }
}

export async function getSessionOrRefresh(): Promise<SessionUser | null> {
  const token = await getAccessToken();

  if (token) {
    try {
      const payload = await verifyAccessToken(token);
      const session = await loadCurrentUser(payload.sub, payload.tokenVersion);
      if (session) return session;
      // Falls through to the refresh-token path below on a stale/revoked
      // access token — that token's tokenVersion won't match there either,
      // since both are minted from the same DB update, so this correctly
      // ends in null rather than silently granting a shorter grace window.
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
    if (user.tokenVersion !== payload.tokenVersion) return null;

    const newTokens = {
      accessToken: await signAccessToken({
        sub: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
      }),
      refreshToken: await signRefreshToken({
        sub: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
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
