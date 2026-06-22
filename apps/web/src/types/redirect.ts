import type { RedirectHost, Certificate } from "@prisma/client";

export interface RedirectHostFormData {
  sourceDomain: string;
  destination: string;
  redirectCode: 301 | 302;
  preservePath: boolean;
  sslEnabled: boolean;
  certificateId?: string;
}

export interface RedirectHostWithCert extends RedirectHost {
  certificate: Certificate | null;
}
