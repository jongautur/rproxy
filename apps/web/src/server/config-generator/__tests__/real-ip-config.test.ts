import { describe, it, expect } from "vitest";
import { generateRealIpConfig, parseCidrList, isValidCidr, CLOUDFLARE_RANGES } from "../real-ip-config";

describe("generateRealIpConfig", () => {
  it("emits nothing when disabled", () => {
    const config = generateRealIpConfig({ enabled: false, source: "cloudflare", header: "cf-connecting-ip", customCidrs: [] });
    expect(config).toBe("");
  });

  it("emits every Cloudflare range and the CF-Connecting-IP header", () => {
    const config = generateRealIpConfig({ enabled: true, source: "cloudflare", header: "cf-connecting-ip", customCidrs: [] });
    for (const range of CLOUDFLARE_RANGES) {
      expect(config).toContain(`set_real_ip_from ${range};`);
    }
    expect(config).toContain("real_ip_header CF-Connecting-IP;");
    expect(config).toContain("real_ip_recursive on;");
  });

  it("uses only the custom CIDRs and chosen header for a custom source", () => {
    const config = generateRealIpConfig({
      enabled: true,
      source: "custom",
      header: "x-forwarded-for",
      customCidrs: ["10.0.0.0/8"],
    });
    expect(config).toContain("set_real_ip_from 10.0.0.0/8;");
    expect(config).toContain("real_ip_header X-Forwarded-For;");
    expect(config).not.toContain(CLOUDFLARE_RANGES[0]);
  });
});

describe("parseCidrList / isValidCidr", () => {
  it("accepts valid IPv4 and IPv6 CIDRs", () => {
    expect(isValidCidr("10.0.0.0/8")).toBe(true);
    expect(isValidCidr("2400:cb00::/32")).toBe(true);
  });

  it("rejects garbage", () => {
    expect(isValidCidr("not-an-ip; rm -rf /")).toBe(false);
  });

  it("filters blanks, comments, and invalid lines out of a raw list", () => {
    const parsed = parseCidrList("10.0.0.0/8\n# comment\n\nbogus value\n192.168.1.1");
    expect(parsed).toEqual(["10.0.0.0/8", "192.168.1.1"]);
  });
});
