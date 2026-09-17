import { Resolver } from "dns";
import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "@/lib/encrypt";

// Public resolvers, not the OS resolver — a local resolver may have a stale
// cached answer for a domain that was just repointed, which would report
// "not propagated" long after the change is actually live.
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "1.0.0.1"];

const API_BASE = "https://api.cloudflare.com/client/v4";

export interface CloudflareIntegrationConfig {
  apiToken: string;
  ddnsEnabled: boolean;
  autoDnsEnabled: boolean;
  defaultProxied: boolean;
  proxyAfterSsl: boolean;
  deleteDnsWithHost: boolean;
  lastPublicIp: string | null;
}

export interface CloudflareZone {
  id: string;
  name: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: { message: string }[];
  result: T;
  result_info?: { page: number; total_pages: number };
}

async function cfFetch<T>(path: string, token: string, init?: RequestInit): Promise<CloudflareApiResponse<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });

  const body = await res.json() as CloudflareApiResponse<T>;
  if (!res.ok || !body.success) {
    const message = body.errors?.[0]?.message ?? `Cloudflare API returned ${res.status}`;
    throw new Error(message);
  }
  return body;
}

export async function getIntegration(): Promise<CloudflareIntegrationConfig | null> {
  const row = await prisma.cloudflareIntegration.findUnique({ where: { id: "singleton" } });
  if (!row) return null;
  const { apiToken } = decryptJson(row.apiTokenEncrypted) as { apiToken: string };
  return {
    apiToken,
    ddnsEnabled: row.ddnsEnabled,
    autoDnsEnabled: row.autoDnsEnabled,
    defaultProxied: row.defaultProxied,
    proxyAfterSsl: row.proxyAfterSsl,
    deleteDnsWithHost: row.deleteDnsWithHost,
    lastPublicIp: row.lastPublicIp,
  };
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const result = await cfFetch<{ status: string }>("/user/tokens/verify", token);
    return result.result.status === "active";
  } catch {
    return false;
  }
}

export async function listZones(token: string): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  let page = 1;
  for (;;) {
    const body = await cfFetch<CloudflareZone[]>(`/zones?per_page=50&page=${page}`, token);
    zones.push(...body.result.map((z) => ({ id: z.id, name: z.name })));
    const totalPages = body.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return zones;
}

// Walks the domain's labels right-to-left looking for a zone match, e.g.
// "a.b.example.com" tries "example.com", then "b.example.com", ... — this
// lets a token with access to multiple zones resolve any domain without
// the admin having to configure which zone belongs to which domain.
export function matchZoneForDomain(domain: string, zones: CloudflareZone[]): CloudflareZone | null {
  const labels = domain.split(".");
  for (let i = labels.length - 2; i >= 0; i--) {
    const candidate = labels.slice(i).join(".");
    const zone = zones.find((z) => z.name === candidate);
    if (zone) return zone;
  }
  return null;
}

export async function resolveZoneForDomain(token: string, domain: string): Promise<CloudflareZone | null> {
  const zones = await listZones(token);
  return matchZoneForDomain(domain, zones);
}

interface CloudflareDnsRecord {
  id: string;
  name: string;
  content: string;
  type: string;
  proxied: boolean;
}

export async function listARecords(token: string, zoneId: string): Promise<CloudflareDnsRecord[]> {
  const records: CloudflareDnsRecord[] = [];
  let page = 1;
  for (;;) {
    const body = await cfFetch<CloudflareDnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=A&per_page=100&page=${page}`,
      token
    );
    records.push(...body.result);
    const totalPages = body.result_info?.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }
  return records;
}

// Pure lookup — never creates or modifies anything, unlike upsertARecord.
// Used to link an already-existing record to a proxy that predates the
// Cloudflare integration, without touching its current DNS state.
export async function findARecord(token: string, zoneId: string, recordName: string): Promise<{ id: string; proxied: boolean } | null> {
  const body = await cfFetch<CloudflareDnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(recordName)}`,
    token
  );
  const record = body.result[0];
  return record ? { id: record.id, proxied: record.proxied } : null;
}

export async function upsertARecord(
  token: string,
  zoneId: string,
  recordName: string,
  ip: string,
  opts?: { proxied?: boolean }
): Promise<{ id: string }> {
  const proxied = opts?.proxied ?? false;
  const existing = await cfFetch<CloudflareDnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=A&name=${encodeURIComponent(recordName)}`,
    token
  );

  const payload = { type: "A", name: recordName, content: ip, proxied, ttl: 1 };

  if (existing.result.length > 0) {
    const record = existing.result[0]!;
    const body = await cfFetch<{ id: string }>(`/zones/${zoneId}/dns_records/${record.id}`, token, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return { id: body.result.id };
  }

  const body = await cfFetch<{ id: string }>(`/zones/${zoneId}/dns_records`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { id: body.result.id };
}

export async function deleteARecord(token: string, zoneId: string, recordId: string): Promise<void> {
  await cfFetch<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, token, {
    method: "DELETE",
  });
}

// Partial update of just the proxied flag — doesn't touch the record's
// content (IP), unlike upsertARecord which would need to know/guess it.
export async function setRecordProxied(token: string, zoneId: string, recordId: string, proxied: boolean): Promise<void> {
  await cfFetch<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, token, {
    method: "PATCH",
    body: JSON.stringify({ proxied }),
  });
}

export async function getPublicIp(): Promise<string> {
  const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch public IP: ${res.status}`);
  const text = await res.text();
  const match = /^ip=(.+)$/m.exec(text);
  if (!match?.[1]) throw new Error("Could not parse public IP from trace response");
  return match[1].trim();
}

export async function saveIntegration(opts: {
  apiToken?: string;
  ddnsEnabled?: boolean;
  autoDnsEnabled?: boolean;
  defaultProxied?: boolean;
  proxyAfterSsl?: boolean;
  deleteDnsWithHost?: boolean;
}): Promise<void> {
  const data: {
    apiTokenEncrypted?: string;
    ddnsEnabled?: boolean;
    autoDnsEnabled?: boolean;
    defaultProxied?: boolean;
    proxyAfterSsl?: boolean;
    deleteDnsWithHost?: boolean;
  } = {};
  if (opts.apiToken !== undefined) data.apiTokenEncrypted = encryptJson({ apiToken: opts.apiToken });
  if (opts.ddnsEnabled !== undefined) data.ddnsEnabled = opts.ddnsEnabled;
  if (opts.autoDnsEnabled !== undefined) data.autoDnsEnabled = opts.autoDnsEnabled;
  if (opts.defaultProxied !== undefined) data.defaultProxied = opts.defaultProxied;
  if (opts.proxyAfterSsl !== undefined) data.proxyAfterSsl = opts.proxyAfterSsl;
  if (opts.deleteDnsWithHost !== undefined) data.deleteDnsWithHost = opts.deleteDnsWithHost;

  await prisma.cloudflareIntegration.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      apiTokenEncrypted: data.apiTokenEncrypted ?? encryptJson({ apiToken: opts.apiToken ?? "" }),
      ddnsEnabled: data.ddnsEnabled ?? false,
      autoDnsEnabled: data.autoDnsEnabled ?? false,
      defaultProxied: data.defaultProxied ?? false,
      proxyAfterSsl: data.proxyAfterSsl ?? false,
      deleteDnsWithHost: data.deleteDnsWithHost ?? false,
    },
    update: data,
  });
}

// Polls a public resolver (not the OS resolver — see PUBLIC_DNS_SERVERS)
// every `intervalMs` until `expectedIp` shows up in the A records or
// `timeoutMs` elapses. Never throws — a timeout just means "not yet",
// which callers treat as non-fatal.
export async function waitForDnsPropagation(
  domain: string,
  expectedIp: string,
  opts?: { intervalMs?: number; timeoutMs?: number }
): Promise<boolean> {
  const intervalMs = opts?.intervalMs ?? 10_000;
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const resolver = new Resolver();
  resolver.setServers(PUBLIC_DNS_SERVERS);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const addresses = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve4(domain, (err, addrs) => (err ? reject(err) : resolve(addrs)));
      });
      if (addresses.includes(expectedIp)) return true;
    } catch {
      // NXDOMAIN or resolver error — treat as "not propagated yet" and keep polling.
    }

    if (Date.now() + intervalMs > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function deleteIntegration(): Promise<void> {
  await prisma.cloudflareIntegration.deleteMany({ where: { id: "singleton" } });
}
