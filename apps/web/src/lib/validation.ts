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
function getAppPort(): number {
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

// ── Custom directives safety check ───────────────────────────────────────────
// These directives are admin-only free text inserted close to verbatim into
// the generated nginx config (see nginx-config.ts / redirect-config.ts), so
// this isn't a sandbox in the sense of stopping a fully malicious admin —
// admins can already break or materially alter nginx through this field.
// It exists to catch context-escape and RCE-adjacent mistakes/payloads:
// blocks directives that could enable exec or include arbitrary files, and
// blocks braces so a line can't close the current server/location block and
// open a new one (or the reverse) — a blocklist can't safely reason about
// brace balance or nesting context, so any brace is rejected outright
// rather than trying to allow "balanced" ones.
const BLOCKED_NGINX_DIRECTIVES = [
  /perl_set/i,
  /set_by_lua/i,
  /content_by_lua/i,
  /access_by_lua/i,
  /rewrite_by_lua/i,
  /\binclude\s+/i,           // block all includes (prevents arbitrary file disclosure)
  /load_module/i,
  /[{}]/,                    // no nested blocks / context escapes — one directive per line
];

export function validateNginxDirective(directive: string): boolean {
  return !BLOCKED_NGINX_DIRECTIVES.some((r) => r.test(directive));
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
