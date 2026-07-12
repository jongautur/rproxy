"use client";

import { useState } from "react";
import {
  Lock, RefreshCw, Trash2, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Clock, Loader2, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { daysUntil, formatRelativeTime } from "@/lib/utils";
import type { CertificateWithHosts } from "@/types/certificate";

interface PaginatedCerts {
  items: CertificateWithHosts[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface Props {
  data: PaginatedCerts | null;
  loading: boolean;
  onRefresh: () => void;
  page: number;
  onPageChange: (page: number) => void;
}

function ExpiryBadge({ expiresAt }: { expiresAt: Date | string | null }) {
  if (!expiresAt) return <Badge variant="secondary">Unknown</Badge>;
  const days = daysUntil(expiresAt);
  if (days < 0) return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Expired</Badge>;
  if (days <= 7) return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />{days}d</Badge>;
  if (days <= 30) return <Badge variant="warning"><AlertTriangle className="w-3 h-3 mr-1" />{days}d</Badge>;
  return <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />{days}d</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE")  return <Badge variant="success">Active</Badge>;
  if (status === "PENDING") return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
  if (status === "EXPIRED") return <Badge variant="destructive">Expired</Badge>;
  if (status === "ERROR")   return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
  if (status === "REVOKED") return <Badge variant="secondary">Revoked</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export function CertTable({ data, loading, onRefresh, page, onPageChange }: Props) {
  const { toast } = useToast();
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CertificateWithHosts | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleRenew(cert: CertificateWithHosts) {
    setRenewingId(cert.id);
    try {
      const res = await fetch(`/api/certificates/${cert.id}/renew`, { method: "POST" });
      const json = await res.json() as { success: boolean; data?: { output: string }; error?: string };
      if (json.success) {
        toast({ title: "Certificate renewed", description: cert.domain });
        onRefresh();
      } else {
        toast({ variant: "destructive", title: "Renewal failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Renewal failed" });
    } finally {
      setRenewingId(null);
    }
  }

  async function handleDelete(cert: CertificateWithHosts) {
    setDeletingId(cert.id);
    try {
      const res = await fetch(`/api/certificates/${cert.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Certificate deleted", description: cert.domain });
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
            <div className="text-center py-16">
              <Lock className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-muted-foreground font-medium">No certificates yet</p>
              <p className="text-muted-foreground text-sm mt-1">Click &quot;Issue Certificate&quot; to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-6 py-3 text-muted-foreground font-medium">Domain</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Provider</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Expires</th>
                    <th className="hidden sm:table-cell text-left px-4 py-3 text-muted-foreground font-medium">Used By</th>
                    <th className="text-right px-6 py-3 text-muted-foreground font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((cert) => (
                    <>
                      <tr
                        key={cert.id}
                        className="border-b border-border/50 hover:bg-accent/30 transition-colors cursor-pointer"
                        onClick={() => setExpandedId(expandedId === cert.id ? null : cert.id)}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
                            <div>
                              <p className="font-medium">{cert.domain}</p>
                              <p className="text-xs text-muted-foreground">{cert.challengeType} challenge</p>
                            </div>
                          </div>
                        </td>
                        <td className="hidden sm:table-cell px-4 py-4 text-muted-foreground">
                          {cert.provider === "LETSENCRYPT" ? "Let's Encrypt" : cert.provider}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={cert.status} />
                        </td>
                        <td className="px-4 py-4">
                          <ExpiryBadge expiresAt={cert.expiresAt} />
                        </td>
                        <td className="hidden sm:table-cell px-4 py-4">
                          {cert.proxyHosts.length > 0 ? (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Globe className="w-3 h-3" />
                              <span className="text-xs">{cert.proxyHosts.length} host{cert.proxyHosts.length !== 1 ? "s" : ""}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            {cert.provider === "LETSENCRYPT" && cert.status === "ACTIVE" && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => handleRenew(cert)}
                                disabled={renewingId === cert.id}
                                title="Renew now"
                              >
                                <RefreshCw className={`w-4 h-4 ${renewingId === cert.id ? "animate-spin" : ""}`} />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDeleteTarget(cert)}
                              disabled={deletingId === cert.id}
                              className="hover:text-destructive hover:bg-destructive/10"
                              title="Delete"
                            >
                              {deletingId === cert.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expandedId === cert.id && (
                        <tr key={`${cert.id}-detail`} className="bg-accent/10">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              <div>
                                <p className="text-muted-foreground mb-1">Issuer</p>
                                <p className="font-mono truncate">{cert.issuer ?? "—"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">Issued</p>
                                <p>{cert.issuedAt ? new Date(cert.issuedAt).toLocaleDateString() : "—"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">Expires</p>
                                <p>{cert.expiresAt ? new Date(cert.expiresAt).toLocaleDateString() : "—"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground mb-1">Last Renewed</p>
                                <p>{cert.lastRenewAt ? formatRelativeTime(cert.lastRenewAt) : "—"}</p>
                              </div>
                              {cert.sans.length > 0 && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-muted-foreground mb-1">SANs</p>
                                  <p className="font-mono">{cert.sans.join(", ")}</p>
                                </div>
                              )}
                              {cert.renewError && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-muted-foreground mb-1">Last Error</p>
                                  <pre className="text-destructive font-mono whitespace-pre-wrap text-xs bg-destructive/10 rounded p-2">
                                    {cert.renewError}
                                  </pre>
                                </div>
                              )}
                              {cert.proxyHosts.length > 0 && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-muted-foreground mb-1">Used by proxy hosts</p>
                                  <div className="flex flex-wrap gap-2">
                                    {cert.proxyHosts.map((h) => (
                                      <Badge key={h.id} variant="outline">{h.domain}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
            <AlertDialogTitle>Delete certificate?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke and delete the certificate for{" "}
              <span className="font-semibold text-foreground">{deleteTarget?.domain}</span>.
              {(deleteTarget?.proxyHosts?.length ?? 0) > 0 && (
                <span className="block mt-2 text-warning">
                  ⚠ This certificate is in use by {deleteTarget?.proxyHosts?.length} proxy host(s). Detach it first.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={(deleteTarget?.proxyHosts?.length ?? 0) > 0}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
