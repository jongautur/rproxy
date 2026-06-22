import { requireSession } from "@/lib/auth";
import { fromError } from "@/lib/api-response";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

function parseDatabaseUrl(url: string): {
  host: string; port: string; user: string; password: string; dbname: string;
} | null {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port || "5432",
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      dbname:   u.pathname.slice(1),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") {
      return new Response(JSON.stringify({ error: "Admin only" }), { status: 403 });
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return new Response(JSON.stringify({ error: "DATABASE_URL not set" }), { status: 500 });
    }

    const conn = parseDatabaseUrl(databaseUrl);
    if (!conn) {
      return new Response(JSON.stringify({ error: "Could not parse DATABASE_URL" }), { status: 500 });
    }

    // Validate connection params — no shell metacharacters
    const SAFE = /^[a-zA-Z0-9._-]+$/;
    if (!SAFE.test(conn.host) || !SAFE.test(conn.port) || !SAFE.test(conn.user) || !SAFE.test(conn.dbname)) {
      return new Response(JSON.stringify({ error: "Database connection params contain unsafe characters" }), { status: 500 });
    }

    const filename = `rproxy-backup-${new Date().toISOString().slice(0, 10)}.sql`;

    // Stream pg_dump output directly to response
    const stream = new ReadableStream({
      start(controller) {
        const proc = spawn("/usr/bin/pg_dump", [
          "-h", conn!.host,
          "-p", conn!.port,
          "-U", conn!.user,
          "-d", conn!.dbname,
          "--no-password",
          "--clean",
          "--if-exists",
        ], {
          shell: false,
          env: { ...process.env, PGPASSWORD: conn!.password },
        });

        proc.stdout.on("data", (chunk: Buffer) => {
          try { controller.enqueue(chunk); } catch { proc.kill(); }
        });

        proc.stderr.on("data", (chunk: Buffer) => {
          const msg = chunk.toString();
          // pg_dump writes non-fatal notices to stderr — only fatal if process exits non-zero
          if (msg.toLowerCase().includes("error") || msg.toLowerCase().includes("fatal")) {
            console.error("[backup] pg_dump stderr:", msg);
          }
        });

        proc.on("close", (code) => {
          if (code !== 0) {
            controller.error(new Error(`pg_dump exited with code ${code}`));
          } else {
            controller.close();
          }
        });

        proc.on("error", (err) => controller.error(err));
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fromError(e);
  }
}
