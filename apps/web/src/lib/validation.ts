import { z } from "zod";

// ── Domain validation ─────────────────────────────────────────────────────────
// Allows: example.com, sub.example.com, *.example.com (wildcard), localhost
const DOMAIN_REGEX =
  /^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$/;

export const domainSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(DOMAIN_REGEX, "Invalid domain name");

// ── Port validation ───────────────────────────────────────────────────────────
// Ports 1-65535, excluding well-known system ports below 80 unless explicitly needed
export const portSchema = z
  .number()
  .int()
  .min(1)
  .max(65535);

// ── Hostname/IP validation ────────────────────────────────────────────────────
const HOSTNAME_REGEX =
  /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const IPV4_REGEX =
  /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

export const forwardHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine(
    (v) => HOSTNAME_REGEX.test(v) || IPV4_REGEX.test(v) || v === "localhost",
    "Must be a valid hostname, IP address, or localhost"
  );

// ── Self-loop guard ───────────────────────────────────────────────────────────
// The app itself listens on one port (see NEXTAUTH_URL / start-app.sh). If a
// proxy or stream host's own listen port matches that, nginx can never bind
// it — the exact failure mode from the `rproxy.local` incident, where nginx
// silently stopped reloading for every site because one broken listener
// collided with the app's own port. Forwarding TO the app's port (e.g.
// fronting the rproxy GUI itself with a real domain + TLS) is fine and
// common — only the *listen* side is a hard conflict.
// Exported for the API Gateway config-generator, which needs the app's own
// port to build the internal auth_request proxy_pass target
// (http://127.0.0.1:<appPort>/api/gateway/auth-check) — see
// api-gateway-config.ts.
export function getAppPort(): number {
  try {
    const url = new URL(process.env.NEXTAUTH_URL ?? "http://localhost:81");
    return url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  } catch {
    return 81;
  }
}

export function isAppOwnPort(port: number): boolean {
  return port === getAppPort();
}

export const APP_PORT_MESSAGE = "This port is already used by the rproxy app itself — nginx cannot also bind it. Choose a different port, or use this port as a forward target instead (e.g. to front the app's own GUI).";

// Called explicitly by route handlers (not wired via .superRefine, which
// would turn these schemas into ZodEffects and break the `.partial()` calls
// PATCH routes rely on for partial updates).
export function checkSelfLoopPorts(ports: (number | undefined)[]): string | null {
  for (const port of ports) {
    if (port !== undefined && isAppOwnPort(port)) return APP_PORT_MESSAGE;
  }
  return null;
}

// ── Proxy host form ───────────────────────────────────────────────────────────
export const proxyHostSchema = z.object({
  domain: domainSchema,
  forwardHost: forwardHostSchema,
  forwardScheme: z.enum(["http", "https", "grpc", "grpcs"]).default("http"),
  forwardPort: portSchema,
  listenPort: portSchema.default(80),
  httpsPort: portSchema.default(443),
  sslEnabled: z.boolean().default(false),
  forceHttps: z.boolean().default(false),
  http2: z.boolean().default(false),
  websocket: z.boolean().default(false),
  accessLog: z.boolean().default(true),
  errorLog: z.boolean().default(true),
  // validateNginxDirective is checked here (not just in the config generator)
  // so a blocked keyword comes back as a 400 with a field error instead of
  // surfacing as an uncaught 500 from deep inside generateNginxConfig.
  customLocations: z.string().max(4096).optional()
    .refine((v) => !v || validateNginxDirective(v), "Contains blocked directives or braces"),
  customServer: z.string().max(4096).optional()
    .refine((v) => !v || validateNginxDirective(v), "Contains blocked directives or braces"),
  customHeaders: z.record(z.string(), z.string()).optional(),
  certificateId: z.string().cuid().optional(),
  accessListId: z.string().cuid().nullable().optional(),
});

// ── Redirect host form ────────────────────────────────────────────────────────
export const redirectHostSchema = z.object({
  sourceDomain: domainSchema,
  destination: z.string().url("Destination must be a valid URL").max(2048),
  redirectCode: z.literal(301).or(z.literal(302)).default(301),
  preservePath: z.boolean().default(true),
  sslEnabled: z.boolean().default(false),
  certificateId: z.string().cuid().optional(),
  accessListId: z.string().cuid().nullable().optional(),
});

// ── Certificate form ──────────────────────────────────────────────────────────
export const certificateSchema = z.object({
  domain: domainSchema,
  provider: z.enum(["LETSENCRYPT", "CUSTOM", "SELF_SIGNED"]),
  challengeType: z.enum(["HTTP", "DNS"]),
  email: z.string().email().optional(),
  dnsProvider: z.string().max(64).optional(),
  dnsCredentials: z.record(z.string(), z.string()).optional(),
  autoRenew: z.boolean().default(true),
});

// ── Login form ────────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// ── API Gateway ───────────────────────────────────────────────────────────────

// Base path / route path — must start with "/", no ".." traversal, no
// characters that could break out of an nginx location match.
const API_PATH_REGEX = /^\/[a-zA-Z0-9_\-./]*$/;
const apiPathSchema = z
  .string()
  .max(512)
  .refine((v) => v === "" || (API_PATH_REGEX.test(v) && !v.includes("..")), "Must start with / and contain only safe path characters");

export const apiSchema = z.object({
  name: z.string().min(1).max(128),
  domain: domainSchema,
  basePath: apiPathSchema.default(""),
  description: z.string().max(1024).optional(),
  listenPort: portSchema.default(80),
  httpsPort: portSchema.default(443),
  sslEnabled: z.boolean().default(false),
  maxRequestsPerSecond: z.number().int().min(1).max(100_000).optional(),
  maxBodySizeMb: z.number().int().min(1).max(10_000).optional(),
  corsEnabled: z.boolean().default(false),
  certificateId: z.string().cuid().optional(),
});

export const apiRouteMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// Bare HTTP header token chars only (letters/digits/hyphen) — this name is
// interpolated unquoted into `proxy_set_header <name> "...";`, so it must
// never be able to contain whitespace, quotes, or a semicolon regardless of
// what sanitizeNginxValue/escapeNginxString would also strip downstream.
const upstreamAuthHeaderNameSchema = z.string().max(64).regex(/^[A-Za-z0-9-]+$/, "Header name must contain only letters, digits, and hyphens");

export const apiRouteSchema = z.object({
  path: apiPathSchema.refine((v) => v !== "", "Route path is required"),
  // Empty = any method (was a single value defaulting to the sentinel
  // "ANY"; now a set, with an empty set meaning the same thing).
  methods: z.array(apiRouteMethodSchema).max(5).default([]),
  upstreamScheme: z.enum(["http", "https"]).default("http"),
  upstreamHost: forwardHostSchema,
  upstreamPort: portSchema,
  upstreamPath: apiPathSchema.optional(),
  authRequired: z.boolean().default(true),
  maxRequestsPerSecond: z.number().int().min(1).max(100_000).optional(),
  enabled: z.boolean().default(true),
  // Credential rproxy presents to the BACKEND (separate from authRequired,
  // which gates the caller) — see the ApiRoute schema comment. Value is
  // plaintext here; route.service.ts encrypts it before it ever reaches
  // Postgres and never returns it. An empty/omitted upstreamAuthValue on
  // update means "keep the existing secret," not "clear it."
  upstreamAuthType: z.enum(["NONE", "BEARER", "API_KEY"]).default("NONE"),
  upstreamAuthHeaderName: upstreamAuthHeaderNameSchema.optional(),
  upstreamAuthValue: z.string().max(2048).optional(),
});

export const customerSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email().max(256).optional(),
  enabled: z.boolean().default(true),
  notes: z.string().max(2048).optional(),
});

// Body of the sleik.is → rproxy machine-to-machine signup call (see
// app/api/gateway/signup/route.ts). `uid` is sleik.is's own Keycloak user
// id, not persisted here (rproxy's Customer has no such column) — it only
// flows into the audit log details so a signup can be traced back to the
// originating sleik.is account without rproxy needing to model identity
// providers it doesn't own.
export const gatewaySignupSchema = z.object({
  uid: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  email: z.string().email().max(256),
});

export const gatewayRotateSchema = z.object({
  customerId: z.string().min(1).max(128),
});

export const apiKeyCreateSchema = z.object({
  label: z.string().max(128).default(""),
  expiresAt: z.coerce.date().optional(),
});

export const apiKeyScopeSchema = z.object({
  scopeRestricted: z.boolean(),
  // Per selected route, an optional method subset — empty means "inherit
  // whatever the route itself allows" (validated as an actual subset of
  // the route's own methods in setKeyScope, since a route's methods aren't
  // known at the zod-schema layer).
  routes: z.array(z.object({
    routeId: z.string().cuid(),
    methods: z.array(apiRouteMethodSchema).max(5).default([]),
  })).max(500),
});

// Shared shape for both the API-level grant (ApiAccess) and the per-route
// override (ApiRouteAccess) — same override fields, different parent.
const accessLimitFields = {
  enabled: z.boolean().default(true),
  rateLimitOverride: z.number().int().min(1).max(1_000_000).optional(),
  dailyQuota: z.number().int().min(1).optional(),
  monthlyQuota: z.number().int().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
};

export const apiAccessSchema = z.object({
  apiId: z.string().cuid(),
  ...accessLimitFields,
});

export const apiRouteAccessSchema = z.object({
  routeId: z.string().cuid(),
  ...accessLimitFields,
});

// Used by the nested apis/[id]/routes/[routeId]/access endpoint, where
// routeId already comes from the URL — the customer being granted the
// override is the only identifier still needed in the body.
export const apiRouteAccessCreateSchema = z.object({
  customerId: z.string().cuid(),
  ...accessLimitFields,
});

// ── API Gateway documentation ────────────────────────────────────────────────
// Docs slug feeds a public URL (/docs/[slug]) and a filename-safe cache key —
// same char class as a typical URL path segment, deliberately not the cuid id
// (see Api.docsSlug in schema.prisma).
export const docsSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, and hyphens only");

export const apiDocsSettingsSchema = z.object({
  docsEnabled: z.boolean().default(false),
  docsTitle: z.string().max(128).optional(),
  docsDescription: z.string().max(2048).optional(),
  docsVersion: z.string().max(32).optional(),
  docsIntro: z.string().max(20_000).optional(),
  docsAuthContent: z.string().max(20_000).optional(),
  docsErrorsContent: z.string().max(20_000).optional(),
  docsNotes: z.string().max(20_000).optional(),
  docsPublic: z.boolean().default(false),
  docsSlug: docsSlugSchema.optional(),
  // https only — the docs page is always served over TLS, and the /docs
  // CSP's img-src only allows the `https:` scheme (see next.config.ts).
  docsLogoUrl: z.string().url().max(1024).startsWith("https://").optional(),
  docsCountDisabledRoutes: z.boolean().default(false),
});

// Bare identifier only — this becomes an OpenAPI parameter `name`, embedded
// as-is into the generated document (see docs.service.ts#buildOperation). A
// name copy-pasted from a URL query string (e.g. "?q=" instead of "q")
// produces an invalid OpenAPI parameter that breaks Scalar's operation
// rendering entirely (observed: "Select an operation to view details"
// instead of the actual operation), so this is rejected at the boundary
// rather than left for the docs viewer to choke on.
const docParameterNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/, "Parameter name must not include ?, =, &, spaces, or other special characters");

const docParameterSchema = z.object({
  name: docParameterNameSchema,
  in: z.enum(["query", "path", "header"]),
  required: z.boolean().default(false),
  description: z.string().max(1024).optional(),
});

const docResponseSchema = z.object({
  status: z.string().min(1).max(16),
  description: z.string().max(1024).optional(),
  example: z.string().max(10_000).optional(),
});

export const apiRouteDocsSchema = z.object({
  docInclude: z.boolean().default(true),
  docSummary: z.string().max(256).optional(),
  docDescription: z.string().max(10_000).optional(),
  docCategory: z.string().max(64).optional(),
  docDeprecated: z.boolean().default(false),
  docParameters: z.array(docParameterSchema).max(50).default([]),
  docRequestBodyDescription: z.string().max(2048).optional(),
  docRequestBodyExample: z.string().max(20_000).optional(),
  docResponses: z.array(docResponseSchema).max(50).default([]),
  docNotes: z.string().max(10_000).optional(),
  // Only meaningful when the route itself has no methods set (any method) —
  // see ApiRoute.docAnyMethods in schema.prisma.
  docAnyMethods: z.array(apiRouteMethodSchema).max(5).default([]),
});

// ── Custom directives safety check ───────────────────────────────────────────
// These directives are admin-only free text inserted close to verbatim into
// the generated nginx config (see nginx-config.ts / redirect-config.ts), so
// this isn't a sandbox in the sense of stopping a fully malicious admin —
// admins can already break or materially alter nginx through this field.
// It exists to catch context-escape and RCE-adjacent mistakes/payloads:
// blocks directives that could enable exec or include arbitrary files.
const BLOCKED_NGINX_DIRECTIVES = [
  /perl_set/i,
  /set_by_lua/i,
  /content_by_lua/i,
  /access_by_lua/i,
  /rewrite_by_lua/i,
  /\binclude\s+/i,           // block all includes (prevents arbitrary file disclosure)
  /load_module/i,
];

// Braces are only allowed to form a "location <path> { ... }" block — the
// one nesting shape the generator itself emits this field into (see
// nginx-config.ts). Every opening line must be a bare `location ... {`, every
// closing line must be a bare `}`, and depth must never go negative or end
// above zero — that rules out a line closing the *enclosing* context early
// (context escape) or opening any other block type (server, http, if-lua,
// etc.), without banning braces outright.
const LOCATION_OPEN_RE = /^location\s+\S.*\{$/;

function hasWellFormedLocationBraces(directive: string): boolean {
  let depth = 0;
  for (const rawLine of directive.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (opens === 0 && closes === 0) continue;
    if (opens === 1 && closes === 0 && LOCATION_OPEN_RE.test(line)) {
      depth++;
      continue;
    }
    if (opens === 0 && closes === 1 && line === "}") {
      depth--;
      if (depth < 0) return false;
      continue;
    }
    return false; // any other brace usage — reject
  }
  return depth === 0;
}

export function validateNginxDirective(directive: string): boolean {
  return !BLOCKED_NGINX_DIRECTIVES.some((r) => r.test(directive))
    && hasWellFormedLocationBraces(directive);
}

// ── Sanitize for nginx config values ─────────────────────────────────────────
// Values placed inside nginx config strings must not contain injection chars
export function sanitizeNginxValue(value: string): string {
  // Remove chars that could break out of nginx config context
  return value.replace(/[;{}"'\\\n\r\t]/g, "");
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function isValidDomain(domain: string): boolean {
  return DOMAIN_REGEX.test(domain);
}
