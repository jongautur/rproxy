import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, fromError } from "@/lib/api-response";

export async function GET() {
  try {
    await requireSession();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const stats = await prisma.trafficStat.groupBy({
      by: ["proxyHostId"],
      where: { hour: { gte: since } },
      _sum: { requests: true, errors: true },
    });

    // BigInt bytes need raw query for sum
    const bytesResult = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(bytes), 0) AS total
      FROM traffic_stats
      WHERE hour >= ${since}
    `;

    const totalRequests = stats.reduce((acc, s) => acc + (s._sum.requests ?? 0), 0);
    const totalErrors = stats.reduce((acc, s) => acc + (s._sum.errors ?? 0), 0);
    const totalBytes = Number(bytesResult[0]?.total ?? 0n);

    // Top 5 hosts by requests
    const topHosts = await prisma.trafficStat.groupBy({
      by: ["proxyHostId"],
      where: { hour: { gte: since } },
      _sum: { requests: true },
      orderBy: { _sum: { requests: "desc" } },
      take: 5,
    });

    const hostIds = topHosts.map((h) => h.proxyHostId);
    const hosts = await prisma.proxyHost.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, domain: true },
    });
    const hostMap = Object.fromEntries(hosts.map((h) => [h.id, h.domain]));

    return ok({
      window: "24h",
      totalRequests,
      totalErrors,
      totalBytes,
      errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 100) : 0,
      topHosts: topHosts.map((h) => ({
        proxyHostId: h.proxyHostId,
        domain: hostMap[h.proxyHostId] ?? "unknown",
        requests: h._sum.requests ?? 0,
      })),
    });
  } catch (e) {
    return fromError(e);
  }
}
