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

export const DEFAULT_CERT_DIR = "/etc/nginx/ssl/_default";
export const DEFAULT_CERT_FILE = path.join(DEFAULT_CERT_DIR, "cert.pem");
export const DEFAULT_KEY_FILE = path.join(DEFAULT_CERT_DIR, "key.pem");

function locationBlockLines(mode: DefaultPageMode, redirectUrl?: string): string[] {
  switch (mode) {
    case "redirect": {
      // Validated as a well-formed http(s) URL at the settings-save layer;
      // sanitizeNginxValue is a defensive second layer against config
      // injection, matching every other place user text reaches a config.
      const url = sanitizeNginxValue(redirectUrl ?? "");
      return [`        return 302 ${url};`];
    }
    case "custom_html":
      return [
        `        root ${PAGES_DIR};`,
        `        default_type text/html;`,
        `        try_files /default.html =404;`,
      ];
    case "no_response":
      // nginx-specific: closes the connection with no response at all.
      return [`        return 444;`];
    case "nginx_default":
    default:
      return [
        `        root ${path.dirname(NGINX_WELCOME_FILE)};`,
        `        index index.html;`,
      ];
  }
}

// Generates the nginx `default_server` catch-all for both port 80 and 443 —
// what a client gets when the Host header / SNI (or a raw IP hit) doesn't
// match any configured proxy/redirect host. Without this, an unmatched
// request falls through to whichever site's server block happens to load
// first — confusing at best, and at worst leaks a disabled/removed site's
// traffic to an unrelated backend if that backend doesn't itself check the
// Host header. A self-signed cert covers the 443 case since TLS needs
// *something* to present during the handshake before nginx can even
// evaluate SNI-based routing.
export function generateDefaultServerConfig(opts: {
  mode: DefaultPageMode;
  redirectUrl?: string;
  hasCert?: boolean;
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
  lines.push(...locationBlockLines(opts.mode, opts.redirectUrl));
  lines.push(`    }`);
  lines.push(`}`);

  if (opts.hasCert) {
    lines.push(``);
    lines.push(`server {`);
    lines.push(`    listen 443 ssl default_server;`);
    lines.push(`    listen [::]:443 ssl default_server;`);
    lines.push(`    server_name _;`);
    lines.push(``);
    lines.push(`    access_log off;`);
    lines.push(`    ssl_certificate ${DEFAULT_CERT_FILE};`);
    lines.push(`    ssl_certificate_key ${DEFAULT_KEY_FILE};`);
    lines.push(``);
    lines.push(`    location / {`);
    lines.push(...locationBlockLines(opts.mode, opts.redirectUrl));
    lines.push(`    }`);
    lines.push(`}`);
  }

  return lines.join("\n") + "\n";
}
