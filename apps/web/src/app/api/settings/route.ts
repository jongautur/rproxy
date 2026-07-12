import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, forbidden, fromError } from "@/lib/api-response";
import { applyDefaultPageSettings, applyCustom403Settings } from "@/server/services/default-page.service";
import { z } from "zod";

// HTML/URL settings need far more room than the small operational flags
// below (app_title, log_max_gb, etc.) — capped at 200KB, which is already
// generous for a static error/default page and still far short of
// anything that would strain nginx serving it as a static file.
const updateSchema = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/),
  value: z.string().max(200_000),
});

const ALLOWED_SETTING_KEYS = new Set([
  "app_title",
  "health_check_interval",
  "auto_renew_enabled",
  "log_max_gb",
  "default_page_mode",
  "default_page_redirect_url",
  "default_page_html",
  "error_403_html",
]);

const DEFAULT_PAGE_MODES = new Set(["nginx_default", "redirect", "custom_html", "no_response"]);

function validateSettingValue(key: string, value: string): string | null {
  if (key === "default_page_mode" && !DEFAULT_PAGE_MODES.has(value)) {
    return `Mode must be one of: ${[...DEFAULT_PAGE_MODES].join(", ")}`;
  }
  if (key === "default_page_redirect_url" && value) {
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return "Redirect URL must be http:// or https://";
      }
    } catch {
      return "Redirect URL must be a valid absolute URL";
    }
  }
  return null;
}

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const [users, settings] = await Promise.all([
      prisma.user.findMany({
        select: { id: true, username: true, email: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.setting.findMany({ orderBy: { key: "asc" } }),
    ]);

    return ok({ users, settings });
  } catch (e) {
    return fromError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") return forbidden("Admin only");

    const body = await req.json() as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return ok({ error: parsed.error.message }, 400);

    const { key, value } = parsed.data;
    if (!ALLOWED_SETTING_KEYS.has(key)) return ok({ error: "Unknown setting key" }, 400);

    const validationError = validateSettingValue(key, value);
    if (validationError) return badRequest(validationError);

    const setting = await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

    // These settings are baked into deployed nginx config (the default_server
    // catch-all, or every proxy host's error_page) — saving the row alone
    // wouldn't change anything live, so redeploy whatever it affects.
    let deploy = undefined;
    if (key.startsWith("default_page_")) {
      deploy = await applyDefaultPageSettings();
    } else if (key === "error_403_html") {
      await applyCustom403Settings();
    }

    return ok({ setting, deploy });
  } catch (e) {
    return fromError(e);
  }
}
