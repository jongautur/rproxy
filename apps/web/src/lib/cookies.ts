import { cookies } from "next/headers";
import type { AuthTokens } from "@/types/auth";

export const ACCESS_TOKEN_COOKIE = "rproxy_access";
export const REFRESH_TOKEN_COOKIE = "rproxy_refresh";

const IS_HTTPS = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false;

export async function setAuthCookies(tokens: AuthTokens): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure: IS_HTTPS,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 15, // 15 minutes
  });

  cookieStore.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure: IS_HTTPS,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}

export async function getAccessToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
}
