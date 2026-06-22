import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload } from "@/types/auth";
import type { Role } from "@prisma/client";

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export async function signAccessToken(
  payload: Omit<JwtPayload, "type" | "iat" | "exp">
): Promise<string> {
  return new SignJWT({ ...payload, type: "access" } as JWTPayload & JwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret(requireEnv("JWT_SECRET")));
}

export async function signRefreshToken(
  payload: Omit<JwtPayload, "type" | "iat" | "exp">
): Promise<string> {
  return new SignJWT({ ...payload, type: "refresh" } as JWTPayload & JwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret(requireEnv("JWT_REFRESH_SECRET")));
}

export async function signMfaPendingToken(
  payload: Pick<JwtPayload, "sub" | "username" | "role">
): Promise<string> {
  return new SignJWT({ ...payload, type: "access", mfaPending: true } as JWTPayload & JwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(getSecret(requireEnv("JWT_SECRET")));
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(
    token,
    getSecret(requireEnv("JWT_SECRET"))
  );
  return payload as unknown as JwtPayload;
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(
    token,
    getSecret(requireEnv("JWT_REFRESH_SECRET"))
  );
  return payload as unknown as JwtPayload;
}

export function isAdmin(role: Role): boolean {
  return role === "ADMIN";
}
