import { prisma } from "@/lib/prisma";
import { deployConfDConfig, removeConfDConfig, type DeployResult } from "@/server/services/nginx-deploy.service";
import {
  generateRealIpConfig,
  parseCidrList,
  type RealIpSource,
  type RealIpHeader,
} from "@/server/config-generator/real-ip-config";

const REAL_IP_CONF_FILENAME = "rproxy-real-ip.conf";

async function getSettingValue(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? "";
}

// Global — applies to every request nginx handles, not just proxy hosts —
// since $remote_addr is rewritten at the http level before any server block
// runs. Called whenever a real_ip_* setting is saved.
export async function applyRealIpSettings(): Promise<DeployResult> {
  const [enabledRaw, source, header, customCidrsRaw] = await Promise.all([
    getSettingValue("real_ip_enabled"),
    getSettingValue("real_ip_source"),
    getSettingValue("real_ip_header"),
    getSettingValue("real_ip_custom_cidrs"),
  ]);

  const enabled = enabledRaw === "true";

  if (!enabled) {
    return removeConfDConfig(REAL_IP_CONF_FILENAME);
  }

  const config = generateRealIpConfig({
    enabled,
    source: (source || "cloudflare") as RealIpSource,
    header: (header || "cf-connecting-ip") as RealIpHeader,
    customCidrs: parseCidrList(customCidrsRaw),
  });

  return deployConfDConfig(REAL_IP_CONF_FILENAME, config);
}
