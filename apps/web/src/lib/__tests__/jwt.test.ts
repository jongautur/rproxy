import { describe, it, expect, beforeAll } from "vitest";
import { SignJWT } from "jose";

beforeAll(() => {
  process.env.JWT_SECRET = "test-access-secret-test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-test-refresh-secret";
});

describe("jwt", () => {
  it("round-trips an access token with tokenVersion intact", async () => {
    const { signAccessToken, verifyAccessToken } = await import("../jwt");
    const token = await signAccessToken({
      sub: "user1", username: "alice", role: "ADMIN", tokenVersion: 3,
    });
    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe("user1");
    expect(payload.tokenVersion).toBe(3);
    expect(payload.type).toBe("access");
  });

  it("rejects a refresh token presented as an access token (wrong secret)", async () => {
    const { signRefreshToken, verifyAccessToken } = await import("../jwt");
    const refreshToken = await signRefreshToken({
      sub: "user1", username: "alice", role: "ADMIN", tokenVersion: 0,
    });
    await expect(verifyAccessToken(refreshToken)).rejects.toThrow();
  });

  it("rejects a token missing the tokenVersion claim", async () => {
    const { verifyAccessToken } = await import("../jwt");
    // Hand-crafted token, signed with the right secret/issuer/audience but
    // missing tokenVersion — simulates a pre-migration or forged token.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({ sub: "user1", username: "alice", role: "ADMIN", type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("rproxy")
      .setAudience("rproxy-app")
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow(/tokenVersion/);
  });

  it("rejects a token with the wrong issuer", async () => {
    const { verifyAccessToken } = await import("../jwt");
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const token = await new SignJWT({
      sub: "user1", username: "alice", role: "ADMIN", type: "access", tokenVersion: 0,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("someone-else")
      .setAudience("rproxy-app")
      .setExpirationTime("15m")
      .sign(secret);

    await expect(verifyAccessToken(token)).rejects.toThrow();
  });
});
