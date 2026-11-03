import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "@/lib/encrypt";
import { z } from "zod";

export const LOCAL_DNS_KEY = "local_dns_integration";
export const localDnsSchema = z.object({
  serverUrl: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, "Use an HTTP or HTTPS server URL without credentials, query, or fragment"),
  apiToken: z.string().trim().min(1).max(1024),
  targetIp: z.string().ip({ version: "v4" }),
  enabled: z.boolean(),
});
export type LocalDnsConfig = z.infer<typeof localDnsSchema>;

export async function getLocalDns(): Promise<LocalDnsConfig | null> {
  const row = await prisma.setting.findUnique({ where: { key: LOCAL_DNS_KEY } });
  return row ? localDnsSchema.parse(JSON.parse(decryptJson(row.value).config ?? "null")) : null;
}

export async function saveLocalDns(config: LocalDnsConfig): Promise<void> {
  const value = encryptJson({ config: JSON.stringify(localDnsSchema.parse(config)) });
  await prisma.setting.upsert({ where: { key: LOCAL_DNS_KEY }, create: { key: LOCAL_DNS_KEY, value }, update: { value } });
}

export async function technitiumRequest(config: LocalDnsConfig, endpoint: string, params: Record<string, string> = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl.replace(/\/$/, "")}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // Form authentication supports both older releases and Technitium 15+.
    body: new URLSearchParams({ ...params, token: config.apiToken }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") throw new Error("rproxy cannot resolve the Technitium hostname. Use its LAN IP and web/API port, or fix DNS resolution on the rproxy server.");
    if (code === "ECONNREFUSED") throw new Error("Technitium refused the connection. Check the web/API port and that the service is listening.");
    throw new Error("Could not reach Technitium. Check the URL, TLS certificate, firewall, and connectivity from the rproxy server.");
  }
  let body: { status?: string };
  try { body = await res.json() as { status?: string }; }
  catch { throw new Error("The server did not return Technitium API JSON. Use the web/API URL, including its port, rather than a DNS resolver endpoint."); }
  // Do not expose upstream error text: it may contain the submitted token.
  if (!res.ok || body.status !== "ok") throw new Error(`Technitium request failed (${body.status === "invalid-token" ? "invalid token" : res.status}). Check the server URL, zone, and token permissions.`);
}

export async function createLocalDnsRecord(domain: string): Promise<{ created: boolean; error?: string } | undefined> {
  try {
    const config = await getLocalDns();
    if (!config?.enabled) return undefined;
    await technitiumRequest(config, "zones/records/add", {
      domain, type: "A", ipAddress: config.targetIp, ttl: "300", overwrite: "true", comments: "Managed by rproxy",
    });
    return { created: true };
  } catch {
    return { created: false, error: "Local DNS update failed. Check the Technitium connection, matching zone, and token permissions, then retry using Sync existing hosts in Settings → Local DNS." };
  }
}

export async function syncLocalDns() {
  const config = await getLocalDns();
  if (!config?.enabled) throw new Error("Enable local DNS before syncing hosts");
  const hosts = await prisma.proxyHost.findMany({ select: { domain: true } });
  const errors: string[] = [];
  let synced = 0;
  for (const host of hosts) {
    const result = await createLocalDnsRecord(host.domain);
    if (result?.created) synced++;
    else errors.push(host.domain);
  }
  return { synced, errors };
}
