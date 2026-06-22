import type { ProxyHost, Certificate, ProxyStatus } from "@prisma/client";

export interface ProxyHostFormData {
  domain: string;
  forwardScheme: "http" | "https" | "grpc" | "grpcs";
  forwardHost: string;
  forwardPort: number;
  listenPort: number;
  httpsPort: number;
  sslEnabled: boolean;
  forceHttps: boolean;
  http2: boolean;
  websocket: boolean;
  accessLog: boolean;
  errorLog: boolean;
  customLocations?: string;
  customServer?: string;
  customHeaders?: Record<string, string>;
  certificateId?: string;
  accessListId?: string | null;
}

export interface ProxyHostWithCert extends ProxyHost {
  certificate: Certificate | null;
  _count?: { healthChecks: number };
  latestHealth?: {
    status: string;
    responseTime: number | null;
    checkedAt: Date;
  } | null;
}

export interface CreateProxyResponse {
  proxyHost: ProxyHost;
  nginxTest: { success: boolean; output: string };
}

export interface ProxyStats {
  total: number;
  active: number;
  disabled: number;
  error: number;
  sslEnabled: number;
}

export type { ProxyStatus };
