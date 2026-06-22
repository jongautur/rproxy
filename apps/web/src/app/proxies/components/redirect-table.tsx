"use client";

import { useState } from "react";
import { CornerUpRight, Edit2, Trash2, Lock, Loader2 } from "lucide-react";
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
import type { RedirectHostWithCert } from "@/types/redirect";

interface Props {
  items: RedirectHostWithCert[];
  loading: boolean;
  onEdit: (redirect: RedirectHostWithCert) => void;
  onRefresh: () => void;
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <CornerUpRight className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">No redirects yet</p>
      <p className="text-muted-foreground text-sm mt-1">
        Click &quot;Add Redirect&quot; to create your first domain redirect
      </p>
    </div>
  );
}

export function RedirectTable({ items, loading, onEdit, onRefresh }: Props) {
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RedirectHostWithCert | null>(null);

  async function handleToggle(redirect: RedirectHostWithCert) {
    setTogglingId(redirect.id);
    try {
      const res = await fetch(`/api/redirects/${redirect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !redirect.enabled }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: redirect.enabled ? "Redirect disabled" : "Redirect enabled" });
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

  async function handleDelete(redirect: RedirectHostWithCert) {
    setDeletingId(redirect.id);
    try {
      const res = await fetch(`/api/redirects/${redirect.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Redirect deleted", description: redirect.sourceDomain });
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
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Source Domain</th>
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Destination</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Code</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Options</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Enabled</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((redirect) => (
                    <tr
                      key={redirect.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-accent/30 transition-colors",
                        !redirect.enabled && "opacity-60"
                      )}
                    >
                      {/* Source */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <CornerUpRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          <span className="font-medium text-foreground">{redirect.sourceDomain}</span>
                        </div>
                      </td>

                      {/* Destination */}
                      <td className="px-6 py-4 text-muted-foreground max-w-xs truncate">
                        {redirect.destination}
                      </td>

                      {/* Code */}
                      <td className="px-4 py-4">
                        <Badge variant={redirect.redirectCode === 301 ? "secondary" : "info"}>
                          {redirect.redirectCode}
                        </Badge>
                      </td>

                      {/* Options */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5">
                          {redirect.sslEnabled && (
                            <span title="SSL enabled">
                              <Lock className="w-3.5 h-3.5 text-success" />
                            </span>
                          )}
                          {redirect.preservePath && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">path</Badge>
                          )}
                        </div>
                      </td>

                      {/* Toggle */}
                      <td className="px-4 py-4">
                        <Switch
                          checked={redirect.enabled}
                          onCheckedChange={() => handleToggle(redirect)}
                          disabled={togglingId === redirect.id}
                        />
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onEdit(redirect)}
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(redirect)}
                            disabled={deletingId === redirect.id}
                            className="hover:text-destructive hover:bg-destructive/10"
                            title="Delete"
                          >
                            {deletingId === redirect.id
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
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete redirect?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the redirect from{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.sourceDomain}</span> and
              remove its nginx configuration. This cannot be undone.
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
