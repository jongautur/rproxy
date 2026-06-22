"use client";

import { useState, useEffect, useCallback } from "react";
import { Activity, Search, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { formatRelativeTime } from "@/lib/utils";
import type { AuditLog, User } from "@prisma/client";

type LogWithUser = AuditLog & { user: Pick<User, "username"> | null };

interface Paginated {
  items: LogWithUser[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

const ACTION_VARIANTS: Record<string, "success" | "destructive" | "info" | "warning" | "secondary"> = {
  CREATE:       "success",
  UPDATE:       "info",
  DELETE:       "destructive",
  ENABLE:       "success",
  DISABLE:      "warning",
  RELOAD_NGINX: "info",
  ISSUE_CERT:   "success",
  RENEW_CERT:   "success",
  REVOKE_CERT:  "warning",
  LOGIN:        "info",
  LOGOUT:       "secondary",
};

const ALL_ACTIONS = [
  "CREATE","UPDATE","DELETE","ENABLE","DISABLE",
  "RELOAD_NGINX","ISSUE_CERT","RENEW_CERT","REVOKE_CERT","LOGIN","LOGOUT",
];

export function ActivityClient() {
  const { toast } = useToast();
  const [data, setData] = useState<Paginated | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        perPage: "25",
        ...(search && { search }),
        ...(actionFilter && actionFilter !== "all" && { action: actionFilter }),
      });
      const res = await fetch(`/api/activity?${params}`);
      const json = await res.json() as { success: boolean; data: Paginated };
      if (json.success) setData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load activity" });
    } finally {
      setLoading(false);
    }
  }, [page, search, actionFilter, toast]);

  useEffect(() => {
    const id = setTimeout(fetchLogs, search ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchLogs, search]);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-primary" />
            Activity Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data ? `${data.total} event${data.total !== 1 ? "s" : ""}` : "Audit trail of all system actions"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search entity, ID, IP…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44">
            <Filter className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {ALL_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
          ) : !data || data.items.length === 0 ? (
            <div className="text-center py-16">
              <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-medium">No activity yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Action</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Entity</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Details</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">User</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">IP</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                      <td className="px-6 py-3">
                        <Badge variant={ACTION_VARIANTS[log.action] ?? "secondary"} className="text-xs whitespace-nowrap">
                          {log.action.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{log.entity}</p>
                        {log.entityId && (
                          <p className="text-xs text-muted-foreground font-mono">
                            {log.entityId.length > 12 ? `${log.entityId.slice(0, 12)}…` : log.entityId}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                        {log.details ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {log.user?.username ?? <span className="italic">system</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                        {log.ipAddress ?? "—"}
                      </td>
                      <td className="px-6 py-3 text-right text-muted-foreground text-xs whitespace-nowrap">
                        {formatRelativeTime(log.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * data.perPage + 1}–{Math.min(page * data.perPage, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">{page} / {data.totalPages}</span>
                <Button variant="outline" size="icon-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
