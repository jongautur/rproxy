import { writeFile, mkdir, unlink, chmod, access } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { safeExec } from "@/server/system/exec";
import {
  generateDefaultServerConfig,
  DEFAULT_PAGE_FILENAME,
  DEFAULT_PAGE_HTML_FILE,
  NGINX_WELCOME_FILE,
  NGINX_WELCOME_HTML,
  DEFAULT_CERT_DIR,
  DEFAULT_CERT_FILE,
  DEFAULT_KEY_FILE,
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

// TLS needs *some* certificate to present during the handshake before nginx
// can evaluate SNI/Host routing — a self-signed one is fine here since its
// only job is to let the default_server catch-all exist at all. Real sites
// each carry their own real certificate; this one is never meant to be
// trusted by a browser, only to stop unmatched HTTPS requests from falling
// through to an unrelated site's backend. Idempotent — skipped once
// generated once.
async function ensureDefaultCert(): Promise<boolean> {
  try {
    await access(DEFAULT_CERT_FILE);
    return true;
  } catch {
    // Doesn't exist yet — generate below.
  }

  await mkdir(DEFAULT_CERT_DIR, { recursive: true });
  await chmod(DEFAULT_CERT_DIR, 0o755).catch(() => {});

  const result = await safeExec("/usr/bin/openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-days", "3650", "-nodes",
    "-keyout", DEFAULT_KEY_FILE,
    "-out", DEFAULT_CERT_FILE,
    "-subj", "/CN=rproxy-default",
  ]);
  if (result.exitCode !== 0) {
    console.error("[default-page] failed to generate self-signed default cert:", result.stderr);
    return false;
  }

  await chmod(DEFAULT_CERT_FILE, 0o644).catch(() => {});
  await chmod(DEFAULT_KEY_FILE, 0o600).catch(() => {});
  return true;
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

  const hasCert = await ensureDefaultCert();
  const config = generateDefaultServerConfig({ mode: resolvedMode, redirectUrl, hasCert });
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
