import { describe, it, expect } from "vitest";
import { generateRedirectConfig } from "../redirect-config";
import type { RedirectHost } from "@prisma/client";

function makeRedirect(overrides: Partial<RedirectHost> = {}): RedirectHost {
  return {
    id: "r1",
    sourceDomain: "old.example.com",
    destination: "https://new.example.com",
    redirectCode: 301,
    preservePath: true,
    sslEnabled: false,
    enabled: true,
    configPath: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    certificateId: null,
    accessListId: null,
    ...overrides,
  } as RedirectHost;
}

describe("generateRedirectConfig — access list", () => {
  it("issues the redirect unrestricted when no access list is attached", () => {
    const config = generateRedirectConfig({ redirect: makeRedirect(), certificate: null });
    expect(config).not.toContain("deny");
    expect(config).not.toContain("allow");
  });

  it("gates the redirect behind allow/deny when an access list is attached", () => {
    const config = generateRedirectConfig({
      redirect: makeRedirect(),
      certificate: null,
      accessList: {
        id: "al1",
        authEnabled: false,
        authRealm: "Restricted",
        defaultAction: "deny",
        authUsers: [],
        ipRules: [{ address: "1.2.3.4", action: "allow", sortOrder: 0 }],
      },
    });
    expect(config).toContain("allow 1.2.3.4;");
    expect(config).toContain("deny all;");
  });

  it("applies no IP restriction for an auth-only access list with zero IP rules", () => {
    const config = generateRedirectConfig({
      redirect: makeRedirect(),
      certificate: null,
      accessList: {
        id: "al1",
        authEnabled: true,
        authRealm: "Restricted",
        defaultAction: "deny",
        authUsers: [{ id: "u1", username: "admin" }],
        ipRules: [],
      },
    });
    expect(config).toContain("auth_basic ");
    expect(config).not.toContain("allow");
    expect(config).not.toContain("deny");
  });
});
