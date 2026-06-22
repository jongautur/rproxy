import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { open, stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const LOG_DIR = "/var/log/nginx";
const ALLOWED_LOG_PATTERN = /^[a-zA-Z0-9_.-]+(\.access|\.error)\.log$/;
const INITIAL_LINES = 200;
const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15_000;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

async function readLastBytes(filePath: string, fromByte: number, toByte: number): Promise<string> {
  const length = toByte - fromByte;
  if (length <= 0) return "";
  const fd = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    await fd.read(buf, 0, length, fromByte);
    return buf.toString("utf-8");
  } finally {
    await fd.close();
  }
}

async function readLastLines(filePath: string, maxLines: number): Promise<string[]> {
  const fileSize = (await stat(filePath)).size;
  // Read up to 256KB from the end — enough for 200 lines
  const chunkSize = Math.min(fileSize, 256 * 1024);
  const startByte = fileSize - chunkSize;
  const raw = await readLastBytes(filePath, startByte, fileSize);
  const lines = raw.split("\n").filter(Boolean);
  return lines.slice(-maxLines);
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fileParam = searchParams.get("file");

  if (!fileParam) {
    return new Response("Missing file param", { status: 400 });
  }

  const safeName = sanitizeFilename(fileParam);
  if (!ALLOWED_LOG_PATTERN.test(safeName)) {
    return new Response("Invalid log filename", { status: 400 });
  }

  const filePath = path.join(LOG_DIR, safeName);
  if (!filePath.startsWith(LOG_DIR + "/")) {
    return new Response("Invalid log path", { status: 400 });
  }

  try {
    await stat(filePath);
  } catch {
    return new Response("Log file not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          closed = true;
        }
      }

      req.signal.addEventListener("abort", () => {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      });

      // Send initial tail lines
      try {
        const lines = await readLastLines(filePath, INITIAL_LINES);
        send("init", { lines });
      } catch (e) {
        send("error", { message: String(e) });
        controller.close();
        return;
      }

      // Track file position for new-content polling
      let pos = (await stat(filePath)).size;
      let lastHeartbeat = Date.now();

      while (!closed) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (closed) break;

        try {
          const stats = await stat(filePath).catch(() => null);
          if (!stats) {
            send("heartbeat", { ts: Date.now() });
            continue;
          }

          // File was rotated (new file is smaller)
          if (stats.size < pos) {
            pos = 0;
            send("rotate", {});
          }

          if (stats.size > pos) {
            const raw = await readLastBytes(filePath, pos, stats.size);
            pos = stats.size;
            const newLines = raw.split("\n").filter(Boolean);
            if (newLines.length > 0) {
              send("lines", { lines: newLines });
            }
          } else if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            send("heartbeat", { ts: Date.now() });
            lastHeartbeat = Date.now();
          }
        } catch {
          // File may have been deleted/rotated — keep retrying
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}
