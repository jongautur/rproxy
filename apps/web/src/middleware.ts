import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/jwt";
import { ACCESS_TOKEN_COOKIE } from "@/lib/cookies";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/refresh", "/api/auth/mfa"];
const CHANGE_PASSWORD_PATH = "/change-password";
const MFA_PATH = "/mfa";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
      const payload = await verifyAccessToken(token);
      // MFA-pending tokens may only access /api/auth/mfa (already in PUBLIC_PATHS)
      if (payload.mfaPending) {
        return NextResponse.json({ success: false, error: "MFA required" }, { status: 401 });
      }
      return NextResponse.next();
    } catch {
      return NextResponse.json({ success: false, error: "Token expired" }, { status: 401 });
    }
  }

  // Page routes — check token then enforce must-change-password
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const payload = await verifyAccessToken(token);

    // MFA pending — only allow the /mfa page
    if (payload.mfaPending && !pathname.startsWith(MFA_PATH)) {
      return NextResponse.redirect(new URL(MFA_PATH, req.url));
    }
    if (!payload.mfaPending && pathname.startsWith(MFA_PATH)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    // Force first-run password change before accessing any other page
    if (payload.mustChangePassword && !pathname.startsWith(CHANGE_PASSWORD_PATH)) {
      return NextResponse.redirect(new URL(CHANGE_PASSWORD_PATH, req.url));
    }

    return NextResponse.next();
  } catch {
    const response = NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete(ACCESS_TOKEN_COOKIE);
    return response;
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
