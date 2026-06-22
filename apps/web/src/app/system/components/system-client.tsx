"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Server, Cpu, HardDrive, MemoryStick, Activity, RefreshCw,
  CheckCircle2, XCircle, Loader2, Play, Square, RotateCcw,
  Clock, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { formatBytes, formatUptime, formatRelativeTime } from "@/lib/utils";
import type { SystemInfo, NginxStatus } from "@/types/system";

interface SystemData {
  system: SystemInfo;
  nginx: NginxStatus;
}

function MetricBar({
  value,
  max = 100,
  className,
}: { value: number; max?: number; className?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  const color =
    pct > 90 ? "bg-red-500" :
    pct > 75 ? "bg-yellow-500" :
    "bg-primary";

  return (
    <div className={`h-2 rounded-full bg-muted overflow-hidden ${className ?? ""}`}>
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function StatCard({
  title, icon: Icon, value, sub, detail, bar, barMax,
}: {
  title: string;
  icon: React.ElementType;
  value: string;
  sub?: string;
  detail?: string;
  bar?: number;
  barMax?: number;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between mb-3">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        {bar !== undefined && (
          <MetricBar value={bar} max={barMax} className="mt-3" />
        )}
        {detail && <p className="text-xs text-muted-foreground mt-2">{detail}</p>}
      </CardContent>
    </Card>
  );
}

export function SystemClient() {
  const { toast } = useToast();
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [nginxLoading, setNginxLoading] = useState(false);
  const [testOutput, setTestOutput] = useState<{ success: boolean; output: string } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/system");
      const json = await res.json() as { success: boolean; data: SystemData };
      if (json.success) {
        setData(json.data);
        setLastRefresh(new Date());
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load system info" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Initial load + auto-refresh every 30s
  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  async function nginxAction(action: "reload" | "test") {
    setNginxLoading(true);
    setTestOutput(null);
    try {
      const res = await fetch("/api/system/nginx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json() as { success: boolean; data: { success: boolean; output: string }; error?: string };
      if (action === "test") {
        setTestOutput({ success: json.data?.success ?? false, output: json.data?.output ?? json.error ?? "" });
      } else {
        if (json.data?.success) {
          toast({ title: "Nginx reloaded" });
          fetchData();
        } else {
          toast({ variant: "destructive", title: "Reload failed", description: json.data?.output ?? json.error });
        }
      }
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setNginxLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { system, nginx } = data ?? {};

  return (
    <div className="p-8 space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" />
            System
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {system?.hostname ?? "—"} · refreshed {formatRelativeTime(lastRefresh)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="CPU Usage"
          icon={Cpu}
          value={`${system?.cpu.usage ?? 0}%`}
          sub={`${system?.cpu.cores ?? 0} core${(system?.cpu.cores ?? 0) !== 1 ? "s" : ""}`}
          detail={`Load: ${system?.loadAverage.map((n) => n.toFixed(2)).join(" · ") ?? "—"}`}
          bar={system?.cpu.usage}
        />
        <StatCard
          title="Memory"
          icon={MemoryStick}
          value={system ? formatBytes(system.memory.used) : "—"}
          sub={system ? `of ${formatBytes(system.memory.total)}` : undefined}
          detail={`${system?.memory.usagePercent ?? 0}% used · ${system ? formatBytes(system.memory.free) : "—"} free`}
          bar={system?.memory.usagePercent}
        />
        <StatCard
          title="Disk (/)"
          icon={HardDrive}
          value={system ? formatBytes(system.disk.used) : "—"}
          sub={system ? `of ${formatBytes(system.disk.total)}` : undefined}
          detail={`${system?.disk.usagePercent ?? 0}% used · ${system ? formatBytes(system.disk.free) : "—"} free`}
          bar={system?.disk.usagePercent}
        />
        <StatCard
          title="Uptime"
          icon={Clock}
          value={system ? formatUptime(system.uptime) : "—"}
          sub={`Node ${system?.nodeVersion ?? "—"}`}
          detail={`nginx ${system?.nginxVersion ?? "—"}`}
        />
      </div>

      {/* Load average detail */}
      {system && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" />
              CPU Load Average
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="grid grid-cols-3 gap-6">
              {(["1 min", "5 min", "15 min"] as const).map((label, i) => {
                const val = system.loadAverage[i] ?? 0;
                const cores = system.cpu.cores;
                const pct = Math.min(100, (val / cores) * 100);
                return (
                  <div key={label}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-sm font-bold tabular-nums">{val.toFixed(2)}</span>
                    </div>
                    <MetricBar value={pct} />
                    <p className="text-xs text-muted-foreground mt-1">{pct.toFixed(0)}% of {cores} core{cores !== 1 ? "s" : ""}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nginx control panel */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Nginx
            </CardTitle>
            <div className="flex items-center gap-2">
              {nginx?.running
                ? <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />Running</Badge>
                : <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Stopped</Badge>
              }
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-1">Version</p>
              <p className="font-mono">{system?.nginxVersion ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Active Connections</p>
              <p className="font-mono">{nginx?.activeConnections ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Last Reload</p>
              <p>{nginx?.lastReload ? formatRelativeTime(nginx.lastReload) : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-1">Last Reload Status</p>
              {nginx?.lastReload ? (
                nginx.lastReloadSuccess
                  ? <Badge variant="success" className="text-xs">OK</Badge>
                  : <Badge variant="destructive" className="text-xs">Failed</Badge>
              ) : <span className="text-muted-foreground text-xs">—</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => nginxAction("reload")}
              disabled={nginxLoading || !nginx?.running}
              className="gap-2"
            >
              {nginxLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reload config
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => nginxAction("test")}
              disabled={nginxLoading}
              className="gap-2"
            >
              {nginxLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Test config
            </Button>
          </div>

          {/* Test output */}
          {testOutput && (
            <div className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap
              ${testOutput.success
                ? "bg-green-500/10 border border-green-500/20 text-green-400"
                : "bg-red-500/10 border border-red-500/20 text-red-400"
              }`}
            >
              <div className="flex items-center gap-2 mb-2 font-sans font-medium text-sm">
                {testOutput.success
                  ? <><CheckCircle2 className="w-4 h-4" /> Config OK</>
                  : <><XCircle className="w-4 h-4" /> Config invalid</>
                }
              </div>
              {testOutput.output}
            </div>
          )}

          {/* Last reload output */}
          {nginx?.lastReloadOutput && !testOutput && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer select-none">Last reload output</summary>
              <pre className="mt-2 p-2 bg-muted rounded font-mono text-xs whitespace-pre-wrap">
                {nginx.lastReloadOutput}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
