"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckCircle2, XCircle, Timer, Loader2, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface AnalyticsData {
  days: number;
  totals: { allowed: number; denied: number; throttled: number };
  byApi: { apiId: string; name: string; domain: string; allowed: number; denied: number; throttled: number }[];
  byCustomer: { customerId: string; name: string; allowed: number; denied: number; throttled: number }[];
  quotaUtilization: { customerName: string; apiName: string; apiDomain: string; dailyQuota: number | null; usedToday: number; monthlyQuota: number | null }[];
}

function StatTile({ label, value, icon: Icon, iconClass }: { label: string; value: number; icon: React.ElementType; iconClass: string }) {
  return (
    <Card>
      <CardContent className="p-6 flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
        </div>
        <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", iconClass)}>
          <Icon className="w-5 h-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">No gateway traffic yet</p>
      <p className="text-muted-foreground text-sm mt-1">
        Usage appears here a few minutes after requests start flowing through a protected API.
      </p>
    </div>
  );
}

export function AnalyticsPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("7");

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/analytics?days=${days}`);
      const json = (await res.json()) as { success: boolean; data: AnalyticsData };
      if (json.success) setData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load analytics" });
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalRequests = (data?.totals.allowed ?? 0) + (data?.totals.denied ?? 0) + (data?.totals.throttled ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {totalRequests === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label="Allowed requests" value={data!.totals.allowed} icon={CheckCircle2} iconClass="bg-success/10 text-success" />
            <StatTile label="Denied (auth/access)" value={data!.totals.denied} icon={XCircle} iconClass="bg-destructive/10 text-destructive" />
            <StatTile label="Throttled (rate/quota)" value={data!.totals.throttled} icon={Timer} iconClass="bg-warning/10 text-warning" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-0">
                <p className="text-sm font-medium px-6 pt-4 pb-2">Requests by API</p>
                <table className="w-full text-sm">
                  <tbody>
                    {data!.byApi.length === 0 && (
                      <tr><td className="px-6 py-4 text-muted-foreground text-center" colSpan={2}>No data yet</td></tr>
                    )}
                    {data!.byApi.map((a) => (
                      <tr key={a.apiId} className="border-t border-border/50">
                        <td className="px-6 py-3">
                          <p className="font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{a.domain}</p>
                        </td>
                        <td className="px-6 py-3 text-right text-muted-foreground">
                          {a.allowed.toLocaleString()} allowed
                          {a.throttled > 0 && <span className="text-warning ml-2">· {a.throttled} throttled</span>}
                          {a.denied > 0 && <span className="text-destructive ml-2">· {a.denied} denied</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <p className="text-sm font-medium px-6 pt-4 pb-2">Top customers by usage</p>
                <table className="w-full text-sm">
                  <tbody>
                    {data!.byCustomer.length === 0 && (
                      <tr><td className="px-6 py-4 text-muted-foreground text-center" colSpan={2}>No data yet</td></tr>
                    )}
                    {data!.byCustomer.map((c) => (
                      <tr key={c.customerId} className="border-t border-border/50">
                        <td className="px-6 py-3 font-medium">{c.name}</td>
                        <td className="px-6 py-3 text-right text-muted-foreground">
                          {c.allowed.toLocaleString()} allowed
                          {c.throttled > 0 && <span className="text-warning ml-2">· {c.throttled} throttled</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>

          {data!.quotaUtilization.length > 0 && (
            <Card>
              <CardContent className="p-6 space-y-4">
                <p className="text-sm font-medium">Daily quota utilization</p>
                {data!.quotaUtilization.map((q, i) => {
                  const pct = q.dailyQuota ? Math.min(100, Math.round((q.usedToday / q.dailyQuota) * 100)) : null;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{q.customerName} → {q.apiName}</span>
                        <span className="text-muted-foreground">
                          {q.dailyQuota ? `${q.usedToday.toLocaleString()} / ${q.dailyQuota.toLocaleString()} today` : "No daily quota"}
                        </span>
                      </div>
                      {pct !== null && <Progress value={pct} className={cn(pct >= 90 && "[&>div]:bg-destructive")} />}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
