"use client";

import { useState } from "react";
import {
  Plug, Edit2, Trash2, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, Lock, Loader2,
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
import type { ApiWithRelations } from "@/types/api-gateway";

interface PaginatedApis {
  items: ApiWithRelations[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface Props {
  data: PaginatedApis | null;
  loading: boolean;
  onEdit: (api: ApiWithRelations) => void;
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

function EmptyState() {
  return (
    <div className="text-center py-16">
      <Plug className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">No APIs yet</p>
      <p className="text-muted-foreground text-sm mt-1">Click &quot;Add API&quot; to create your first API gateway</p>
    </div>
  );
}

export function ApisTable({ data, loading, onEdit, onRefresh, page, onPageChange }: Props) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiWithRelations | null>(null);

  async function handleToggle(api: ApiWithRelations) {
    setTogglingId(api.id);
    try {
      const res = await fetch(`/api/gateway/apis/${api.id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !api.enabled }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: api.enabled ? "API disabled" : "API enabled" });
        onRefresh();
      } else {
        toast({ variant: "destructive", title: "Toggle failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Toggle failed" });
    } finally { setTogglingId(null); }
  }

  async function handleDelete(api: ApiWithRelations) {
    setDeletingId(api.id);
    try {
      const res = await fetch(`/api/gateway/apis/${api.id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "API deleted", description: api.domain });
        onRefresh();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally { setDeletingId(null); setDeleteTarget(null); }
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
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Name / Domain</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Base Path</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Routes</th>
                    <th className="hidden md:table-cell text-left px-4 py-3 text-muted-foreground font-medium">SSL</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Enabled</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((api) => (
                    <tr
                      key={api.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-accent/30 transition-colors",
                        !api.enabled && "opacity-60"
                      )}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Plug className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">{api.name}</p>
                            <p className="text-xs text-muted-foreground">{api.domain}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">{api.basePath || "/"}</td>
                      <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">{api._count?.routes ?? 0}</td>
                      <td className="hidden md:table-cell px-4 py-4">
                        {api.sslEnabled && <span title="SSL"><Lock className="w-3.5 h-3.5 text-success" /></span>}
                      </td>
                      <td className="px-4 py-4"><StatusBadge status={api.status} enabled={api.enabled} /></td>
                      <td className="px-4 py-4">
                        <Switch checked={api.enabled} onCheckedChange={() => handleToggle(api)} disabled={togglingId === api.id} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(api)} title="Edit">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(api)}
                            disabled={deletingId === api.id}
                            className="hover:text-destructive hover:bg-destructive/10"
                            title="Delete"
                          >
                            {deletingId === api.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          </Button>
                        </div>
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
            <AlertDialogTitle>Delete API?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span> ({deleteTarget?.domain}),
              all of its routes, and remove its nginx configuration. This action cannot be undone.
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
