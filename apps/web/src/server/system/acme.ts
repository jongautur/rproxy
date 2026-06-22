import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { acmeExec, safeExec, sudoExec } from "./exec";
import { isValidDomain } from "@/lib/validation";
import type { ExecResult } from "./exec";

const SSL_BASE = "/etc/nginx/ssl";

// DNS providers supported by acme.sh — used to validate the dnsProvider field
const VALID_DNS_PROVIDERS = new Set([
  "dns_cf",       // Cloudflare
  "dns_aws",      // AWS Route53
  "dns_gd",       // GoDaddy
  "dns_namecheap",
  "dns_digitalocean",
  "dns_ovh",
  "dns_duckdns",
  "dns_linode",
  "dns_vultr",
  "dns_manual",   // Manual DNS (interactive, for testing)
]);

async function setAcmeEmail(email: string): Promise<void> {
  // Restrict to characters safe for a bash single-quoted config value.
  // Single quotes cannot appear inside a bash single-quoted string, so we reject
  // them here rather than attempt escaping, which would change the stored value.
  if (!/^[a-zA-Z0-9._%+@-]+$/.test(email)) {
    throw new Error("Email contains characters not allowed in acme.sh config");
  }
  const confPath = path.join(process.env.HOME ?? "/root", ".acme.sh/account.conf");
  try {
    let content = await readFile(confPath, "utf8");
    if (content.includes("ACCOUNT_EMAIL=")) {
      content = content.replace(/^ACCOUNT_EMAIL=.*$/m, `ACCOUNT_EMAIL='${email}'`);
    } else {
      content += `\nACCOUNT_EMAIL='${email}'\n`;
    }
    await writeFile(confPath, content, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // File doesn't exist yet — acme.sh will create it on first run
  }
}

function validateDomainArg(domain: string): void {
  const base = domain.startsWith("*.") ? domain.slice(2) : domain;
  if (!isValidDomain(base) && base !== "localhost") {
    throw new Error(`Invalid domain for acme.sh: ${domain}`);
  }
}

function certDir(domain: string): string {
  const safe = domain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9.-]/g, "_");
  return path.join(SSL_BASE, safe);
}

export interface CertPaths {
  certPath: string;
  keyPath: string;
  chainPath: string;
  dir: string;
}

export function getCertPaths(domain: string): CertPaths {
  const dir = certDir(domain);
  return {
    dir,
    certPath: path.join(dir, "cert.pem"),
    keyPath: path.join(dir, "key.pem"),
    chainPath: path.join(dir, "fullchain.pem"),
  };
}

export interface IssueOptions {
  domain: string;
  email: string;
  challengeType: "HTTP" | "DNS";
  dnsProvider?: string;
  dnsEnv?: Record<string, string>;
  staging?: boolean;
}

export async function issueCertificate(opts: IssueOptions): Promise<ExecResult> {
  validateDomainArg(opts.domain);

  // Ensure SSL directory exists
  await sudoExec("/opt/rproxy/scripts/nginx-config-helper.sh", ["mkdir-ssl"]);

  // Create domain-specific dir
  const { dir, certPath, keyPath, chainPath } = getCertPaths(opts.domain);
  await mkdir(dir, { recursive: true }).catch(() => {});

  const server = opts.staging ? "letsencrypt_test" : "letsencrypt";

  // Patch account.conf directly — acme.sh sources it after CLI parsing so
  // --accountemail alone gets overwritten by whatever is stored there.
  await setAcmeEmail(opts.email);

  // Register/update the account with the correct email for this CA.
  await acmeExec([
    "--register-account",
    "--accountemail", opts.email,
    "--server", server,
  ]);

  const args: string[] = [
    "--issue",
    "-d", opts.domain,
    "--server", server,
  ];

  if (opts.challengeType === "HTTP") {
    args.push("--webroot", "/var/www/html");
  } else {
    const provider = opts.dnsProvider ?? "";
    if (!VALID_DNS_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported DNS provider: ${provider}`);
    }
    args.push("--dns", provider);
  }

  // Build env for DNS providers (validated keys only, cast for execFile compatibility)
  const dnsEnvVars: Record<string, string> = {};
  if (opts.dnsEnv) {
    for (const [k, v] of Object.entries(opts.dnsEnv)) {
      if (/^[A-Za-z0-9_]+$/.test(k)) {
        dnsEnvVars[k] = v;
      }
    }
  }

  const issueResult = await acmeExec(args, { env: dnsEnvVars as NodeJS.ProcessEnv, timeout: 180_000 });
  // "Skipping" means cert is already issued and valid in acme.sh cache — still need to install it
  const alreadyIssued = issueResult.stdout.includes("Skipping") || issueResult.stdout.includes("Domains not changed");
  if (issueResult.exitCode !== 0 && !issueResult.stdout.includes("Cert success") && !alreadyIssued) {
    return issueResult;
  }

  // Install cert to nginx ssl dir
  const installResult = await acmeExec([
    "--install-cert",
    "-d", opts.domain,
    "--cert-file", certPath,
    "--key-file", keyPath,
    "--fullchain-file", chainPath,
  ]);

  return installResult;
}

export async function renewCertificate(domain: string): Promise<ExecResult> {
  validateDomainArg(domain);
  const { certPath, keyPath, chainPath } = getCertPaths(domain);

  const renewResult = await acmeExec([
    "--renew",
    "-d", domain,
    "--force",
  ], { timeout: 180_000 });

  if (renewResult.exitCode !== 0) return renewResult;

  return acmeExec([
    "--install-cert",
    "-d", domain,
    "--cert-file", certPath,
    "--key-file", keyPath,
    "--fullchain-file", chainPath,
  ]);
}

export async function revokeCertificate(domain: string): Promise<ExecResult> {
  validateDomainArg(domain);
  return acmeExec(["--revoke", "-d", domain, "--server", "letsencrypt"]);
}

export interface CertInfo {
  issuer: string;
  subject: string;
  sans: string[];
  expiresAt: Date;
  issuedAt: Date;
}

export async function parseCertInfo(certPath: string): Promise<CertInfo> {
  // Validate cert path is within the SSL directory
  const resolved = path.resolve(certPath);
  if (!resolved.startsWith(SSL_BASE + "/") && !resolved.startsWith("/tmp/")) {
    throw new Error(`Cert path outside allowed directory: ${certPath}`);
  }

  const [textResult, datesResult, sansResult] = await Promise.all([
    safeExec("/usr/bin/openssl", ["x509", "-in", certPath, "-noout", "-issuer", "-subject"]),
    safeExec("/usr/bin/openssl", ["x509", "-in", certPath, "-noout", "-dates"]),
    safeExec("/usr/bin/openssl", ["x509", "-in", certPath, "-noout", "-ext", "subjectAltName"]),
  ]);

  const issuerMatch = /issuer=(.+)/.exec(textResult.stdout);
  const subjectMatch = /subject=(.+)/.exec(textResult.stdout);
  const notBeforeMatch = /notBefore=(.+)/.exec(datesResult.stdout);
  const notAfterMatch = /notAfter=(.+)/.exec(datesResult.stdout);

  const sans: string[] = [];
  const sanRaw = sansResult.stdout;
  const sanMatches = sanRaw.matchAll(/DNS:([a-zA-Z0-9.*-]+)/g);
  for (const m of sanMatches) {
    if (m[1]) sans.push(m[1]);
  }

  return {
    issuer: issuerMatch?.[1]?.trim() ?? "Unknown",
    subject: subjectMatch?.[1]?.trim() ?? "Unknown",
    sans,
    expiresAt: notAfterMatch?.[1] ? new Date(notAfterMatch[1]) : new Date(0),
    issuedAt: notBeforeMatch?.[1] ? new Date(notBeforeMatch[1]) : new Date(0),
  };
}
