import { NextRequest } from "next/server";
import { writeFile, mkdir, mkdtemp, chmod, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { safeExec } from "@/server/system/exec";
import { nginxHelper } from "@/server/system/exec";
import { badRequest, created, fromError } from "@/lib/api-response";
import { isValidDomain } from "@/lib/validation";
import { z } from "zod";

const SSL_BASE = "/etc/nginx/ssl";

const uploadSchema = z.object({
  domain: z.string().min(1).max(253).refine(
    (d) => isValidDomain(d.startsWith("*.") ? d.slice(2) : d),
    "Invalid domain"
  ),
  certificate: z.string().min(1),
  privateKey: z.string().min(1),
  chain: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // mkdtemp(3) always creates the directory mode 0700 regardless of the
  // process umask, so the private key is never briefly world-readable
  // during validation. Always removed in `finally`, success or failure.
  let tmpDir: string | null = null;
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;

    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    }

    const { domain, certificate, privateKey, chain } = parsed.data;

    tmpDir = await mkdtemp(path.join(tmpdir(), "rproxy-cert-"));
    const tmpCert = path.join(tmpDir, "cert.pem");
    const tmpKey = path.join(tmpDir, "key.pem");
    await writeFile(tmpCert, certificate.trim() + "\n", "utf-8");
    await writeFile(tmpKey, privateKey.trim() + "\n", "utf-8");

    // Validate: cert must parse
    const certCheck = await safeExec("/usr/bin/openssl", ["x509", "-noout", "-text", "-in", tmpCert]);
    if (certCheck.exitCode !== 0) {
      return badRequest("Invalid certificate PEM");
    }

    // Validate: key must parse
    const keyCheck = await safeExec("/usr/bin/openssl", ["pkey", "-noout", "-in", tmpKey]);
    if (keyCheck.exitCode !== 0) {
      return badRequest("Invalid private key PEM");
    }

    // Validate: cert and key must match (compare public key modulus/material)
    const certPub = await safeExec("/usr/bin/openssl", ["x509", "-noout", "-pubkey", "-in", tmpCert]);
    const keyPub = await safeExec("/usr/bin/openssl", ["pkey", "-pubout", "-in", tmpKey]);
    if (certPub.stdout.trim() !== keyPub.stdout.trim()) {
      return badRequest("Certificate and private key do not match");
    }

    // Parse cert info
    const [datesResult, sansResult, subjectResult] = await Promise.all([
      safeExec("/usr/bin/openssl", ["x509", "-noout", "-dates", "-in", tmpCert]),
      safeExec("/usr/bin/openssl", ["x509", "-noout", "-ext", "subjectAltName", "-in", tmpCert]),
      safeExec("/usr/bin/openssl", ["x509", "-noout", "-issuer", "-subject", "-in", tmpCert]),
    ]);

    const notAfterMatch = /notAfter=(.+)/.exec(datesResult.stdout);
    const notBeforeMatch = /notBefore=(.+)/.exec(datesResult.stdout);
    const issuerMatch = /issuer=(.+)/.exec(subjectResult.stdout);
    const subjectMatch = /subject=(.+)/.exec(subjectResult.stdout);

    const sans: string[] = [];
    for (const m of sansResult.stdout.matchAll(/DNS:([a-zA-Z0-9.*-]+)/g)) {
      if (m[1]) sans.push(m[1]);
    }

    // Write cert files to ssl directory via mkdir-ssl helper, then direct write
    await nginxHelper("mkdir-ssl");

    const safeName = domain.replace(/^\*\./, "wildcard.").replace(/[^a-zA-Z0-9.-]/g, "_");
    const certDir = path.join(SSL_BASE, safeName);
    await mkdir(certDir, { recursive: true });
    await chmod(certDir, 0o700);

    const certPath = path.join(certDir, "cert.pem");
    const keyPath = path.join(certDir, "key.pem");
    const chainPath = path.join(certDir, "fullchain.pem");

    // Explicit chmod after write: the `mode` passed to writeFile is still
    // subject to the process umask, so it can't be relied on alone to keep
    // the private key non-world-readable.
    await writeFile(certPath, certificate.trim() + "\n", "utf-8");
    await chmod(certPath, 0o644);
    await writeFile(keyPath, privateKey.trim() + "\n", "utf-8");
    await chmod(keyPath, 0o600);
    await writeFile(chainPath, (chain ? chain.trim() + "\n" : certificate.trim() + "\n"), "utf-8");
    await chmod(chainPath, 0o644);

    const cert = await prisma.certificate.create({
      data: {
        domain,
        provider: "CUSTOM",
        challengeType: "HTTP",
        status: "ACTIVE",
        certPath,
        keyPath,
        chainPath,
        sans,
        issuer: issuerMatch?.[1]?.trim() ?? "Unknown",
        subject: subjectMatch?.[1]?.trim() ?? domain,
        expiresAt: notAfterMatch?.[1] ? new Date(notAfterMatch[1]) : null,
        issuedAt: notBeforeMatch?.[1] ? new Date(notBeforeMatch[1]) : null,
        autoRenew: false,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: "ISSUE_CERT",
        entity: "Certificate",
        entityId: cert.id,
        details: JSON.stringify({ domain, provider: "CUSTOM" }),
      },
    });

    return created({ certificate: cert });
  } catch (e) {
    return fromError(e);
  } finally {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
