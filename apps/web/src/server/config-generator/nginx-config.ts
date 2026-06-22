import type { ProxyHost, Certificate, AccessListUser, AccessListIpRule } from "@prisma/client";
import { isValidDomain, isValidPort, sanitizeNginxValue, validateNginxDirective } from "@/lib/validation";
import path from "path";

// All values placed into nginx config must pass through these escaping
// functions. NEVER interpolate user input directly.

function escapeNginxString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function validateProxyTarget(host: string, port: number): void {
  const ipv4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const hostname = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  if (!ipv4.test(host) && !hostname.test(host) && host !== "localhost") {
    throw new Error(`Invalid forward host: ${host}`);
  }
  if (!isValidPort(port)) {
    throw new Error(`Invalid forward port: ${port}`);
  }
}

function validateDomain(domain: string): void {
  // Strip the wildcard prefix for file-path safety
  const base = domain.startsWith("*.") ? domain.slice(2) : domain;
  if (!isValidDomain(base) && base !== "localhost") {
    throw new Error(`Invalid domain: ${domain}`);
  }
}

export function domainToFilename(domain: string): string {
  // Convert domain to a safe filename (no path traversal possible)
  const safe = domain
    .replace(/^\*\./, "wildcard.")
    .replace(/[^a-zA-Z0-9.-]/g, "_");
  // Final guard — reject anything that looks like a path component
  if (safe.includes("/") || safe.includes("..") || safe.startsWith(".")) {
    throw new Error(`Unsafe domain for filename: ${domain}`);
  }
  return safe;
}

interface AccessListOptions {
  id: string;
  authEnabled: boolean;
  authRealm: string;
  authUsers: Pick<AccessListUser, "id" | "username">[];
  ipRules: Pick<AccessListIpRule, "address" | "action" | "sortOrder">[];
}

interface GeneratorOptions {
  proxy: ProxyHost;
  certificate: Certificate | null;
  accessList?: AccessListOptions | null;
  configDir?: string;
}

export function generateNginxConfig(opts: GeneratorOptions): string {
  const { proxy, certificate } = opts;

  // ── Validate all inputs before touching config ────────────────────────────
  validateDomain(proxy.domain);
  validateProxyTarget(proxy.forwardHost, proxy.forwardPort);
  if (!isValidPort(proxy.listenPort)) throw new Error(`Invalid listen port: ${proxy.listenPort}`);

  if (proxy.customLocations && !validateNginxDirective(proxy.customLocations)) {
    throw new Error("Custom location directives contain blocked keywords");
  }
  if (proxy.customServer && !validateNginxDirective(proxy.customServer)) {
    throw new Error("Custom server directives contain blocked keywords");
  }

  // ── Safe interpolation-only variables ─────────────────────────────────────
  const domain = escapeNginxString(sanitizeNginxValue(proxy.domain));
  const forwardScheme = (proxy.forwardScheme ?? "http") as "http" | "https" | "grpc" | "grpcs";
  const forwardHost = escapeNginxString(sanitizeNginxValue(proxy.forwardHost));
  const forwardPort = proxy.forwardPort; // integer, already validated
  const listenPort = proxy.listenPort;   // HTTP port
  const httpsPort  = proxy.httpsPort;    // HTTPS port (used when SSL enabled)

  const sslEnabled = proxy.sslEnabled && certificate?.certPath && certificate?.keyPath;
  const certPath = certificate?.certPath ? path.resolve(certificate.certPath) : null;
  const keyPath = certificate?.keyPath ? path.resolve(certificate.keyPath) : null;
  const chainPath = certificate?.chainPath ? path.resolve(certificate.chainPath) : null;

  const upstreamName = `upstream_${domainToFilename(domain).replace(/\./g, "_")}`;

  const lines: string[] = [];

  // ── Upstream ───────────────────────────────────────────────────────────────
  lines.push(`upstream ${upstreamName} {`);
  lines.push(`    server ${forwardHost}:${forwardPort};`);
  lines.push(`}`);
  lines.push(``);

  // ── HTTP block ─────────────────────────────────────────────────────────────
  if (sslEnabled && proxy.forceHttps) {
    lines.push(`server {`);
    lines.push(`    listen ${listenPort};`);
    lines.push(`    listen [::]:${listenPort};`);
    lines.push(`    server_name ${domain};`);
    lines.push(``);
    lines.push(`    # ACME challenge`);
    lines.push(`    location /.well-known/acme-challenge/ {`);
    lines.push(`        root /var/www/html;`);
    lines.push(`    }`);
    lines.push(``);
    lines.push(`    location / {`);
    lines.push(`        return 301 https://$host$request_uri;`);
    lines.push(`    }`);
    lines.push(`}`);
    lines.push(``);
  }

  // ── Main server block ──────────────────────────────────────────────────────
  lines.push(`server {`);

  if (sslEnabled) {
    lines.push(`    listen ${httpsPort} ssl${proxy.http2 ? " http2" : ""};`);
    lines.push(`    listen [::]:${httpsPort} ssl${proxy.http2 ? " http2" : ""};`);
  } else {
    lines.push(`    listen ${listenPort};`);
    lines.push(`    listen [::]:${listenPort};`);
  }

  lines.push(`    server_name ${domain};`);
  lines.push(``);

  // ── Logging ────────────────────────────────────────────────────────────────
  if (proxy.accessLog) {
    lines.push(`    access_log /var/log/nginx/${domainToFilename(domain)}.access.log;`);
  } else {
    lines.push(`    access_log off;`);
  }
  if (proxy.errorLog) {
    lines.push(`    error_log /var/log/nginx/${domainToFilename(domain)}.error.log;`);
  }
  lines.push(``);

  // ── SSL certificates ───────────────────────────────────────────────────────
  if (sslEnabled && certPath && keyPath) {
    lines.push(`    ssl_certificate ${certPath};`);
    lines.push(`    ssl_certificate_key ${keyPath};`);
    if (chainPath) {
      lines.push(`    ssl_trusted_certificate ${chainPath};`);
    }
    lines.push(`    ssl_protocols TLSv1.2 TLSv1.3;`);
    lines.push(`    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;`);
    lines.push(`    ssl_prefer_server_ciphers off;`);
    lines.push(`    ssl_session_cache shared:SSL:10m;`);
    lines.push(`    ssl_session_timeout 1d;`);
    lines.push(`    ssl_session_tickets off;`);
    lines.push(`    ssl_stapling on;`);
    lines.push(`    ssl_stapling_verify on;`);
    lines.push(``);
  }

  // ── Security headers ───────────────────────────────────────────────────────
  lines.push(`    add_header X-Frame-Options "SAMEORIGIN" always;`);
  lines.push(`    add_header X-Content-Type-Options "nosniff" always;`);
  lines.push(`    add_header X-XSS-Protection "1; mode=block" always;`);
  lines.push(`    add_header Referrer-Policy "no-referrer-when-downgrade" always;`);
  if (sslEnabled) {
    lines.push(`    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`);
  }
  lines.push(``);

  // ── Custom server directives (validated, no injection) ─────────────────────
  if (proxy.customServer) {
    lines.push(`    # Custom server directives`);
    proxy.customServer.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        lines.push(`    ${trimmed}`);
      }
    });
    lines.push(``);
  }

  // ── Location block ─────────────────────────────────────────────────────────
  lines.push(`    location / {`);

  // ── Access list ───────────────────────────────────────────────────────────
  if (opts.accessList) {
    const al = opts.accessList;
    if (al.authEnabled && al.authUsers.length > 0) {
      const realm = escapeNginxString(sanitizeNginxValue(al.authRealm || "Restricted"));
      lines.push(`        auth_basic "${realm}";`);
      lines.push(`        auth_basic_user_file /etc/nginx/access-lists/${al.id}.htpasswd;`);
    }
    if (al.ipRules.length > 0) {
      const sorted = [...al.ipRules].sort((a, b) => a.sortOrder - b.sortOrder);
      for (const rule of sorted) {
        const addr = sanitizeNginxValue(rule.address);
        if (addr) lines.push(`        ${rule.action === "allow" ? "allow" : "deny"} ${addr};`);
      }
      lines.push(`        deny all;`);
    }
    if ((al.authEnabled && al.authUsers.length > 0) || al.ipRules.length > 0) {
      lines.push(``);
    }
  }

  const isGrpc = forwardScheme === "grpc" || forwardScheme === "grpcs";

  if (isGrpc) {
    lines.push(`        grpc_pass ${forwardScheme}://${upstreamName};`);
    lines.push(`        grpc_set_header Host $host;`);
    lines.push(`        grpc_set_header X-Real-IP $remote_addr;`);
    lines.push(`        grpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        grpc_set_header X-Forwarded-Proto $scheme;`);
    if (forwardScheme === "grpcs") {
      lines.push(``);
      lines.push(`        grpc_ssl_verify off;`);
    }
  } else {
    lines.push(`        proxy_pass ${forwardScheme}://${upstreamName};`);
    lines.push(`        proxy_http_version 1.1;`);
    if (proxy.websocket) {
      lines.push(`        proxy_set_header Upgrade $http_upgrade;`);
      lines.push(`        proxy_set_header Connection "upgrade";`);
    } else {
      lines.push(`        proxy_set_header Connection "";`);
    }
    lines.push(`        proxy_set_header Host $host;`);
    lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
    lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
    lines.push(`        proxy_set_header X-Forwarded-Host $host;`);
    lines.push(`        proxy_set_header X-Forwarded-Port $server_port;`);
    lines.push(``);
    lines.push(`        proxy_buffering off;`);
    lines.push(`        proxy_request_buffering off;`);
    lines.push(`        proxy_connect_timeout 60s;`);
    lines.push(`        proxy_send_timeout 60s;`);
    lines.push(`        proxy_read_timeout 60s;`);
    if (forwardScheme === "https") {
      lines.push(``);
      lines.push(`        proxy_ssl_verify off;`);
    }
  }

  // ── Custom headers (validated key=value pairs) ────────────────────────────
  if (proxy.customHeaders) {
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(proxy.customHeaders) as Record<string, string>;
    } catch {
      // ignore invalid JSON
    }
    for (const [key, value] of Object.entries(headers)) {
      const safeKey = sanitizeNginxValue(key);
      const safeValue = sanitizeNginxValue(value);
      if (safeKey && safeValue) {
        lines.push(`        proxy_set_header ${safeKey} "${escapeNginxString(safeValue)}";`);
      }
    }
  }

  // ── Custom location directives ─────────────────────────────────────────────
  if (proxy.customLocations) {
    lines.push(``);
    lines.push(`        # Custom location directives`);
    proxy.customLocations.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        lines.push(`        ${trimmed}`);
      }
    });
  }

  lines.push(`    }`);
  lines.push(``);

  // ── ACME challenge location (keep even without force-https) ───────────────
  if (!proxy.forceHttps) {
    lines.push(`    location /.well-known/acme-challenge/ {`);
    lines.push(`        root /var/www/html;`);
    lines.push(`    }`);
    lines.push(``);
  }

  lines.push(`}`);

  return lines.join("\n");
}
