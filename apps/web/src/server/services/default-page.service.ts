import { writeFile, mkdir, unlink, chmod } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  generateDefaultServerConfig,
  DEFAULT_PAGE_FILENAME,
  DEFAULT_PAGE_HTML_FILE,
  NGINX_WELCOME_FILE,
  NGINX_WELCOME_HTML,
  type DefaultPageMode,
} from "@/server/config-generator/default-server-config";
import { CUSTOM_403_FILE, PAGES_DIR } from "@/server/config-generator/nginx-config";
import { deploySiteConfig, type DeployResult } from "@/server/services/nginx-deploy.service";
import { redeployProxy } from "@/server/services/proxy.service";

async function writePage(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await chmod(path.dirname(filePath), 0o755).catch(() => {});
  await writeFile(filePath, content, "utf-8");
  // nginx runs as www-data — these are static pages, not secrets, so
  // world-readable is correct (and required for nginx to serve them).
  await chmod(filePath, 0o644);
}

async function getSettingValue(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? "";
}

export async function applyDefaultPageSettings(): Promise<DeployResult> {
  const [mode, redirectUrl, html] = await Promise.all([
    getSettingValue("default_page_mode"),
    getSettingValue("default_page_redirect_url"),
    getSettingValue("default_page_html"),
  ]);

  const resolvedMode = (mode || "nginx_default") as DefaultPageMode;

  // Always keep the stock welcome page available — cheap, and means
  // switching back to "nginx_default" later never has to write on demand.
  await writePage(NGINX_WELCOME_FILE, NGINX_WELCOME_HTML);

  if (resolvedMode === "custom_html") {
    await writePage(DEFAULT_PAGE_HTML_FILE, html || "<!DOCTYPE html><html><body></body></html>");
  }

  const config = generateDefaultServerConfig({ mode: resolvedMode, redirectUrl });
  return deploySiteConfig({ filename: DEFAULT_PAGE_FILENAME, config, enabled: true });
}

export async function applyCustom403Settings(): Promise<void> {
  const html = await getSettingValue("error_403_html");

  if (html.trim()) {
    await writePage(CUSTOM_403_FILE, html);
  } else {
    await mkdir(PAGES_DIR, { recursive: true });
    await unlink(CUSTOM_403_FILE).catch(() => {});
  }

  // The error_page directive is baked into every proxy host's generated
  // config (see custom403Enabled in nginx-config.ts), so turning the
  // custom 403 on/off or editing its content requires every site to be
  // regenerated and redeployed, not just this setting saved.
  const proxies = await prisma.proxyHost.findMany({ select: { id: true } });
  for (const { id } of proxies) {
    await redeployProxy(id).catch(() => {});
  }
}
