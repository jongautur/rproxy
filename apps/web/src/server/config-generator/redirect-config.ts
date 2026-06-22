import type { RedirectHost, Certificate } from "@prisma/client";

export function domainToRedirectFilename(domain: string): string {
  return `redirect-${domain.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
}

interface GenerateRedirectConfigOptions {
  redirect: RedirectHost;
  certificate: Certificate | null;
}

export function generateRedirectConfig({ redirect, certificate }: GenerateRedirectConfigOptions): string {
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
    lines.push(`        return ${redirect.redirectCode} ${dest};`);
    lines.push(`    }`);
    lines.push(`}`);
  }

  return lines.join("\n") + "\n";
}
