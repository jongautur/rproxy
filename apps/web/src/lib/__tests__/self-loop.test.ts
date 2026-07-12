import { describe, it, expect } from "vitest";
import { checkSelfLoopPorts, isAppOwnPort } from "../validation";

describe("self-loop port guard", () => {
  it("flags the app's own port (81, matching NEXTAUTH_URL default)", () => {
    expect(isAppOwnPort(81)).toBe(true);
    expect(checkSelfLoopPorts([81])).not.toBeNull();
  });

  it("allows any other port", () => {
    expect(isAppOwnPort(8080)).toBe(false);
    expect(checkSelfLoopPorts([80, 443, 8080])).toBeNull();
  });

  it("ignores undefined entries (partial updates that don't touch the port)", () => {
    expect(checkSelfLoopPorts([undefined, undefined])).toBeNull();
  });
});
