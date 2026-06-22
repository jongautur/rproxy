"use client";

import { useState, useEffect } from "react";
import {
  Globe, Edit2, Trash2, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Lock, Wifi, Loader2, Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { ProxyHostWithCert } from "@/types/proxy";

interface PaginatedProxies {
  items: ProxyHostWithCert[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface Props {
  data: PaginatedProxies | null;
  loading: boolean;
  onEdit: (proxy: ProxyHostWithCert) => void;
  onRefresh: () => void;
  page: number;
  onPageChange: (page: number) => void;
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) return <Badge variant="secondary">Disabled</Badge>;
  if (status === "ACTIVE") return <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
  if (status === "ERROR") return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function EmptyState({ searching }: { searching: boolean }) {
  return (
    <div className="text-center py-16">
      <Globe className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">
        {searching ? "No proxies match your search" : "No proxy hosts yet"}
      </p>
      <p className="text-muted-foreground text-sm mt-1">
        {!searching && "Click \"Add Proxy Host\" to create your first reverse proxy"}
      </p>
    </div>
  );
}

type HealthMap = Record<string, { status: string; responseTime?: number | null }>;

export function ProxyTable({ data, loading, onEdit, onRefresh, page, onPageChange }: Props) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProxyHostWithCert | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [healthMap, setHealthMap] = useState<HealthMap>({});

  // Probe all proxies on mount and after refresh
  useEffect(() => {
    const ids = data?.items.map((p) => p.id) ?? [];
    if (ids.length === 0) return;
    Promise.all(
      ids.map((id) =>
        fetch(`/api/proxies/${id}/health`, { method: "POST" })
          .then((r) => r.json() as Promise<{ success: boolean; data: { status: string; responseTime?: number } }>)
          .then((j) => ({ id, result: j.success ? j.data : null }))
          .catch(() => ({ id, result: null }))
      )
    ).then((results) => {
      setHealthMap(
        Object.fromEntries(
          results.filter((r) => r.result).map((r) => [r.id, r.result!])
        )
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items.map((p) => p.id).join(",")]);

  async function handleProbe(proxy: ProxyHostWithCert) {
    setProbingId(proxy.id);
    try {
      const res = await fetch(`/api/proxies/${proxy.id}/health`, { method: "POST" });
      const json = await res.json() as { success: boolean; data: { status: string; responseTime?: number } };
      if (json.success) {
        setHealthMap((prev) => ({ ...prev, [proxy.id]: json.data }));
        toast({
          title: json.data.status === "UP" ? `${proxy.domain} is UP` : `${proxy.domain} is DOWN`,
          description: json.data.responseTime ? `${json.data.responseTime}ms` : undefined,
          variant: json.data.status === "UP" ? "default" : "destructive",
        });
      }
    } catch {
      toast({ variant: "destructive", title: "Health check failed" });
    } finally {
      setProbingId(null);
    }
  }

  async function handleToggle(proxy: ProxyHostWithCert) {
    setTogglingId(proxy.id);
    try {
      const res = await fetch(`/api/proxies/${proxy.id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !proxy.enabled }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: proxy.enabled ? "Proxy disabled" : "Proxy enabled" });
        onRefresh();
      } else {
        toast({ variant: "destructive", title: "Toggle failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Toggle failed" });
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(proxy: ProxyHostWithCert) {
    setDeletingId(proxy.id);
    try {
      const res = await fetch(`/api/proxies/${proxy.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Proxy deleted", description: proxy.domain });
        onRefresh();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const items = data?.items ?? [];

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <EmptyState searching={false} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Domain</th>
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Forward To</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Port</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Features</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Health</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Enabled</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((proxy) => (
                    <tr
                      key={proxy.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-accent/30 transition-colors",
                        !proxy.enabled && "opacity-60"
                      )}
                    >
                      {/* Domain */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">{proxy.domain}</p>
                            <p className="text-xs text-muted-foreground">:{proxy.listenPort}</p>
                          </div>
                        </div>
                      </td>

                      {/* Forward */}
                      <td className="px-6 py-4 text-muted-foreground">
                        {proxy.forwardHost}
                      </td>

                      {/* Port */}
                      <td className="px-4 py-4 text-muted-foreground">
                        {proxy.forwardPort}
                      </td>

                      {/* Features */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5">
                          {proxy.sslEnabled && (
                            <span title="SSL enabled">
                              <Lock className="w-3.5 h-3.5 text-success" />
                            </span>
                          )}
                          {proxy.websocket && (
                            <span title="WebSocket">
                              <Wifi className="w-3.5 h-3.5 text-primary" />
                            </span>
                          )}
                          {proxy.http2 && (
                            <Badge variant="info" className="text-[10px] px-1.5 py-0">H2</Badge>
                          )}
                          {proxy.forceHttps && (
                            <Badge variant="info" className="text-[10px] px-1.5 py-0">HTTPS</Badge>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <StatusBadge status={proxy.status} enabled={proxy.enabled} />
                      </td>

                      {/* Health */}
                      <td className="px-4 py-4">
                        {healthMap[proxy.id] ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              healthMap[proxy.id]!.status === "UP" ? "bg-green-500" : "bg-red-500"
                            }`} />
                            <span className="text-xs text-muted-foreground">
                              {healthMap[proxy.id]!.status === "UP"
                                ? healthMap[proxy.id]!.responseTime ? `${healthMap[proxy.id]!.responseTime}ms` : "UP"
                                : "DOWN"
                              }
                            </span>
                          </div>
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-muted-foreground/30 block" />
                        )}
                      </td>

                      {/* Toggle */}
                      <td className="px-4 py-4">
                        <Switch
                          checked={proxy.enabled}
                          onCheckedChange={() => handleToggle(proxy)}
                          disabled={togglingId === proxy.id}
                        />
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleProbe(proxy)}
                            disabled={probingId === proxy.id}
                            title="Check health"
                          >
                            {probingId === proxy.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Heart className="w-4 h-4" />
                            }
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onEdit(proxy)}
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(proxy)}
                            disabled={deletingId === proxy.id}
                            className="hover:text-destructive hover:bg-destructive/10"
                            title="Delete"
                          >
                            {deletingId === proxy.id
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <Trash2 className="w-4 h-4" />
                            }
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * data.perPage + 1}–{Math.min(page * data.perPage, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={page >= data.totalPages}
                  onClick={() => onPageChange(page + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete proxy host?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete <span className="font-semibold text-foreground">{deleteTarget?.domain}</span> and
              remove its nginx configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
