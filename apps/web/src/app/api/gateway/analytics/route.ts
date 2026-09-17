import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, fromError } from "@/lib/api-response";
import { UNAUTHENTICATED_CUSTOMER_ID } from "@/server/services/api-gateway/gateway-auth.service";

// Scoped to what the gateway itself observes — allowed/denied/throttled
// counts and quota utilization — not real backend response status/latency,
// which auth_request has no visibility into (it runs before proxy_pass).
// See the API Gateway plan's Correction 7. Real status/latency would need a
// second data source (nginx access-log parsing on the Gateway's own sites,
// same mechanism as TrafficStat/log-parser.ts) — a natural V2 addition, not
// attempted here.
export async function GET(req: NextRequest) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "7", 10)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);

    const [totals, byApiRaw, byRouteRaw, byCustomerRaw, unauthTotals, grants] = await Promise.all([
      prisma.apiUsage.aggregate({
        where: { hour: { gte: since } },
        _sum: { allowed: true, denied: true, throttled: true },
      }),
      prisma.apiUsage.groupBy({
        by: ["apiId"],
        where: { hour: { gte: since } },
        _sum: { allowed: true, denied: true, throttled: true },
      }),
      prisma.apiUsage.groupBy({
        by: ["apiId", "routeId"],
        where: { hour: { gte: since } },
        _sum: { allowed: true, denied: true, throttled: true },
      }),
      // Excludes UNAUTHENTICATED_CUSTOMER_ID — that sentinel isn't a real
      // customer (see its definition in gateway-auth.service.ts), it just
      // makes no-key/invalid-key denials visible in totals/byApi instead of
      // being silently uncounted; it has no business in a "top customers"
      // ranking.
      prisma.apiUsage.groupBy({
        by: ["customerId"],
        where: { hour: { gte: since }, customerId: { not: UNAUTHENTICATED_CUSTOMER_ID } },
        _sum: { allowed: true, denied: true, throttled: true },
        orderBy: { _sum: { allowed: "desc" } },
        take: 10,
      }),
      prisma.apiUsage.aggregate({
        where: { hour: { gte: since }, customerId: UNAUTHENTICATED_CUSTOMER_ID },
        _sum: { denied: true },
      }),
      prisma.apiAccess.findMany({
        where: { OR: [{ dailyQuota: { not: null } }, { monthlyQuota: { not: null } }] },
        include: { api: { select: { name: true, domain: true } }, customer: { select: { name: true } } },
      }),
    ]);

    const [apis, routes, customers] = await Promise.all([
      prisma.api.findMany({ where: { id: { in: byApiRaw.map((r) => r.apiId) } }, select: { id: true, name: true, domain: true } }),
      prisma.apiRoute.findMany({ where: { id: { in: byRouteRaw.map((r) => r.routeId).filter((id): id is string => !!id) } }, select: { id: true, path: true, methods: true } }),
      prisma.customer.findMany({ where: { id: { in: byCustomerRaw.map((r) => r.customerId) } }, select: { id: true, name: true } }),
    ]);
    const apiById = new Map(apis.map((a) => [a.id, a]));
    const routeById = new Map(routes.map((r) => [r.id, r]));
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const byApi = byApiRaw.map((r) => ({
      apiId: r.apiId,
      name: apiById.get(r.apiId)?.name ?? "(deleted API)",
      domain: apiById.get(r.apiId)?.domain ?? "",
      allowed: r._sum.allowed ?? 0,
      denied: r._sum.denied ?? 0,
      throttled: r._sum.throttled ?? 0,
    }));

    const byRoute = byRouteRaw
      .map((r) => ({
        apiId: r.apiId,
        routeId: r.routeId,
        apiName: apiById.get(r.apiId)?.name ?? "(deleted API)",
        path: r.routeId ? routeById.get(r.routeId)?.path ?? "(deleted route)" : "(deleted route)",
        methods: r.routeId ? routeById.get(r.routeId)?.methods ?? [] : [],
        allowed: r._sum.allowed ?? 0,
        denied: r._sum.denied ?? 0,
        throttled: r._sum.throttled ?? 0,
      }))
      .sort((a, b) => (b.allowed + b.denied + b.throttled) - (a.allowed + a.denied + a.throttled))
      .slice(0, 20);

    const byCustomer = byCustomerRaw.map((r) => ({
      customerId: r.customerId,
      name: customerById.get(r.customerId)?.name ?? "(deleted customer)",
      allowed: r._sum.allowed ?? 0,
      denied: r._sum.denied ?? 0,
      throttled: r._sum.throttled ?? 0,
    }));

    // Approximate, monitoring-only view — sums all of a customer's allowed
    // requests against an Api today, regardless of which specific route(s)
    // contributed. Redis remains the actual source of truth for quota
    // enforcement (see gateway-auth.service.ts); this is a display aid, not
    // a re-implementation of the enforcement logic.
    const quotaUsageRows = await prisma.apiUsage.groupBy({
      by: ["customerId", "apiId"],
      where: { hour: { gte: todayStart } },
      _sum: { allowed: true },
    });
    const usedTodayByCustomerApi = new Map(
      quotaUsageRows.map((r) => [`${r.customerId}:${r.apiId}`, r._sum.allowed ?? 0])
    );

    const quotaUtilization = grants.map((g) => ({
      customerName: g.customer.name,
      apiName: g.api.name,
      apiDomain: g.api.domain,
      dailyQuota: g.dailyQuota,
      usedToday: usedTodayByCustomerApi.get(`${g.customerId}:${g.apiId}`) ?? 0,
      monthlyQuota: g.monthlyQuota,
    }));

    return ok({
      days,
      totals: {
        allowed: totals._sum.allowed ?? 0,
        denied: totals._sum.denied ?? 0,
        throttled: totals._sum.throttled ?? 0,
      },
      // Denials with no attributable customer (no key presented, or a key
      // that matched nothing) — included in `totals.denied` and `byApi`
      // above, broken out here so the UI can label it instead of it just
      // looking like a discrepancy against the customer breakdown's total.
      unauthenticatedDenied: unauthTotals._sum.denied ?? 0,
      byApi,
      byRoute,
      byCustomer,
      quotaUtilization,
    });
  } catch (e) {
    return fromError(e);
  }
}
