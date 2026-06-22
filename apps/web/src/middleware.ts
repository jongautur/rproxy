import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, verifyRefreshToken, signAccessToken } from "@/lib/jwt";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/cookies";
import type { JwtPayload } from "@/types/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/refresh", "/api/auth/mfa"];
const CHANGE_PASSWORD_PATH = "/change-password";
const MFA_PATH = "/mfa";

const IS_HTTPS = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

function setAccessCookie(res: NextResponse, token: string): void {
  res.cookies.set(ACCESS_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: IS_HTTPS,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15,
  });
}

async function tryRefresh(req: NextRequest): Promise<{ payload: JwtPayload; newToken: string } | null> {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const payload = await verifyRefreshToken(refreshToken);
    const newToken = await signAccessToken({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    });
    return { payload: { ...payload, type: "access" }, newToken };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const rawToken = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  // ── API routes ───────────────────────────────────────────────────────────────
  if (pathname.startsWith("/api/")) {
    let apiPayload: JwtPayload | null = null;
    if (rawToken) {
      try { apiPayload = await verifyAccessToken(rawToken); } catch { /* expired */ }
    }
    // No token or expired — try refresh (handles cookie deleted by browser after maxAge)
    if (!apiPayload) {
      const refreshed = await tryRefresh(req);
      if (!refreshed) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
      if (refreshed.payload.mfaPending) {
        return NextResponse.json({ success: false, error: "MFA required" }, { status: 401 });
      }
      const res = NextResponse.next();
      setAccessCookie(res, refreshed.newToken);
      return res;
    }
    if (apiPayload.mfaPending) {
      return NextResponse.json({ success: false, error: "MFA required" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // ── Page routes ──────────────────────────────────────────────────────────────
  let payload: JwtPayload | null = null;
  let freshToken: string | null = null;

  if (rawToken) {
    try {
      payload = await verifyAccessToken(rawToken);
    } catch { /* expired — fall through to refresh */ }
  }

  // No token or expired — try refresh (handles cookie deleted by browser after maxAge)
  if (!payload) {
    const refreshed = await tryRefresh(req);
    if (refreshed) {
      payload = refreshed.payload;
      freshToken = refreshed.newToken;
    }
  }

  if (!payload) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // MFA pending — only allow /mfa
  if (payload.mfaPending && !pathname.startsWith(MFA_PATH)) {
    const res = NextResponse.redirect(new URL(MFA_PATH, req.url));
    if (freshToken) setAccessCookie(res, freshToken);
    return res;
  }
  if (!payload.mfaPending && pathname.startsWith(MFA_PATH)) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  // Force first-run password change
  if (payload.mustChangePassword && !pathname.startsWith(CHANGE_PASSWORD_PATH)) {
    const res = NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, req.url));
    if (freshToken) setAccessCookie(res, freshToken);
    return res;
  }

  const res = NextResponse.next();
  if (freshToken) setAccessCookie(res, freshToken);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
