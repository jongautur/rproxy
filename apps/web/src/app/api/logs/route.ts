import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { readFile } from "fs/promises";
import { stat } from "fs/promises";
import path from "path";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";

const LOG_DIR = "/var/log/nginx";
const ALLOWED_LOG_PATTERN = /^[a-zA-Z0-9_.-]+(\.access|\.error)\.log$/;
const MAX_LINES = 500;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

async function tailFile(filePath: string, lines: number): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  const allLines = content.split("\n").filter(Boolean);
  return allLines.slice(-lines).join("\n");
}

export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const fileParam = searchParams.get("file");
    const linesParam = searchParams.get("lines");
    const lines = Math.min(MAX_LINES, Math.max(1, parseInt(linesParam ?? "100", 10)));

    if (!fileParam) {
      // List available log files
      try {
        const { readdirSync } = await import("fs");
        const files = readdirSync(LOG_DIR)
          .filter((f) => ALLOWED_LOG_PATTERN.test(f))
          .map((f) => ({
            name: f,
            path: path.join(LOG_DIR, f),
          }));
        return ok({ files });
      } catch {
        return ok({ files: [] });
      }
    }

    const safeName = sanitizeFilename(fileParam);
    if (!ALLOWED_LOG_PATTERN.test(safeName)) {
      return badRequest("Invalid log filename");
    }

    const filePath = path.join(LOG_DIR, safeName);

    // Ensure resolved path is within LOG_DIR
    if (!filePath.startsWith(LOG_DIR + "/")) {
      return badRequest("Invalid log path");
    }

    try {
      await stat(filePath);
    } catch {
      return notFound("Log file not found");
    }

    const content = await tailFile(filePath, lines);
    return ok({ file: safeName, content, lines });
  } catch (e) {
    return fromError(e);
  }
}
