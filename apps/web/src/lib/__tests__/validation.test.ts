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

  it("blocks braces that don't form a bare location-block open/close", () => {
    expect(validateNginxDirective("return 200 'ok'; }")).toBe(false);
    expect(validateNginxDirective("if ($http_x = 1) { return 403; }")).toBe(false);
    expect(validateNginxDirective("} server { listen 8080; ")).toBe(false);
  });

  it("blocks unbalanced or premature context-closing braces", () => {
    expect(validateNginxDirective("location /x/ {\nproxy_pass http://up;")).toBe(false); // never closed
    expect(validateNginxDirective("}\nlocation /x/ {\n}")).toBe(false); // closes before opening
  });

  it("allows a well-formed nested location block", () => {
    const block = [
      "location /socket.io/ {",
      "    proxy_pass http://192.168.1.13:80;",
      "    proxy_http_version 1.1;",
      "    proxy_set_header Upgrade $http_upgrade;",
      "    proxy_set_header Connection \"upgrade\";",
      "}",
    ].join("\n");
    expect(validateNginxDirective(block)).toBe(true);
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
