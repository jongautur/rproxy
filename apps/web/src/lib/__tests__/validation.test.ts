import { describe, it, expect } from "vitest";
import { validateNginxDirective, sanitizeNginxValue, isValidDomain, isValidPort } from "../validation";

describe("validateNginxDirective", () => {
  it("allows a plain single-line directive", () => {
    expect(validateNginxDirective('proxy_set_header X-Real-IP $remote_addr;')).toBe(true);
  });

  it("blocks lua/perl exec directives", () => {
    expect(validateNginxDirective("content_by_lua_block { ngx.say('x') }")).toBe(false);
    expect(validateNginxDirective("perl_set $foo 'sub {}'")).toBe(false);
  });

  it("blocks include directives", () => {
    expect(validateNginxDirective("include /etc/passwd;")).toBe(false);
  });

  it("blocks any brace — closing the current context is a config-injection vector", () => {
    expect(validateNginxDirective("return 200 'ok'; }")).toBe(false);
    expect(validateNginxDirective("if ($http_x = 1) { return 403; }")).toBe(false);
    expect(validateNginxDirective("} server { listen 8080; ")).toBe(false);
  });
});

describe("sanitizeNginxValue", () => {
  it("strips characters that could break out of a quoted config value", () => {
    expect(sanitizeNginxValue('foo"; deny all; #')).toBe("foo deny all #");
    expect(sanitizeNginxValue("normal-host.example.com")).toBe("normal-host.example.com");
  });
});

describe("isValidDomain / isValidPort", () => {
  it("accepts ordinary domains and rejects garbage", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("sub.example.com")).toBe(true);
    expect(isValidDomain("not a domain")).toBe(false);
  });

  it("bounds ports to the valid range", () => {
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
  });
});
