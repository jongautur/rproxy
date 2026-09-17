"use client";

import { useState } from "react";
import { Users, Edit2, Trash2, ChevronLeft, ChevronRight, Loader2, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { CustomerWithRelations } from "@/types/api-gateway";

interface PaginatedCustomers {
  items: CustomerWithRelations[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface Props {
  data: PaginatedCustomers | null;
  loading: boolean;
  onEdit: (customer: CustomerWithRelations) => void;
  onRefresh: () => void;
  page: number;
  onPageChange: (page: number) => void;
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground font-medium">No customers yet</p>
      <p className="text-muted-foreground text-sm mt-1">Click &quot;Add Customer&quot; to create one and issue API keys</p>
    </div>
  );
}

export function CustomersTable({ data, loading, onEdit, onRefresh, page, onPageChange }: Props) {
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerWithRelations | null>(null);

  async function handleDelete(customer: CustomerWithRelations) {
    setDeletingId(customer.id);
    try {
      const res = await fetch(`/api/gateway/customers/${customer.id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Customer deleted", description: customer.name });
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
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Name / Email</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">API Keys</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">API Access</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((customer) => (
                    <tr
                      key={customer.id}
                      className={cn(
                        "border-b border-border/50 hover:bg-accent/30 transition-colors",
                        !customer.enabled && "opacity-60"
                      )}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-muted-foreground shrink-0" />
                          <div>
                            <p className="font-medium text-foreground">{customer.name}</p>
                            {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <KeyRound className="w-3.5 h-3.5" />
                          {customer._count?.apiKeys ?? 0}
                        </span>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {customer._count?.access ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant={customer.enabled ? "success" : "secondary"}>
                          {customer.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => onEdit(customer)} title="Edit">
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(customer)}
                            disabled={deletingId === customer.id}
                            className="hover:text-destructive hover:bg-destructive/10"
                            title="Delete"
                          >
                            {deletingId === customer.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
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
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span> and
              revoke all of its API keys and access grants. This action cannot be undone.
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
