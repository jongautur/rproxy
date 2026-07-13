import { describe, it, expect } from "vitest";
import { generateDefaultServerConfig } from "../default-server-config";

describe("generateDefaultServerConfig", () => {
  it("serves the stock welcome page by default", () => {
    const config = generateDefaultServerConfig({ mode: "nginx_default" });
    expect(config).toContain("listen 80 default_server;");
    expect(config).toContain("index index.html;");
  });

  it("redirects with a sanitized URL", () => {
    const config = generateDefaultServerConfig({ mode: "redirect", redirectUrl: "https://example.com" });
    expect(config).toContain("return 302 https://example.com;");
  });

  it("strips injection characters from the redirect URL", () => {
    const config = generateDefaultServerConfig({ mode: "redirect", redirectUrl: 'https://example.com/";\nserver{}' });
    // The payload tries to close the return statement and open a new
    // `server{}` block — confirm neither the quote/brace nor a second
    // top-level server block survived.
    expect(config).not.toContain('";');
    expect(config).not.toContain("server{}");
    expect((config.match(/^server \{/gm) ?? []).length).toBe(1);
  });

  it("serves the custom HTML file for any path", () => {
    const config = generateDefaultServerConfig({ mode: "custom_html" });
    expect(config).toContain("try_files /default.html =404;");
  });

  it("closes the connection with no response", () => {
    const config = generateDefaultServerConfig({ mode: "no_response" });
    expect(config).toContain("return 444;");
  });

  it("omits the 443 default_server block when no cert is available", () => {
    const config = generateDefaultServerConfig({ mode: "nginx_default", hasCert: false });
    expect(config).not.toContain("listen 443");
    expect((config.match(/^server \{/gm) ?? []).length).toBe(1);
  });

  it("adds a matching 443 default_server block when a cert is available", () => {
    const config = generateDefaultServerConfig({ mode: "no_response", hasCert: true });
    expect(config).toContain("listen 443 ssl default_server;");
    expect(config).toContain("ssl_certificate ");
    expect((config.match(/^server \{/gm) ?? []).length).toBe(2);
    // Same behavior on both ports, not just port 80.
    expect((config.match(/return 444;/g) ?? []).length).toBe(2);
  });
});
