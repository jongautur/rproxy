"use client";

import { useEffect, useState } from "react";
import { TrendingUp, AlertCircle, HardDrive, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface TrafficData {
  totalRequests: number;
  totalErrors: number;
  totalBytes: number;
  errorRate: number;
  topHosts: { proxyHostId: string; domain: string; requests: number }[];
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtNum(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function TrafficStatsCard() {
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json() as Promise<{ success: boolean; data: TrafficData }>)
      .then((j) => { if (j.success) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Traffic — last 24 h
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data || data.totalRequests === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No traffic data yet — logs are parsed every 5 minutes by the cron job.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-bold">{fmtNum(data.totalRequests)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Requests</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold">{fmtBytes(data.totalBytes)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Bandwidth</p>
              </div>
              <div className="text-center">
                <p className={cn("text-2xl font-bold", data.errorRate > 5 ? "text-destructive" : "")}>
                  {data.errorRate}%
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
                  {data.errorRate > 5 && <AlertCircle className="w-3 h-3 text-destructive" />}
                  Error rate
                </p>
              </div>
            </div>

            {/* Top hosts */}
            {data.topHosts.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground font-medium">Top hosts</p>
                {data.topHosts.map((h) => (
                  <div key={h.proxyHostId} className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate max-w-[60%]">{h.domain}</span>
                    <span className="text-muted-foreground">{fmtNum(h.requests)} req</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
