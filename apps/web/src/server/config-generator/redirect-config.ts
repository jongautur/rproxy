import type { RedirectHost, Certificate } from "@prisma/client";
import { sanitizeNginxValue } from "@/lib/validation";
import { renderIpRuleLines, type AccessListOptions } from "./access-list-render";

export function domainToRedirectFilename(domain: string): string {
  return `redirect-${domain.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
}

interface GenerateRedirectConfigOptions {
  redirect: RedirectHost;
  certificate: Certificate | null;
  accessList?: AccessListOptions | null;
}

// Access control for a redirect gates the destination redirect itself — an
// unauthorized visitor gets 403 instead of the 301/302, rather than the
// redirect firing regardless of who's asking.
function accessControlLines(al: AccessListOptions, indent: string): string[] {
  const lines: string[] = [];
  if (al.authEnabled && al.authUsers.length > 0) {
    const realm = sanitizeNginxValue(al.authRealm || "Restricted");
    lines.push(`${indent}auth_basic "${realm}";`);
    lines.push(`${indent}auth_basic_user_file /etc/nginx/access-lists/${al.id}.htpasswd;`);
  }
  lines.push(...renderIpRuleLines(al, indent));
  return lines;
}

export function generateRedirectConfig({ redirect, certificate, accessList }: GenerateRedirectConfigOptions): string {
  const dest = redirect.preservePath
    ? `${redirect.destination}$request_uri`
    : redirect.destination;

  const lines: string[] = [];

  if (redirect.sslEnabled && certificate) {
    // HTTP → HTTPS redirect block
    lines.push(`server {`);
    lines.push(`    listen 80;`);
    lines.push(`    listen [::]:80;`);
    lines.push(`    server_name ${redirect.sourceDomain};`);
    lines.push(``);
    lines.push(`    location /.well-known/acme-challenge/ {`);
    lines.push(`        root /var/www/html;`);
    lines.push(`        try_files $uri =404;`);
    lines.push(`    }`);
    lines.push(``);
    lines.push(`    location / {`);
    lines.push(`        return 301 https://$host$request_uri;`);
    lines.push(`    }`);
    lines.push(`}`);
    lines.push(``);
    // HTTPS block with the actual redirect
    lines.push(`server {`);
    lines.push(`    listen 443 ssl;`);
    lines.push(`    listen [::]:443 ssl;`);
    lines.push(`    http2 on;`);
    lines.push(`    server_name ${redirect.sourceDomain};`);
    lines.push(``);
    lines.push(`    ssl_certificate     ${certificate.certPath};`);
    lines.push(`    ssl_certificate_key ${certificate.keyPath};`);
    lines.push(`    ssl_protocols TLSv1.2 TLSv1.3;`);
    lines.push(`    ssl_ciphers HIGH:!aNULL:!MD5;`);
    lines.push(``);
    if (accessList) {
      lines.push(...accessControlLines(accessList, "    "));
      lines.push(``);
    }
    lines.push(`    return ${redirect.redirectCode} ${dest};`);
    lines.push(`}`);
  } else {
    lines.push(`server {`);
    lines.push(`    listen 80;`);
    lines.push(`    listen [::]:80;`);
    lines.push(`    server_name ${redirect.sourceDomain};`);
    lines.push(``);
    lines.push(`    location /.well-known/acme-challenge/ {`);
    lines.push(`        root /var/www/html;`);
    lines.push(`        try_files $uri =404;`);
    lines.push(`    }`);
    lines.push(``);
    lines.push(`    location / {`);
    if (accessList) {
      lines.push(...accessControlLines(accessList, "        "));
    }
    lines.push(`        return ${redirect.redirectCode} ${dest};`);
    lines.push(`    }`);
    lines.push(`}`);
  }

  return lines.join("\n") + "\n";
}
