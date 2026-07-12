import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { JwtPayload } from "@/types/auth";
import type { Role } from "@prisma/client";

const ISSUER = "rproxy";
const AUDIENCE = "rproxy-app";

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
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("15m")
    .sign(getSecret(requireEnv("JWT_SECRET")));
}

export async function signRefreshToken(
  payload: Omit<JwtPayload, "type" | "iat" | "exp">
): Promise<string> {
  return new SignJWT({ ...payload, type: "refresh" } as JWTPayload & JwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("7d")
    .sign(getSecret(requireEnv("JWT_REFRESH_SECRET")));
}

export async function signMfaPendingToken(
  payload: Pick<JwtPayload, "sub" | "username" | "role" | "tokenVersion">
): Promise<string> {
  return new SignJWT({ ...payload, type: "access", mfaPending: true } as JWTPayload & JwtPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime("2m")
    .sign(getSecret(requireEnv("JWT_SECRET")));
}

// Required claims that must be present on every access/refresh token.
// A token missing any of these (e.g. from before this field existed, or a
// hand-crafted token) is rejected rather than silently treated as valid.
function assertShape(payload: JWTPayload, expectedType: "access" | "refresh"): JwtPayload {
  const p = payload as JWTPayload & Partial<JwtPayload>;
  if (p.type !== expectedType) throw new Error(`Expected ${expectedType} token, got ${String(p.type)}`);
  if (typeof p.sub !== "string" || !p.sub) throw new Error("Token missing sub claim");
  if (typeof p.username !== "string" || !p.username) throw new Error("Token missing username claim");
  if (typeof p.role !== "string" || !p.role) throw new Error("Token missing role claim");
  if (typeof p.tokenVersion !== "number") throw new Error("Token missing tokenVersion claim");
  return p as JwtPayload;
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(
    token,
    getSecret(requireEnv("JWT_SECRET")),
    { issuer: ISSUER, audience: AUDIENCE }
  );
  return assertShape(payload, "access");
}

export async function verifyRefreshToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(
    token,
    getSecret(requireEnv("JWT_REFRESH_SECRET")),
    { issuer: ISSUER, audience: AUDIENCE }
  );
  return assertShape(payload, "refresh");
}

export function isAdmin(role: Role): boolean {
  return role === "ADMIN";
}
