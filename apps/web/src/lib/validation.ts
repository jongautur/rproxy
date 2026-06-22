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
  customLocations: z.string().max(4096).optional(),
  customServer: z.string().max(4096).optional(),
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
// Blocks directives that could enable exec or include arbitrary files
const BLOCKED_NGINX_DIRECTIVES = [
  /perl_set/i,
  /set_by_lua/i,
  /content_by_lua/i,
  /access_by_lua/i,
  /rewrite_by_lua/i,
  /\binclude\s+/i,           // block all includes (prevents arbitrary file disclosure)
  /load_module/i,
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
