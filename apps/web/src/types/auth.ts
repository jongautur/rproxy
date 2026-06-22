import type { Role } from "@prisma/client";

export interface JwtPayload {
  sub: string;      // user id
  username: string;
  role: Role;
  type: "access" | "refresh";
  mustChangePassword?: boolean;
  mfaPending?: boolean;  // true = only valid for /api/auth/mfa
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: Role;
}
