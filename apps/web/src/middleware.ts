import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, verifyRefreshToken, signAccessToken } from "@/lib/jwt";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/cookies";
import type { JwtPayload } from "@/types/auth";

// Exact matches only — none of these have legitimate sub-routes, and
// startsWith() previously let e.g. "/api/auth/login-anything" slip through
// as if it were the real "/api/auth/login" endpoint.
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/refresh", "/api/auth/mfa", "/api/health"]);
const CHANGE_PASSWORD_PATH = "/change-password";
const MFA_PATH = "/mfa";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Bearer-token endpoints (e.g. the cron secret), not cookie-authenticated —
// CSRF doesn't apply since there's no ambient browser credential to forge.
const CSRF_EXEMPT_PREFIXES = ["/api/cron/"];
// Generous for JSON bodies this app actually sends (cert/chain PEMs, config
// text fields are all individually capped far below this) — this exists to
// stop someone streaming an unbounded body at an endpoint, not to constrain
// legitimate use.
const MAX_BODY_BYTES = 1_048_576;

// One of the two OWASP-recommended CSRF defenses (the other being
// synchronizer tokens): state-changing requests must carry an Origin (or
// Referer, as a fallback) that matches this app's own origin. Combined with
// the access-token cookie's SameSite=Lax, this is defense in depth — Lax
// already blocks the cookie on cross-site fetch/XHR, but doesn't rely on
// correct SameSite handling in every client.
function hasValidOrigin(req: NextRequest): boolean {
  const source = req.headers.get("origin") ?? req.headers.get("referer");
  if (!source) return false;
  // Compare against the request's actual Host header, not req.nextUrl.origin —
  // for a self-hosted `next start` server, nextUrl.origin reflects the
  // hostname the server thinks it's bound to ("localhost"), not the Host
  // header the client actually sent, so it never matches when the app is
  // reached via a LAN IP or a real domain name.
  const host = req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

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

// Middleware runs in the Edge runtime, which can't reach Prisma/Postgres,
// so this only checks the refresh token's signature/expiry/claims — it
// does NOT confirm the user still exists or that tokenVersion still
// matches the DB (a demoted/deleted user, or one with a revoked session,
// could still pass this check and get a freshly-minted access token).
// That's fine: it's a UX convenience layer only. The actual authorization
// boundary is `getSessionOrRefresh()` in src/lib/auth.ts (Node runtime,
// used by every API route handler), which re-checks tokenVersion against
// the DB on every request and rejects stale/revoked sessions regardless of
// what middleware let through.
async function tryRefresh(req: NextRequest): Promise<{ payload: JwtPayload; newToken: string } | null> {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const payload = await verifyRefreshToken(refreshToken);
    const newToken = await signAccessToken({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      tokenVersion: payload.tokenVersion,
      mustChangePassword: payload.mustChangePassword,
    });
    return { payload: { ...payload, type: "access" }, newToken };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Body size + CSRF origin checks (all mutating API requests) ─────────────
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(req.method)) {
    const contentLength = req.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
      return NextResponse.json({ success: false, error: "Request body too large" }, { status: 413 });
    }
    const isCsrfExempt = CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
    if (!isCsrfExempt && !hasValidOrigin(req)) {
      return NextResponse.json({ success: false, error: "Invalid or missing origin" }, { status: 403 });
    }
  }

  if (PUBLIC_PATHS.has(pathname)) {
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
