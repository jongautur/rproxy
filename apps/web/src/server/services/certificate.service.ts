import { prisma } from "@/lib/prisma";
import { fireNotification } from "@/server/services/notification.service";
import { encryptJson } from "@/lib/encrypt";
import { reloadNginx } from "@/server/system/nginx";
import {
  issueCertificate, renewCertificate, revokeCertificate,
  parseCertInfo, getCertPaths,
} from "@/server/system/acme";
import {
  getIntegration, resolveZoneForDomain, upsertARecord, getPublicIp, waitForDnsPropagation,
  type CloudflareZone,
} from "@/server/services/cloudflare.service";
import type { Certificate } from "@prisma/client";
import type { CertificateFormData } from "@/types/certificate";

export interface DnsRecordResult {
  created: boolean;
  propagated?: boolean;
  proxied?: boolean;
  error?: string;
}

// Best-effort — a Cloudflare hiccup must never block certificate issuance,
// since the cert flow is fully functional without DNS automation.
async function ensureDnsRecordForCert(domain: string, challengeType: string): Promise<{ result?: DnsRecordResult; zone?: CloudflareZone; token?: string; ip?: string }> {
  try {
    const integration = await getIntegration();
    if (!integration?.autoDnsEnabled) return {};

    const zone = await resolveZoneForDomain(integration.apiToken, domain);
    if (!zone) {
      return { result: { created: false, error: `No Cloudflare zone found for ${domain}` } };
    }

    const ip = integration.lastPublicIp ?? await getPublicIp();
    await upsertARecord(integration.apiToken, zone.id, domain, ip, { proxied: integration.defaultProxied });

    // Only HTTP-01 needs the A record to have propagated publicly before
    // issuance — DNS-01 validates via its own TXT record instead. A proxied
    // (orange-cloud) record never publicly resolves to the origin IP at all
    // — it resolves to Cloudflare's edge — so the check would always time
    // out even though the record is correct; skip it in that case too.
    const propagated = challengeType === "HTTP" && !integration.defaultProxied
      ? await waitForDnsPropagation(domain, ip)
      : undefined;

    return { result: { created: true, propagated }, zone, token: integration.apiToken, ip };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`Cloudflare DNS auto-create failed for ${domain}:`, error);
    return { result: { created: false, error } };
  }
}

export async function createCertificate(
  data: CertificateFormData,
  userId: string
): Promise<{ certificate: Certificate; output: string; dnsRecord?: DnsRecordResult }> {
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

  const dns = await ensureDnsRecordForCert(data.domain, data.challengeType);

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

    await reloadNginx();

    await prisma.auditLog.create({
      data: { userId, action: "ISSUE_CERT", entity: "Certificate", entityId: cert.id },
    });

    if (dns.zone && dns.token && dns.ip) {
      try {
        const integration = await getIntegration();
        if (integration?.proxyAfterSsl) {
          await upsertARecord(dns.token, dns.zone.id, data.domain, dns.ip, { proxied: true });
          if (dns.result) dns.result.proxied = true;
          // Keep ProxyHost.cloudflareProxied (the source for the "DNS only"
          // vs proxied badge in the UI) in sync with the record we just
          // flipped — only touches hosts whose DNS Cloudflare actually
          // manages, same guard as setCloudflareProxied/syncCloudflareRecords.
          await prisma.proxyHost.updateMany({
            where: { domain: data.domain, cloudflareRecordId: { not: null } },
            data: { cloudflareProxied: true },
          });
        }
      } catch (e) {
        console.error(`Cloudflare proxy-after-ssl flip failed for ${data.domain}:`, e instanceof Error ? e.message : String(e));
      }
    }

    return { certificate: updated, output, dnsRecord: dns.result };
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

    await reloadNginx();

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
      // renewCertificate returns an ExecResult with a nonzero exitCode on
      // failure — it does not throw. Checking the exit code explicitly
      // (rather than assuming success once the await resolves) is required
      // here, otherwise a failed renewal is recorded as successful.
      const result = await renewCertificate(cert.domain);
      if (result.exitCode !== 0) {
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        throw new Error(output || `acme.sh exited with code ${result.exitCode}`);
      }

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

      await reloadNginx();

      // userId: null — this is the cron path, not a logged-in admin. The
      // activity UI already renders a null user as "system".
      await prisma.auditLog.create({
        data: { userId: null, action: "RENEW_CERT", entity: "Certificate", entityId: cert.id, details: JSON.stringify({ domain: cert.domain }) },
      });
    } catch (e) {
      await prisma.certificate.update({
        where: { id: cert.id },
        data: { renewError: String(e).slice(0, 1000) },
      });
      await prisma.auditLog.create({
        data: {
          userId: null,
          action: "RENEW_CERT",
          entity: "Certificate",
          entityId: cert.id,
          details: JSON.stringify({ domain: cert.domain, error: String(e).slice(0, 500) }),
        },
      });
      void fireNotification({
        type: "cert_renewal_failed",
        title: `Certificate renewal failed: ${cert.domain}`,
        body: `Automatic renewal of the certificate for ${cert.domain} failed.\nError: ${String(e)}`,
      });
    }
  }

  // Alert on certs expiring within 14 days that are not auto-renewing
  const soonExpiring = await prisma.certificate.findMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lte: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) },
    },
  });
  for (const cert of soonExpiring) {
    const daysLeft = cert.expiresAt
      ? Math.ceil((cert.expiresAt.getTime() - Date.now()) / 86_400_000)
      : 0;
    void fireNotification({
      type: "cert_expiring",
      title: `Certificate expiring soon: ${cert.domain}`,
      body: `The certificate for ${cert.domain} expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}.`,
    });
  }
}
