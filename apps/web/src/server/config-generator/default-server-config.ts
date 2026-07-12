import path from "path";
import { PAGES_DIR } from "./nginx-config";
import { sanitizeNginxValue } from "@/lib/validation";

export type DefaultPageMode = "nginx_default" | "redirect" | "custom_html" | "no_response";

export const DEFAULT_PAGE_FILENAME = "_default.conf";
export const DEFAULT_PAGE_HTML_FILE = path.join(PAGES_DIR, "default.html");
export const NGINX_WELCOME_FILE = path.join(PAGES_DIR, "nginx-default", "index.html");

export const NGINX_WELCOME_HTML = `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

// Generates the nginx `default_server` catch-all block for port 80 — what a
// client gets when the Host header (or a raw IP hit) doesn't match any
// configured proxy/redirect host. Without this, an unmatched request falls
// through to whichever site's server block happens to load first, which is
// confusing and was the root cause of an earlier incident where one
// self-hosted domain's requests briefly landed on an unrelated site.
export function generateDefaultServerConfig(opts: {
  mode: DefaultPageMode;
  redirectUrl?: string;
}): string {
  const lines: string[] = [];
  lines.push(`server {`);
  lines.push(`    listen 80 default_server;`);
  lines.push(`    listen [::]:80 default_server;`);
  lines.push(`    server_name _;`);
  lines.push(``);
  lines.push(`    access_log off;`);
  lines.push(``);
  lines.push(`    location /.well-known/acme-challenge/ {`);
  lines.push(`        root /var/www/html;`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    location / {`);

  switch (opts.mode) {
    case "redirect": {
      // Validated as a well-formed http(s) URL at the settings-save layer;
      // sanitizeNginxValue is a defensive second layer against config
      // injection, matching every other place user text reaches a config.
      const url = sanitizeNginxValue(opts.redirectUrl ?? "");
      lines.push(`        return 302 ${url};`);
      break;
    }
    case "custom_html": {
      lines.push(`        root ${PAGES_DIR};`);
      lines.push(`        default_type text/html;`);
      lines.push(`        try_files /default.html =404;`);
      break;
    }
    case "no_response": {
      // nginx-specific: closes the connection with no response at all.
      lines.push(`        return 444;`);
      break;
    }
    case "nginx_default":
    default: {
      lines.push(`        root ${path.dirname(NGINX_WELCOME_FILE)};`);
      lines.push(`        index index.html;`);
      break;
    }
  }

  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
