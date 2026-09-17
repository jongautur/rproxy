"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Save, Trash2, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import type { ApiRoute, ApiRouteAccess } from "@prisma/client";

// Per-customer, per-route override of an ApiAccess grant's rate/quota
// limits (ApiRouteAccess) — the fields it can set are the exact same shape
// as the API-wide grant in customer-access-editor.tsx, just scoped to one
// route. A route with no override simply inherits the API-wide grant (see
// resolveEffectiveLimits in gateway-auth.service.ts), which is the "no
// override" state shown below rather than a separate on/off flag.

interface OverrideDraft {
  enabled: boolean;
  rateLimitOverride: string;
  dailyQuota: string;
  monthlyQuota: string;
}

const EMPTY_DRAFT: OverrideDraft = { enabled: true, rateLimitOverride: "", dailyQuota: "", monthlyQuota: "" };

function overrideToDraft(o: ApiRouteAccess): OverrideDraft {
  return {
    enabled: o.enabled,
    rateLimitOverride: o.rateLimitOverride != null ? String(o.rateLimitOverride) : "",
    dailyQuota: o.dailyQuota != null ? String(o.dailyQuota) : "",
    monthlyQuota: o.monthlyQuota != null ? String(o.monthlyQuota) : "",
  };
}

function draftToBody(d: OverrideDraft) {
  return {
    enabled: d.enabled,
    rateLimitOverride: d.rateLimitOverride ? Number(d.rateLimitOverride) : undefined,
    dailyQuota: d.dailyQuota ? Number(d.dailyQuota) : undefined,
    monthlyQuota: d.monthlyQuota ? Number(d.monthlyQuota) : undefined,
  };
}

// Describes what a route without its own override currently falls back to —
// makes the "which limit actually applies" question answerable at a glance
// instead of requiring the admin to cross-reference the API-wide grant.
function inheritedSummary(apiRateLimit?: number, apiDailyQuota?: number, apiMonthlyQuota?: number): string {
  const parts: string[] = [];
  if (apiRateLimit) parts.push(`${apiRateLimit} req/s`);
  if (apiDailyQuota) parts.push(`${apiDailyQuota.toLocaleString()}/day`);
  if (apiMonthlyQuota) parts.push(`${apiMonthlyQuota.toLocaleString()}/month`);
  return parts.length > 0 ? `Inherits API-wide: ${parts.join(", ")}` : "Inherits API-wide: unlimited";
}

interface RouteRowState {
  route: ApiRoute;
  override: ApiRouteAccess | null;
  draft: OverrideDraft;
}

interface Props {
  customerId: string;
  apiId: string;
  apiRateLimitOverride?: number;
  apiDailyQuota?: number;
  apiMonthlyQuota?: number;
}

export function RouteAccessEditor({ customerId, apiId, apiRateLimitOverride, apiDailyQuota, apiMonthlyQuota }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RouteRowState[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingRouteId, setAddingRouteId] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    try {
      const routesRes = await fetch(`/api/gateway/apis/${apiId}/routes`);
      const routesJson = (await routesRes.json()) as { success: boolean; data: ApiRoute[] };
      if (!routesJson.success) return;

      const rowsWithOverrides = await Promise.all(
        routesJson.data.map(async (route) => {
          const accessRes = await fetch(`/api/gateway/apis/${apiId}/routes/${route.id}/access`);
          const accessJson = (await accessRes.json()) as { success: boolean; data: ApiRouteAccess[] };
          const override = accessJson.success ? (accessJson.data.find((a) => a.customerId === customerId) ?? null) : null;
          return { route, override, draft: override ? overrideToDraft(override) : EMPTY_DRAFT };
        })
      );
      setRows(rowsWithOverrides);
    } catch {
      toast({ variant: "destructive", title: "Failed to load route overrides" });
    }
  }, [apiId, customerId, toast]);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  function setDraft(routeId: string, draft: OverrideDraft) {
    setRows((prev) => prev?.map((r) => (r.route.id === routeId ? { ...r, draft } : r)) ?? prev);
  }

  async function handleSave(row: RouteRowState) {
    setSavingId(row.route.id);
    try {
      const res = row.override
        ? await fetch(`/api/gateway/apis/${apiId}/routes/${row.route.id}/access/${row.override.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftToBody(row.draft)),
          })
        : await fetch(`/api/gateway/apis/${apiId}/routes/${row.route.id}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId, ...draftToBody(row.draft) }),
          });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Route override saved" }); setAddingRouteId(null); void fetchRows(); }
      else toast({ variant: "destructive", title: "Save failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally { setSavingId(null); }
  }

  async function handleDelete(row: RouteRowState) {
    if (!row.override) return;
    setDeletingId(row.route.id);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes/${row.route.id}/access/${row.override.id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Route override removed" }); void fetchRows(); }
      else toast({ variant: "destructive", title: "Remove failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Remove failed" });
    } finally { setDeletingId(null); }
  }

  if (!rows) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">This API has no routes yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const isEditing = !!row.override || addingRouteId === row.route.id;
        return (
          <div key={row.route.id} className="rounded-md border border-border/50 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">
                {row.route.methods.length > 0 ? row.route.methods.join("/") : "ANY"} {row.route.path}
              </span>
              {!isEditing && (
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => setAddingRouteId(row.route.id)}>
                  <SlidersHorizontal className="w-3 h-3" /> Override
                </Button>
              )}
            </div>

            {!isEditing ? (
              <p className="text-xs text-muted-foreground">{inheritedSummary(apiRateLimitOverride, apiDailyQuota, apiMonthlyQuota)}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Rate limit (req/s)</Label>
                    <Input
                      type="number"
                      value={row.draft.rateLimitOverride}
                      onChange={(e) => setDraft(row.route.id, { ...row.draft, rateLimitOverride: e.target.value })}
                      placeholder={apiRateLimitOverride ? `Inherit (${apiRateLimitOverride})` : "Unlimited"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Daily quota</Label>
                    <Input
                      type="number"
                      value={row.draft.dailyQuota}
                      onChange={(e) => setDraft(row.route.id, { ...row.draft, dailyQuota: e.target.value })}
                      placeholder={apiDailyQuota ? `Inherit (${apiDailyQuota})` : "Unlimited"}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monthly quota</Label>
                    <Input
                      type="number"
                      value={row.draft.monthlyQuota}
                      onChange={(e) => setDraft(row.route.id, { ...row.draft, monthlyQuota: e.target.value })}
                      placeholder={apiMonthlyQuota ? `Inherit (${apiMonthlyQuota})` : "Unlimited"}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-2">
                    <Switch checked={row.draft.enabled} onCheckedChange={(v) => setDraft(row.route.id, { ...row.draft, enabled: v })} />
                    <Label className="text-xs">Enabled</Label>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  {row.override ? (
                    <Button
                      type="button" variant="ghost" size="sm" className="gap-1 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(row)} disabled={deletingId === row.route.id}
                    >
                      {deletingId === row.route.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Remove override
                    </Button>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setAddingRouteId(null)}>
                      Cancel
                    </Button>
                  )}
                  <Button type="button" size="sm" className="gap-1 text-xs h-7" onClick={() => handleSave(row)} disabled={savingId === row.route.id}>
                    {savingId === row.route.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
