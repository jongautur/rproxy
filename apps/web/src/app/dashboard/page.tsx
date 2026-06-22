import { prisma } from "@/lib/prisma";
import { getLatestHealthChecks } from "@/server/services/health.service";
import { requireSession } from "@/lib/auth";
import { DashboardStats } from "./components/dashboard-stats";
import { NginxStatusCard } from "./components/nginx-status-card";
import { RecentActivity } from "./components/recent-activity";
import { ExpiringCerts } from "./components/expiring-certs";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const [proxyStats, certStats, auditLogs, certificates, healthMap] = await Promise.all([
    prisma.proxyHost.groupBy({
      by: ["status", "enabled"],
      _count: { id: true },
    }),
    prisma.certificate.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { username: true } } },
    }),
    prisma.certificate.findMany({
      where: {
        status: "ACTIVE",
        expiresAt: {
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { expiresAt: "asc" },
      take: 5,
    }),
    getLatestHealthChecks(),
  ]);

  const totalProxies = proxyStats.reduce((acc, s) => acc + s._count.id, 0);
  const activeProxies = proxyStats
    .filter((s) => s.status === "ACTIVE" && s.enabled)
    .reduce((acc, s) => acc + s._count.id, 0);
  const disabledProxies = proxyStats
    .filter((s) => !s.enabled)
    .reduce((acc, s) => acc + s._count.id, 0);
  const errorProxies = proxyStats
    .filter((s) => s.status === "ERROR")
    .reduce((acc, s) => acc + s._count.id, 0);
  const downProxies = Object.values(healthMap).filter((h) => h.status === "DOWN").length;

  const totalCerts = certStats.reduce((acc, s) => acc + s._count.id, 0);
  const activeCerts = certStats
    .filter((s) => s.status === "ACTIVE")
    .reduce((acc, s) => acc + s._count.id, 0);
  const expiredCerts = certStats
    .filter((s) => s.status === "EXPIRED")
    .reduce((acc, s) => acc + s._count.id, 0);

  return {
    proxies: { total: totalProxies, active: activeProxies, disabled: disabledProxies, error: errorProxies, down: downProxies },
    certs: { total: totalCerts, active: activeCerts, expired: expiredCerts, expiring: certificates.length },
    auditLogs,
    expiringCerts: certificates,
  };
}

export default async function DashboardPage() {
  await requireSession();
  const data = await getDashboardData();

  return (
    <div className="p-8 space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Overview of your reverse proxy infrastructure
        </p>
      </div>

      <DashboardStats proxies={data.proxies} certs={data.certs} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <NginxStatusCard />
          <RecentActivity logs={data.auditLogs} />
        </div>
        <div>
          <ExpiringCerts certs={data.expiringCerts} />
        </div>
      </div>
    </div>
  );
}
