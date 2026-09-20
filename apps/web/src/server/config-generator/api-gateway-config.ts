import type { Api, ApiRoute, Certificate } from "@prisma/client";

// Route plus the plaintext upstream-auth secret, decrypted by the caller
// (api.service.ts — the I/O boundary) so this file stays a pure renderer,
// same convention as everywhere else in config-generator/. null when
// upstreamAuthType is NONE, or decryption failed for this route.
export type ApiRouteWithAuth = ApiRoute & { upstreamAuthValue: string | null };
import { isValidDomain, isValidPort, sanitizeNginxValue, getAppPort } from "@/lib/validation";
import { domainToFilename } from "@/server/config-generator/nginx-config";
import { zoneNameForRoute, zoneNameForDocs, DEFAULT_BURST } from "@/server/config-generator/api-gateway-zones-config";
import path from "path";

// Key-protected routes are gated by nginx `auth_request` calling this
// app's internal /api/gateway/auth-check endpoint. `limit_req` here is a
// static, non-customer-aware safety ceiling per route (falling back to the
// parent Api's default) — it protects the backend regardless of caller;
// true per-customer rate/quota limiting is enforced separately via Redis in
// gateway-auth.service.ts and surfaces through this same auth_request path
// (a rate_limited/quota_exceeded deny reason, remapped to a real 429 by
// AUTH_ERROR_LOCATIONS below). All values placed into nginx config must
// pass through these escaping functions, same convention as
// nginx-config.ts — NEVER interpolate user input directly.

function escapeNginxString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function validateDomain(domain: string): void {
  if (!isValidDomain(domain) && domain !== "localhost") {
    throw new Error(`Invalid domain: ${domain}`);
  }
}

const HOSTNAME_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4_REGEX = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

function validateUpstreamTarget(host: string, port: number): void {
  if (!IPV4_REGEX.test(host) && !HOSTNAME_REGEX.test(host) && host !== "localhost") {
    throw new Error(`Invalid upstream host: ${host}`);
  }
  if (!isValidPort(port)) {
    throw new Error(`Invalid upstream port: ${port}`);
  }
}

// Same char class as docsSlugSchema in validation.ts — re-checked here as
// defense in depth (this value is interpolated into a proxy_pass URI).
const DOCS_SLUG_REGEX = /^[a-z0-9-]+$/;
function validateDocsSlug(slug: string): void {
  if (!DOCS_SLUG_REGEX.test(slug)) {
    throw new Error(`Invalid docs slug: ${slug}`);
  }
}

// "/" or "" only — anything else must start with "/" and contain no "..".
// Same safety property zod's apiPathSchema already enforces at the API
// boundary; re-checked here as defense in depth (see nginx-config.ts for
// why: this function could in principle be called from elsewhere).
function validatePath(p: string, label: string): void {
  if (p === "" || p === "/") return;
  if (!p.startsWith("/") || p.includes("..") || /[;{}"'\\\n\r\t]/.test(p)) {
    throw new Error(`Invalid ${label}: ${p}`);
  }
}

// Distinct "gw-" prefix so an API Gateway site's sites-available filename
// can never collide with a ProxyHost/RedirectHost on the same domain (those
// use the bare domainToFilename() result).
export function apiConfigFilename(domain: string): string {
  return `gw-${domainToFilename(domain)}.conf`;
}

// Internal nginx location that proxies to this app's auth-check endpoint.
// `= ` for an exact match, `internal;` so it 404s if ever hit directly
// instead of via auth_request (defense in depth beyond the network
// boundary — see auth-check/route.ts's own header-secret check).
const INTERNAL_AUTH_URI = "/internal/gateway-auth";

// Named locations nginx's auth_request module dispatches to when the
// subrequest returns 401/403 (the only two codes it understands besides
// 2xx — see auth-check/route.ts for why a 429-worthy denial is still
// returned as a 403 with a reason header). @gw_403 branches on that header
// to remap a Redis-backed rate/quota denial (see gateway-auth.service.ts's
// checkRateAndQuota) to a real client-visible 429 — verified against real
// nginx in api-gateway-auth-integration.test.ts.
const AUTH_ERROR_LOCATIONS = `
location @gw_401 {
    default_type application/json;
    return 401 '{"success":false,"error":"Unauthorized"}';
}
location @gw_403 {
    default_type application/json;
    if ($gw_ratelimit_limit != "") {
        add_header X-RateLimit-Limit $gw_ratelimit_limit always;
    }
    if ($gw_ratelimit_remaining != "") {
        add_header X-RateLimit-Remaining $gw_ratelimit_remaining always;
    }
    if ($gw_deny_reason = "rate_limited") {
        return 429 '{"success":false,"error":"Rate limit exceeded"}';
    }
    if ($gw_deny_reason = "quota_exceeded") {
        return 429 '{"success":false,"error":"Quota exceeded"}';
    }
    return 403 '{"success":false,"error":"Forbidden"}';
}`;

interface GeneratorOptions {
  api: Api;
  routes: ApiRouteWithAuth[];
  certificate: Certificate | null;
}

export function generateApiGatewayConfig(opts: GeneratorOptions): string {
  const { api, certificate } = opts;
  const routes = opts.routes.filter((r) => r.enabled);
  const needsAuth = routes.some((r) => r.authRequired);

  // ── Validate all inputs before touching config ────────────────────────────
  validateDomain(api.domain);
  if (!isValidPort(api.listenPort)) throw new Error(`Invalid listen port: ${api.listenPort}`);
  if (!isValidPort(api.httpsPort)) throw new Error(`Invalid https port: ${api.httpsPort}`);
  validatePath(api.basePath, "base path");
  const HEADER_NAME_REGEX = /^[A-Za-z0-9-]+$/;
  for (const route of routes) {
    validatePath(route.path, "route path");
    if (route.upstreamPath) validatePath(route.upstreamPath, "upstream path");
    validateUpstreamTarget(route.upstreamHost, route.upstreamPort);
    // Defense in depth beyond the zod boundary (upstreamAuthHeaderNameSchema
    // in validation.ts) — this name is interpolated unquoted, right before
    // the quoted value, into `proxy_set_header <name> "...";`.
    if (route.upstreamAuthType === "API_KEY" && route.upstreamAuthHeaderName && !HEADER_NAME_REGEX.test(route.upstreamAuthHeaderName)) {
      throw new Error(`Invalid upstream auth header name: ${route.upstreamAuthHeaderName}`);
    }
  }

  // Fail at generation time, not silently deploy an internal endpoint an
  // attacker could hit without the secret — better to block the deploy
  // than to ship a gateway whose auth check nobody can actually reach.
  const internalAuthSecret = process.env.GATEWAY_AUTH_SECRET;
  if (needsAuth && !internalAuthSecret) {
    throw new Error("GATEWAY_AUTH_SECRET is not configured — cannot deploy a key-protected API route");
  }

  const domain = escapeNginxString(sanitizeNginxValue(api.domain));
  const sslEnabled = api.sslEnabled && certificate?.certPath && certificate?.keyPath;
  const certPath = certificate?.certPath ? path.resolve(certificate.certPath) : null;
  const keyPath = certificate?.keyPath ? path.resolve(certificate.keyPath) : null;
  const chainPath = certificate?.chainPath ? path.resolve(certificate.chainPath) : null;

  const basePath = api.basePath === "/" ? "" : api.basePath;

  const lines: string[] = [];

  lines.push(`server {`);

  if (sslEnabled) {
    lines.push(`    listen ${api.httpsPort} ssl;`);
    lines.push(`    listen [::]:${api.httpsPort} ssl;`);
  } else {
    lines.push(`    listen ${api.listenPort};`);
    lines.push(`    listen [::]:${api.listenPort};`);
  }
  lines.push(`    server_name ${domain};`);
  lines.push(``);

  lines.push(`    access_log /var/log/nginx/${domainToFilename(domain)}.gw.access.log;`);
  lines.push(`    access_log /var/log/nginx/all-access.log;`);
  lines.push(`    error_log /var/log/nginx/${domainToFilename(domain)}.gw.error.log;`);
  lines.push(``);

  if (sslEnabled && certPath && keyPath) {
    lines.push(`    ssl_certificate ${chainPath ?? certPath};`);
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
    lines.push(``);
    lines.push(`    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`);
  }

  lines.push(`    add_header X-Frame-Options "SAMEORIGIN" always;`);
  lines.push(`    add_header X-Content-Type-Options "nosniff" always;`);
  lines.push(``);

  if (api.maxBodySizeMb) {
    lines.push(`    client_max_body_size ${api.maxBodySizeMb}m;`);
    lines.push(``);
  }

  // ── ACME challenge (cert issuance) ─────────────────────────────────────────
  lines.push(`    location /.well-known/acme-challenge/ {`);
  lines.push(`        root /var/www/html;`);
  lines.push(`    }`);
  lines.push(``);

  // ── Internal auth_request target + error remapping (only if some route
  //    actually requires a key) ───────────────────────────────────────────
  if (needsAuth) {
    lines.push(`    location = ${INTERNAL_AUTH_URI} {`);
    lines.push(`        internal;`);
    lines.push(`        proxy_pass http://127.0.0.1:${getAppPort()}/api/gateway/auth-check;`);
    lines.push(`        proxy_pass_request_body off;`);
    lines.push(`        proxy_set_header Content-Length "";`);
    lines.push(`        proxy_set_header X-Api-Key $http_x_api_key;`);
    lines.push(`        proxy_set_header X-Gateway-Api-Id "${sanitizeNginxValue(api.id)}";`);
    // Set per-route via `set $gw_route_id` in each protected location below —
    // this shared internal location just forwards whatever the calling
    // location set, so one internal location serves every route on this
    // Api instead of needing one per route.
    lines.push(`        proxy_set_header X-Gateway-Route-Id $gw_route_id;`);
    // The real request method (a live nginx variable, not baked in at
    // generation time like the api/route id headers above) — lets a
    // per-key method sub-scope (see gateway-auth.service.ts) check the
    // actual method being used, independent of the route's own method set.
    lines.push(`        proxy_set_header X-Gateway-Method $request_method;`);
    lines.push(`        proxy_set_header X-Gateway-Internal-Secret "${escapeNginxString(internalAuthSecret!)}";`);
    lines.push(`    }`);
    lines.push(AUTH_ERROR_LOCATIONS);
    lines.push(``);
  }

  // ── One location per enabled route ─────────────────────────────────────────
  for (const route of routes) {
    const fullPath = (basePath + (route.path === "/" ? "" : route.path)) || "/";
    const upstreamScheme = route.upstreamScheme === "https" ? "https" : "http";
    const upstreamHost = escapeNginxString(sanitizeNginxValue(route.upstreamHost));

    lines.push(`    location ${fullPath} {`);

    // ── CORS (Correction 10) ────────────────────────────────────────────────
    // Must come before limit_except/auth_request: a browser's OPTIONS
    // preflight carries neither the real request method nor the X-Api-Key
    // header by design, so gating it behind either would break every
    // browser-based caller even for a fully authorized real request. Off
    // by default — corsEnabled opts an Api into a permissive `*` origin;
    // scoping to specific origins is a natural follow-up, not attempted here.
    if (api.corsEnabled) {
      lines.push(`        add_header Access-Control-Allow-Origin "*" always;`);
      lines.push(`        if ($request_method = OPTIONS) {`);
      lines.push(`            add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;`);
      lines.push(`            add_header Access-Control-Allow-Headers "Content-Type, X-Api-Key" always;`);
      lines.push(`            add_header Access-Control-Max-Age 86400 always;`);
      lines.push(`            return 204;`);
      lines.push(`        }`);
    }

    // limit_except restricts every method EXCEPT the ones listed — nginx
    // implicitly permits HEAD whenever GET is listed, so no separate HEAD
    // entry is needed. A route restricted to specific methods will reject a
    // non-preflight OPTIONS request unless corsEnabled already returned
    // above. Empty methods array = ANY (unchanged behavior, just keyed off
    // array length now instead of a sentinel enum value).
    if (route.methods.length > 0) {
      lines.push(`        limit_except ${route.methods.join(" ")} {`);
      lines.push(`            deny all;`);
      lines.push(`        }`);
    }

    // ── Static per-route safety limit (Redis-backed per-customer limiting
    //    happens inside auth_request below, not here) ──────────────────────
    const effectiveStaticLimit = route.maxRequestsPerSecond ?? api.maxRequestsPerSecond;
    if (effectiveStaticLimit) {
      lines.push(`        limit_req zone=${zoneNameForRoute(route.id)} burst=${DEFAULT_BURST} nodelay;`);
    }

    if (route.authRequired) {
      lines.push(`        set $gw_route_id "${sanitizeNginxValue(route.id)}";`);
      lines.push(`        auth_request ${INTERNAL_AUTH_URI};`);
      lines.push(`        auth_request_set $gw_deny_reason $upstream_http_x_gateway_deny_reason;`);
      lines.push(`        auth_request_set $gw_customer_id $upstream_http_x_gateway_customer_id;`);
      // Per-second rate-limit layer only (not daily/monthly quota) — see
      // gateway-auth.service.ts#checkRateAndQuota. Empty when no rateLimit
      // is configured for this customer/route, so the two `if`s below skip
      // emitting an empty header to the caller in that case.
      lines.push(`        auth_request_set $gw_ratelimit_limit $upstream_http_x_gateway_ratelimit_limit;`);
      lines.push(`        auth_request_set $gw_ratelimit_remaining $upstream_http_x_gateway_ratelimit_remaining;`);
      lines.push(`        error_page 401 = @gw_401;`);
      lines.push(`        error_page 403 = @gw_403;`);
      lines.push(`        proxy_set_header X-Gateway-Customer-Id $gw_customer_id;`);
      lines.push(`        if ($gw_ratelimit_limit != "") {`);
      lines.push(`            add_header X-RateLimit-Limit $gw_ratelimit_limit always;`);
      lines.push(`        }`);
      lines.push(`        if ($gw_ratelimit_remaining != "") {`);
      lines.push(`            add_header X-RateLimit-Remaining $gw_ratelimit_remaining always;`);
      lines.push(`        }`);
    }

    // Credential rproxy itself presents to the BACKEND — independent of
    // authRequired above (that gates the caller). Only emitted when a
    // secret actually decrypted successfully (see api.service.ts); a
    // decrypt failure silently omits the header rather than failing the
    // whole deploy, so one bad row doesn't take an entire Api offline.
    if (route.upstreamAuthType === "BEARER" && route.upstreamAuthValue) {
      lines.push(`        proxy_set_header Authorization "Bearer ${escapeNginxString(route.upstreamAuthValue)}";`);
    } else if (route.upstreamAuthType === "API_KEY" && route.upstreamAuthValue && route.upstreamAuthHeaderName) {
      lines.push(`        proxy_set_header ${route.upstreamAuthHeaderName} "${escapeNginxString(route.upstreamAuthValue)}";`);
    }

    if (route.upstreamPath) {
      const upstreamPath = sanitizeNginxValue(route.upstreamPath);
      lines.push(`        proxy_pass ${upstreamScheme}://${upstreamHost}:${route.upstreamPort}${upstreamPath};`);
    } else {
      // No URI component after host:port — nginx passes the original
      // request URI through unchanged (pass-through, not a rewrite).
      lines.push(`        proxy_pass ${upstreamScheme}://${upstreamHost}:${route.upstreamPort};`);
    }
    lines.push(`        proxy_http_version 1.1;`);
    lines.push(`        proxy_set_header Connection "";`);
    lines.push(`        proxy_set_header Host $host;`);
    lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
    lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
    lines.push(`        proxy_connect_timeout 60s;`);
    lines.push(`        proxy_send_timeout 60s;`);
    lines.push(`        proxy_read_timeout 60s;`);
    if (upstreamScheme === "https") {
      lines.push(`        proxy_ssl_verify off;`);
    }
    lines.push(`    }`);
    lines.push(``);
  }

  // ── Developer portal at this gateway's own domain root ──────────────────────
  // Only when docs are both enabled AND public — private docs stay reachable
  // only through the admin app's own (session-gated) /docs/[slug] preview,
  // never at the gateway's public domain. Skipped entirely if some ApiRoute
  // already claims the root path itself — an explicit route always wins.
  const rootClaimedByRoute = routes.some((r) => ((basePath + (r.path === "/" ? "" : r.path)) || "/") === "/");
  if (api.docsEnabled && api.docsPublic && api.docsSlug && !rootClaimedByRoute) {
    validateDocsSlug(api.docsSlug);
    const appPort = getAppPort();
    // Unauthenticated, reachable by anyone — unlike route locations above,
    // there's no admin-configurable rate here (no customer/key exists yet
    // at this point), so every docs-portal location shares one flat safety
    // ceiling (see DOCS_DEFAULT_RATE_PER_SECOND in api-gateway-zones-config.ts)
    // instead of being left unthrottled against the shared app process.
    const docsZone = zoneNameForDocs(api.id);
    lines.push(`    # Developer portal (Docs tab → Documentation settings)`);
    lines.push(`    location = / {`);
    lines.push(`        limit_req zone=${docsZone} burst=${DEFAULT_BURST} nodelay;`);
    lines.push(`        proxy_pass http://127.0.0.1:${appPort}/docs/${api.docsSlug};`);
    lines.push(`        proxy_http_version 1.1;`);
    lines.push(`        proxy_set_header Host $host;`);
    lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
    lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
    lines.push(`    }`);
    lines.push(``);
    // Prefix pass-through (no rewritten URI) — the app resolves the Api by
    // the slug already embedded in the path itself, not by domain, so this
    // works unmodified regardless of which gateway domain it was reached
    // through (see api/gateway/public/[slug]/openapi.json). `/_next/` is the
    // Next.js app-shell assets the docs page references (JS/CSS chunks,
    // fonts) and `/docs/` covers the page's own file-convention metadata
    // sub-routes (e.g. the per-Api icon.tsx favicon at
    // /docs/<slug>/icon) — without either, the page HTML loads but renders
    // blank/unstyled, since none of those requests would otherwise match
    // any location on this gateway's own domain. Deliberately NOT a bare
    // `location /` catch-all: that would proxy every unmatched path (e.g.
    // /dashboard, /settings) straight through to the admin app, reachable
    // on this public domain even though middleware would still reject it —
    // this allowlist keeps the surface to exactly what the docs page needs.
    for (const prefix of ["/api/gateway/public/", "/_next/", "/docs/"]) {
      lines.push(`    location ${prefix} {`);
      lines.push(`        limit_req zone=${docsZone} burst=${DEFAULT_BURST} nodelay;`);
      lines.push(`        proxy_pass http://127.0.0.1:${appPort};`);
      lines.push(`        proxy_http_version 1.1;`);
      lines.push(`        proxy_set_header Host $host;`);
      lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
      lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
      lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
      lines.push(`    }`);
      lines.push(``);
    }
    lines.push(`    location = /favicon.ico {`);
    lines.push(`        limit_req zone=${docsZone} burst=${DEFAULT_BURST} nodelay;`);
    lines.push(`        proxy_pass http://127.0.0.1:${appPort};`);
    lines.push(`        proxy_http_version 1.1;`);
    lines.push(`        proxy_set_header Host $host;`);
    lines.push(`        proxy_set_header X-Real-IP $remote_addr;`);
    lines.push(`        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`);
    lines.push(`        proxy_set_header X-Forwarded-Proto $scheme;`);
    lines.push(`    }`);
    lines.push(``);
  }

  lines.push(`}`);

  return lines.join("\n");
}
