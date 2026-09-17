"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, Trash2, Save, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ApiAccessWithApi } from "@/types/api-gateway";
import { RouteAccessEditor } from "./route-access-editor";

interface ApiOption { id: string; name: string; domain: string; }

interface AccessDraft {
  enabled: boolean;
  rateLimitOverride: string;
  dailyQuota: string;
  monthlyQuota: string;
}

function grantToDraft(g: ApiAccessWithApi): AccessDraft {
  return {
    enabled: g.enabled,
    rateLimitOverride: g.rateLimitOverride != null ? String(g.rateLimitOverride) : "",
    dailyQuota: g.dailyQuota != null ? String(g.dailyQuota) : "",
    monthlyQuota: g.monthlyQuota != null ? String(g.monthlyQuota) : "",
  };
}

function draftToBody(d: AccessDraft) {
  return {
    enabled: d.enabled,
    rateLimitOverride: d.rateLimitOverride ? Number(d.rateLimitOverride) : undefined,
    dailyQuota: d.dailyQuota ? Number(d.dailyQuota) : undefined,
    monthlyQuota: d.monthlyQuota ? Number(d.monthlyQuota) : undefined,
  };
}

function DraftFields({ draft, onChange }: { draft: AccessDraft; onChange: (d: AccessDraft) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
      <div className="space-y-1">
        <Label className="text-xs">Rate limit (req/s)</Label>
        <Input type="number" value={draft.rateLimitOverride} onChange={(e) => onChange({ ...draft, rateLimitOverride: e.target.value })} placeholder="Unlimited" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Daily quota</Label>
        <Input type="number" value={draft.dailyQuota} onChange={(e) => onChange({ ...draft, dailyQuota: e.target.value })} placeholder="Unlimited" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Monthly quota</Label>
        <Input type="number" value={draft.monthlyQuota} onChange={(e) => onChange({ ...draft, monthlyQuota: e.target.value })} placeholder="Unlimited" />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch checked={draft.enabled} onCheckedChange={(v) => onChange({ ...draft, enabled: v })} />
        <Label className="text-xs">Enabled</Label>
      </div>
    </div>
  );
}

export function CustomerAccessEditor({ customerId }: { customerId: string | null }) {
  const { toast } = useToast();
  const [grants, setGrants] = useState<ApiAccessWithApi[]>([]);
  const [apis, setApis] = useState<ApiOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, AccessDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newApiId, setNewApiId] = useState("");
  const [creating, setCreating] = useState(false);
  const [expandedRoutesGrantId, setExpandedRoutesGrantId] = useState<string | null>(null);

  const fetchGrants = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/access`);
      const json = (await res.json()) as { success: boolean; data: ApiAccessWithApi[] };
      if (json.success) {
        setGrants(json.data);
        setDrafts(Object.fromEntries(json.data.map((g) => [g.id, grantToDraft(g)])));
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load access grants" });
    } finally {
      setLoading(false);
    }
  }, [customerId, toast]);

  useEffect(() => { void fetchGrants(); }, [fetchGrants]);

  useEffect(() => {
    fetch("/api/gateway/apis?perPage=100")
      .then((r) => r.json() as Promise<{ success: boolean; data: { items: ApiOption[] } }>)
      .then((j) => { if (j.success) setApis(j.data.items); })
      .catch(() => {});
  }, []);

  async function handleSave(grantId: string) {
    if (!customerId) return;
    const draft = drafts[grantId];
    if (!draft) return;
    setSavingId(grantId);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/access/${grantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(draft)),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Access grant saved" }); void fetchGrants(); }
      else toast({ variant: "destructive", title: "Save failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally { setSavingId(null); }
  }

  async function handleDelete(grantId: string) {
    if (!customerId) return;
    setDeletingId(grantId);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/access/${grantId}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Access grant removed" }); void fetchGrants(); }
      else toast({ variant: "destructive", title: "Remove failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Remove failed" });
    } finally { setDeletingId(null); }
  }

  async function handleCreate() {
    if (!customerId || !newApiId) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiId: newApiId, enabled: true }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Access granted" }); setNewApiId(""); void fetchGrants(); }
      else toast({ variant: "destructive", title: "Grant failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Grant failed" });
    } finally { setCreating(false); }
  }

  if (!customerId) {
    return <div className="text-center py-10 text-sm text-muted-foreground">Save the customer first, then grant API access.</div>;
  }

  const grantedApiIds = new Set(grants.map((g) => g.apiId));
  const availableApis = apis.filter((a) => !grantedApiIds.has(a.id));

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : grants.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No API access granted yet.</p>
      ) : (
        <div className="space-y-3">
          {grants.map((g) => {
            const draft = drafts[g.id] ?? grantToDraft(g);
            return (
              <div key={g.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{g.api.name}</p>
                      <p className="text-xs text-muted-foreground">{g.api.domain}</p>
                    </div>
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon-sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => handleDelete(g.id)}
                    disabled={deletingId === g.id}
                  >
                    {deletingId === g.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                </div>
                <DraftFields draft={draft} onChange={(d) => setDrafts((prev) => ({ ...prev, [g.id]: d }))} />
                <div className="flex items-center justify-between">
                  <Button
                    type="button" variant="ghost" size="sm" className="gap-1 text-xs"
                    onClick={() => setExpandedRoutesGrantId(expandedRoutesGrantId === g.id ? null : g.id)}
                  >
                    Route overrides
                    {expandedRoutesGrantId === g.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </Button>
                  <Button type="button" size="sm" className="gap-1" onClick={() => handleSave(g.id)} disabled={savingId === g.id}>
                    {savingId === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </Button>
                </div>
                {expandedRoutesGrantId === g.id && customerId && (
                  <div className="pt-2 border-t border-border/50 mt-2">
                    <RouteAccessEditor
                      customerId={customerId}
                      apiId={g.apiId}
                      apiRateLimitOverride={g.rateLimitOverride ?? undefined}
                      apiDailyQuota={g.dailyQuota ?? undefined}
                      apiMonthlyQuota={g.monthlyQuota ?? undefined}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {availableApis.length > 0 && (
        <div className="flex items-center gap-2">
          <Select value={newApiId} onValueChange={setNewApiId}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select an API to grant" /></SelectTrigger>
            <SelectContent>
              {availableApis.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.name} ({a.domain})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="gap-1" onClick={handleCreate} disabled={!newApiId || creating}>
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Grant Access
          </Button>
        </div>
      )}
    </div>
  );
}
