// Generates the global real_ip snippet that lets nginx recover the true
// client IP when every request arrives via a reverse proxy/CDN (e.g.
// Cloudflare) — without it, $remote_addr (and therefore every access log,
// access-list `allow`/`deny` rule, and X-Real-IP header) is just the CDN
// edge's IP for every visitor.

// Published at https://www.cloudflare.com/ips/ — these ranges change rarely,
// but this list should be refreshed occasionally against that page.
export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

export const CLOUDFLARE_RANGES = [...CLOUDFLARE_IPV4_RANGES, ...CLOUDFLARE_IPV6_RANGES];

export type RealIpSource = "cloudflare" | "custom";
export type RealIpHeader = "cf-connecting-ip" | "x-forwarded-for";

const HEADER_DIRECTIVES: Record<RealIpHeader, string> = {
  "cf-connecting-ip": "CF-Connecting-IP",
  "x-forwarded-for": "X-Forwarded-For",
};

const CIDR_REGEX =
  /^((\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?|[0-9a-fA-F:]+(\/\d{1,3})?)$/;

export function isValidCidr(value: string): boolean {
  return CIDR_REGEX.test(value.trim());
}

// One-per-line list, ignoring blanks/comments, filtered to well-formed
// IPv4/IPv6 CIDRs (or bare addresses) — never trust free text into config.
export function parseCidrList(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter(isValidCidr);
}

export interface RealIpOptions {
  enabled: boolean;
  source: RealIpSource;
  header: RealIpHeader;
  customCidrs: string[];
}

export function generateRealIpConfig(opts: RealIpOptions): string {
  if (!opts.enabled) {
    return "";
  }

  const ranges = opts.source === "cloudflare" ? CLOUDFLARE_RANGES : opts.customCidrs;
  const lines: string[] = [
    "# Managed by rproxy — Settings > Nginx > Real Client IP",
    "# Rewrites $remote_addr to the real client IP for requests coming from",
    "# the trusted ranges below, based on the configured header.",
  ];

  for (const range of ranges) {
    lines.push(`set_real_ip_from ${range};`);
  }

  lines.push(`real_ip_header ${HEADER_DIRECTIVES[opts.header]};`);
  lines.push(`real_ip_recursive on;`);

  return lines.join("\n") + "\n";
}
