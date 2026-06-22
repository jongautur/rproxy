import type { Certificate, ProxyHost, CertProvider, CertStatus, ChallengeType } from "@prisma/client";

export interface CertificateFormData {
  domain: string;
  provider: CertProvider;
  challengeType: ChallengeType;
  email?: string;
  dnsProvider?: string;
  dnsCredentials?: Record<string, string>;
  autoRenew: boolean;
}

export interface CertificateWithHosts extends Certificate {
  proxyHosts: ProxyHost[];
}

export interface IssueCertResponse {
  certificate: Certificate;
  output: string;
}

export interface CertStats {
  total: number;
  active: number;
  expired: number;
  expiringInDays: number; // count expiring within 30 days
}

export type { CertProvider, CertStatus, ChallengeType };
