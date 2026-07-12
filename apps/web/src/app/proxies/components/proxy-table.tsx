"use client";

import { useState, useEffect } from "react";
import {
  Globe, Edit2, Trash2, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Lock, Wifi, Loader2, Heart,
  ChevronDown, ChevronRight as ChevronRightIcon, Layers,
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

function rootDomain(domain: string): string {
  const parts = domain.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : domain;
}

function StatusBadge({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) return <Badge variant="secondary">Disabled</Badge>;
  if (status === "ACTIVE") return <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
  if (status === "ERROR") return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <Globe className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">No proxy hosts yet</p>
      <p className="text-muted-foreground text-sm mt-1">Click &quot;Add Proxy Host&quot; to create your first reverse proxy</p>
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
  const [grouped, setGrouped] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

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
      setHealthMap(Object.fromEntries(results.filter((r) => r.result).map((r) => [r.id, r.result!])));
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
    } finally { setProbingId(null); }
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
    } finally { setTogglingId(null); }
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
    } finally { setDeletingId(null); setDeleteTarget(null); }
  }

  function toggleGroup(root: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root); else next.add(root);
      return next;
    });
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

  // Build groups when grouping is on
  const groups: Map<string, ProxyHostWithCert[]> = new Map();
  if (grouped) {
    for (const proxy of items) {
      const root = rootDomain(proxy.domain);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(proxy);
    }
  }

  function ProxyRow({ proxy, indent = false }: { proxy: ProxyHostWithCert; indent?: boolean }) {
    return (
      <tr
        className={cn(
          "border-b border-border/50 hover:bg-accent/30 transition-colors",
          !proxy.enabled && "opacity-60"
        )}
      >
        <td className="px-6 py-4">
          <div className={cn("flex items-center gap-2", indent && "pl-5")}>
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <div>
              <p className="font-medium text-foreground">{proxy.domain}</p>
              <p className="text-xs text-muted-foreground">:{proxy.listenPort}</p>
            </div>
          </div>
        </td>
        <td className="hidden sm:table-cell px-6 py-4 text-muted-foreground">{proxy.forwardHost}</td>
        <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">{proxy.forwardPort}</td>
        <td className="hidden md:table-cell px-4 py-4">
          <div className="flex items-center gap-1.5">
            {proxy.sslEnabled && <span title="SSL"><Lock className="w-3.5 h-3.5 text-success" /></span>}
            {proxy.websocket && <span title="WebSocket"><Wifi className="w-3.5 h-3.5 text-primary" /></span>}
            {proxy.http2 && <Badge variant="info" className="text-[10px] px-1.5 py-0">H2</Badge>}
            {proxy.forceHttps && <Badge variant="info" className="text-[10px] px-1.5 py-0">HTTPS</Badge>}
          </div>
        </td>
        <td className="px-4 py-4"><StatusBadge status={proxy.status} enabled={proxy.enabled} /></td>
        <td className="hidden sm:table-cell px-4 py-4">
          {healthMap[proxy.id] ? (
            <div className="flex items-center gap-1.5">
              <span className={cn("w-2 h-2 rounded-full shrink-0", healthMap[proxy.id]!.status === "UP" ? "bg-green-500" : "bg-red-500")} />
              <span className="text-xs text-muted-foreground">
                {healthMap[proxy.id]!.status === "UP"
                  ? (healthMap[proxy.id]!.responseTime ? `${healthMap[proxy.id]!.responseTime}ms` : "UP")
                  : "DOWN"}
              </span>
            </div>
          ) : (
            <span className="w-2 h-2 rounded-full bg-muted-foreground/30 block" />
          )}
        </td>
        <td className="px-4 py-4">
          <Switch checked={proxy.enabled} onCheckedChange={() => handleToggle(proxy)} disabled={togglingId === proxy.id} />
        </td>
        <td className="px-6 py-4">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => handleProbe(proxy)} disabled={probingId === proxy.id} title="Check health">
              {probingId === proxy.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => onEdit(proxy)} title="Edit">
              <Edit2 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(proxy)} disabled={deletingId === proxy.id} className="hover:text-destructive hover:bg-destructive/10" title="Delete">
              {deletingId === proxy.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {/* Group toggle */}
          <div className="flex items-center justify-end px-4 py-2 border-b border-border/50">
            <Button
              variant={grouped ? "secondary" : "ghost"}
              size="sm"
              className="gap-2 text-xs"
              onClick={() => {
                setGrouped((v) => !v);
                setExpandedGroups(new Set());
              }}
            >
              <Layers className="w-3.5 h-3.5" />
              Group by domain
            </Button>
          </div>

          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Domain</th>
                    <th className="hidden sm:table-cell text-left px-6 py-3 text-muted-foreground font-medium">Forward To</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Port</th>
                    <th className="hidden md:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Features</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Health</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Enabled</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped ? (
                    Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([root, members]) => {
                      const isExpanded = expandedGroups.has(root);
                      const isSingle = members.length === 1 && members[0]!.domain === root;

                      // Single host that IS the root — just show as a normal row
                      if (isSingle) return <ProxyRow key={root} proxy={members[0]!} />;

                      return (
                        <>
                          {/* Group header row */}
                          <tr
                            key={`group-${root}`}
                            className="border-b border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer select-none"
                            onClick={() => toggleGroup(root)}
                          >
                            <td className="px-6 py-3" colSpan={8}>
                              <div className="flex items-center gap-2">
                                {isExpanded
                                  ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                  : <ChevronRightIcon className="w-4 h-4 text-muted-foreground" />
                                }
                                <Globe className="w-4 h-4 text-primary" />
                                <span className="font-semibold text-foreground">{root}</span>
                                <Badge variant="secondary" className="text-xs ml-1">
                                  {members.length} {members.length === 1 ? "host" : "hosts"}
                                </Badge>
                                {members.some((m) => m.enabled) && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 ml-1" title="Some hosts active" />
                                )}
                              </div>
                            </td>
                          </tr>
                          {/* Child rows when expanded */}
                          {isExpanded && members
                            .sort((a, b) => a.domain.localeCompare(b.domain))
                            .map((proxy) => <ProxyRow key={proxy.id} proxy={proxy} indent />)
                          }
                        </>
                      );
                    })
                  ) : (
                    items.map((proxy) => <ProxyRow key={proxy.id} proxy={proxy} />)
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination — hidden when grouped */}
          {!grouped && data && data.totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * data.perPage + 1}–{Math.min(page * data.perPage, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground">{page} / {data.totalPages}</span>
                <Button variant="outline" size="icon-sm" disabled={page >= data.totalPages} onClick={() => onPageChange(page + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
