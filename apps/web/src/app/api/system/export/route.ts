import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    if (session.role !== "ADMIN") {
      return new Response(JSON.stringify({ error: "Admin only" }), { status: 403 });
    }

    const [proxies, certificates, settings] = await Promise.all([
      prisma.proxyHost.findMany({
        orderBy: { domain: "asc" },
        // Exclude internal IDs and timestamps — export only config fields
        select: {
          domain: true, forwardHost: true, forwardPort: true, listenPort: true,
          sslEnabled: true, forceHttps: true, http2: true, websocket: true,
          accessLog: true, errorLog: true, customLocations: true,
          customServer: true, customHeaders: true, enabled: true,
        },
      }),
      prisma.certificate.findMany({
        orderBy: { domain: "asc" },
        select: {
          domain: true, provider: true, challengeType: true,
          certPath: true, keyPath: true, chainPath: true,
          issuer: true, subject: true, sans: true,
          expiresAt: true, issuedAt: true,
          autoRenew: true, dnsProvider: true,
        },
      }),
      prisma.setting.findMany({ orderBy: { key: "asc" } }),
    ]);

    const payload = JSON.stringify({
      version: "1",
      exportedAt: new Date().toISOString(),
      proxies,
      certificates,
      settings,
    }, null, 2);

    return new Response(payload, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="rproxy-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    return fromError(e);
  }
}
