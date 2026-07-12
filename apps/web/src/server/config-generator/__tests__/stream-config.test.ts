import { describe, it, expect } from "vitest";
import { generateStreamConfig } from "../stream-config";

const host = { name: "pg", protocol: "TCP", listenPort: 5432, forwardHost: "10.0.0.5", forwardPort: 5432 };

describe("generateStreamConfig — access list", () => {
  it("has no allow/deny when no access list is attached", () => {
    const config = generateStreamConfig(host);
    expect(config).not.toContain("allow");
    expect(config).not.toContain("deny");
  });

  it("adds allow/deny inside the server block when attached", () => {
    const config = generateStreamConfig(host, {
      id: "al1",
      authEnabled: false,
      authRealm: "Restricted",
      defaultAction: "deny",
      authUsers: [],
      ipRules: [{ address: "10.0.0.0/24", action: "allow", sortOrder: 0 }],
    });
    expect(config).toContain("allow 10.0.0.0/24;");
    expect(config).toContain("deny all;");
    // No auth_basic — meaningless over raw TCP/UDP.
    expect(config).not.toContain("auth_basic");
  });
});
