import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/encrypt";
import {
  issueCertificate, renewCertificate, revokeCertificate,
  parseCertInfo, getCertPaths,
} from "@/server/system/acme";
import type { Certificate } from "@prisma/client";
import type { CertificateFormData } from "@/types/certificate";

export async function createCertificate(
  data: CertificateFormData,
  userId: string
): Promise<{ certificate: Certificate; output: string }> {
  const cert = await prisma.certificate.create({
    data: {
      domain: data.domain,
      provider: data.provider,
      challengeType: data.challengeType,
      status: "PENDING",
      dnsProvider: data.dnsProvider,
      dnsCredentials: data.dnsCredentials ? encryptJson(data.dnsCredentials as Record<string, string>) : undefined,
      autoRenew: data.autoRenew,
    },
  });

  if (data.provider !== "LETSENCRYPT") {
    await prisma.auditLog.create({
      data: { userId, action: "ISSUE_CERT", entity: "Certificate", entityId: cert.id },
    });
    return { certificate: cert, output: "Custom/self-signed certificates are managed manually" };
  }

  const email = data.email;
  if (!email) throw new Error("Email is required for Let's Encrypt certificates");
  let dnsEnv: Record<string, string> | undefined;
  if (data.dnsCredentials) {
    dnsEnv = data.dnsCredentials as Record<string, string>;
  }

  const result = await issueCertificate({
    domain: data.domain,
    email,
    challengeType: data.challengeType,
    dnsProvider: data.dnsProvider,
    dnsEnv,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const success = result.exitCode === 0;

  if (success) {
    const { certPath, keyPath, chainPath } = getCertPaths(data.domain);
    let info;
    try {
      info = await parseCertInfo(certPath);
    } catch {
      info = null;
    }

    const updated = await prisma.certificate.update({
      where: { id: cert.id },
      data: {
        status: "ACTIVE",
        certPath,
        keyPath,
        chainPath,
        issuer: info?.issuer,
        subject: info?.subject,
        sans: info?.sans ?? [],
        expiresAt: info?.expiresAt,
        issuedAt: info?.issuedAt,
        lastRenewAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: "ISSUE_CERT", entity: "Certificate", entityId: cert.id },
    });

    return { certificate: updated, output };
  }

  await prisma.certificate.update({
    where: { id: cert.id },
    data: { status: "ERROR", renewError: output.slice(0, 1000) },
  });

  throw new Error(`Certificate issuance failed:\n${output}`);
}

export async function renewCert(id: string, userId: string): Promise<{ certificate: Certificate; output: string }> {
  const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });

  const result = await renewCertificate(cert.domain);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const success = result.exitCode === 0;

  if (success) {
    const { certPath } = getCertPaths(cert.domain);
    let info;
    try { info = await parseCertInfo(certPath); } catch { info = null; }

    const updated = await prisma.certificate.update({
      where: { id },
      data: {
        status: "ACTIVE",
        expiresAt: info?.expiresAt,
        issuedAt: info?.issuedAt,
        lastRenewAt: new Date(),
        renewError: null,
      },
    });

    await prisma.auditLog.create({
      data: { userId, action: "RENEW_CERT", entity: "Certificate", entityId: id },
    });

    return { certificate: updated, output };
  }

  await prisma.certificate.update({
    where: { id },
    data: { renewError: output.slice(0, 1000) },
  });

  throw new Error(`Renewal failed:\n${output}`);
}

export async function deleteCertificate(id: string, userId: string): Promise<void> {
  const cert = await prisma.certificate.findUniqueOrThrow({ where: { id } });

  if (cert.provider === "LETSENCRYPT" && cert.status === "ACTIVE") {
    await revokeCertificate(cert.domain).catch(() => {});
  }

  await prisma.certificate.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      userId, action: "REVOKE_CERT", entity: "Certificate", entityId: id,
      details: JSON.stringify({ domain: cert.domain }),
    },
  });
}

export async function checkAndRenewExpiring(): Promise<void> {
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const expiring = await prisma.certificate.findMany({
    where: {
      autoRenew: true,
      status: "ACTIVE",
      provider: "LETSENCRYPT",
      expiresAt: { lte: thirtyDays },
    },
  });

  for (const cert of expiring) {
    try {
      await renewCertificate(cert.domain);
      const { certPath } = getCertPaths(cert.domain);
      const info = await parseCertInfo(certPath).catch(() => null);
      await prisma.certificate.update({
        where: { id: cert.id },
        data: {
          status: "ACTIVE",
          expiresAt: info?.expiresAt,
          lastRenewAt: new Date(),
          renewError: null,
        },
      });
    } catch (e) {
      await prisma.certificate.update({
        where: { id: cert.id },
        data: { renewError: String(e).slice(0, 1000) },
      });
    }
  }
}
