"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Loader2, Copy, Check, Ban, KeyRound, ChevronDown, ChevronUp, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import type { ApiKeyPublic, ApiAccessWithApi, ScopableApi, KeyScope } from "@/types/api-gateway";

function fmtDate(v: string | Date | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

// A selected route's method sub-scope. `checked` always holds the actual
// checked methods (never an "empty means all" sentinel — that ambiguity is
// only resolved at save time, see draftToScopeBody below), and `pool` is
// the set of methods pickable for this route (the route's own `methods`,
// or all 5 if the route itself is ANY) — kept alongside the selection so
// save doesn't need to re-look-up scopableApis for routes loaded from the
// existing scope.
interface RouteScopeDraft {
  pool: string[];
  checked: Set<string>;
}

interface ScopeDraft {
  scopeRestricted: boolean;
  selectedRoutes: Map<string, RouteScopeDraft>;
}

function poolFor(routeMethods: string[]): string[] {
  return routeMethods.length > 0 ? routeMethods : ALL_METHODS;
}

// Collapses "every pickable method is checked" back to an empty array,
// which the backend (and gateway-auth.service.ts at request time) reads as
// "inherit whatever the route itself allows" — the default state, kept
// distinct from persisting a redundant full list.
function draftToScopeBody(draft: ScopeDraft) {
  return {
    scopeRestricted: draft.scopeRestricted,
    routes: Array.from(draft.selectedRoutes.entries()).map(([routeId, { pool, checked }]) => ({
      routeId,
      methods: checked.size === pool.length ? [] : Array.from(checked),
    })),
  };
}

function KeyScopeEditor({ customerId, apiKey, scopableApis }: { customerId: string; apiKey: ApiKeyPublic; scopableApis: ScopableApi[] }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/gateway/customers/${customerId}/keys/${apiKey.id}/scope`)
      .then((r) => r.json() as Promise<{ success: boolean; data: KeyScope }>)
      .then((j) => {
        if (cancelled || !j.success) return;
        const selectedRoutes = new Map<string, RouteScopeDraft>(
          j.data.routes.map((r) => {
            const pool = poolFor(r.routeMethods);
            // Empty methods (inherit) renders as everything checked.
            const checked = new Set(r.methods.length > 0 ? r.methods : pool);
            return [r.routeId, { pool, checked }];
          })
        );
        setDraft({ scopeRestricted: j.data.scopeRestricted, selectedRoutes });
      })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Failed to load key scope" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, apiKey.id, toast]);

  function toggleRoute(routeId: string, pool: string[]) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = new Map(prev.selectedRoutes);
      if (next.has(routeId)) {
        next.delete(routeId);
      } else {
        // Newly selected — default to every method the route itself
        // allows, matching "default is what the route is".
        next.set(routeId, { pool, checked: new Set(pool) });
      }
      return { ...prev, selectedRoutes: next };
    });
  }

  function toggleMethod(routeId: string, method: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const existing = prev.selectedRoutes.get(routeId);
      if (!existing) return prev;
      const checked = new Set(existing.checked);
      if (checked.has(method)) checked.delete(method); else checked.add(method);
      const next = new Map(prev.selectedRoutes);
      if (checked.size === 0) {
        // An empty methods array on save means "inherit everything the
        // route allows" (see draftToScopeBody), NOT "block this route" —
        // so unchecking the last method deselects the route entirely
        // instead of silently producing a state that would actually widen
        // access. To block a route, don't select it in the first place.
        next.delete(routeId);
      } else {
        next.set(routeId, { ...existing, checked });
      }
      return { ...prev, selectedRoutes: next };
    });
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/keys/${apiKey.id}/scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToScopeBody(draft)),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) toast({ title: "Scope saved" });
      else toast({ variant: "destructive", title: "Save failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3 pt-2 border-t border-border/50 mt-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={draft.scopeRestricted}
          onCheckedChange={(v) => setDraft({ ...draft, scopeRestricted: v })}
        />
        <Label className="text-xs">Restrict this key to specific routes</Label>
      </div>

      {draft.scopeRestricted && (
        <>
          {scopableApis.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              This customer has no API access grants yet — grant access on the Access tab first, then routes will appear here to pick from.
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {scopableApis.map((api) => (
                <div key={api.apiId} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">{api.apiName}</p>
                  {api.routes.map((route) => {
                    const pool = poolFor(route.methods);
                    const routeScope = draft.selectedRoutes.get(route.id);
                    const isSelected = !!routeScope;
                    return (
                      <div key={route.id} className="pl-2">
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRoute(route.id, pool)}
                            className="accent-primary"
                          />
                          <span className="font-mono">{route.methods.length > 0 ? route.methods.join("/") : "ANY"} {route.path}</span>
                        </label>
                        {isSelected && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6 pt-1">
                            {pool.map((m) => (
                              <label key={m} className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={routeScope.checked.has(m)}
                                  onChange={() => toggleMethod(route.id, m)}
                                  className="accent-primary"
                                />
                                <span className="font-mono">{m}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {draft.selectedRoutes.size === 0 && (
            <div className="flex items-start gap-1.5 text-xs text-warning">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>No routes selected — this key won&apos;t be able to reach anything until you select at least one.</span>
            </div>
          )}
        </>
      )}

      <Button type="button" size="sm" className="gap-1" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Save Scope
      </Button>
    </div>
  );
}

export function CustomerKeysEditor({ customerId }: { customerId: string | null }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [expandedScopeKeyId, setExpandedScopeKeyId] = useState<string | null>(null);
  const [scopableApis, setScopableApis] = useState<ScopableApi[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyPublic | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/keys`);
      const json = (await res.json()) as { success: boolean; data: ApiKeyPublic[] };
      if (json.success) setKeys(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load API keys" });
    } finally {
      setLoading(false);
    }
  }, [customerId, toast]);

  // Routes a key can be scoped to are drawn from the customer's existing
  // ApiAccess grants — reuses the endpoints the Access tab already has
  // (GET .../access, GET .../apis/:id/routes) rather than adding a new
  // "list all routes" endpoint.
  const fetchScopableApis = useCallback(async () => {
    if (!customerId) return;
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/access`);
      const json = (await res.json()) as { success: boolean; data: ApiAccessWithApi[] };
      if (!json.success) return;
      const apis = await Promise.all(
        json.data.map(async (grant) => {
          const routesRes = await fetch(`/api/gateway/apis/${grant.api.id}/routes`);
          const routesJson = (await routesRes.json()) as { success: boolean; data: { id: string; path: string; methods: string[] }[] };
          return {
            apiId: grant.api.id,
            apiName: grant.api.name,
            routes: routesJson.success ? routesJson.data : [],
          };
        })
      );
      setScopableApis(apis);
    } catch {
      toast({ variant: "destructive", title: "Failed to load scopable routes" });
    }
  }, [customerId, toast]);

  useEffect(() => { void fetchKeys(); void fetchScopableApis(); }, [fetchKeys, fetchScopableApis]);

  async function handleGenerate() {
    if (!customerId) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      const json = (await res.json()) as { success: boolean; data?: { plaintextKey: string }; error?: string };
      if (json.success && json.data) {
        setRevealedKey(json.data.plaintextKey);
        setNewLabel("");
        void fetchKeys();
      } else {
        toast({ variant: "destructive", title: "Failed to generate key", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to generate key" });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(key: ApiKeyPublic) {
    if (!customerId) return;
    setTogglingId(key.id);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/keys/${key.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !key.enabled }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: key.enabled ? "Key paused" : "Key resumed" }); void fetchKeys(); }
      else toast({ variant: "destructive", title: "Toggle failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Toggle failed" });
    } finally { setTogglingId(null); }
  }

  async function handleRevoke(key: ApiKeyPublic) {
    if (!customerId) return;
    setRevokingId(key.id);
    try {
      const res = await fetch(`/api/gateway/customers/${customerId}/keys/${key.id}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) { toast({ title: "Key revoked" }); void fetchKeys(); }
      else toast({ variant: "destructive", title: "Revoke failed", description: json.error });
    } catch {
      toast({ variant: "destructive", title: "Revoke failed" });
    } finally { setRevokingId(null); setRevokeTarget(null); }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Copy failed — select and copy manually" });
    }
  }

  if (!customerId) {
    return <div className="text-center py-10 text-sm text-muted-foreground">Save the customer first, then generate API keys.</div>;
  }

  return (
    <div className="space-y-4">
      {revealedKey && (
        <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-2">
          <p className="text-sm font-medium">New API key generated — this is shown once and cannot be retrieved again.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background rounded px-2 py-1.5 border border-border overflow-x-auto whitespace-nowrap">
              {revealedKey}
            </code>
            <Button type="button" size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => copyToClipboard(revealedKey)}>
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRevealedKey(null)}>
            I&apos;ve saved it — dismiss
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No API keys yet.</p>
      ) : (
        <div className="space-y-2">
          {keys.map((key) => (
            <div key={key.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{key.keyPrefix}{key.label ? ` — ${key.label}` : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {fmtDate(key.createdAt)} · Last used {fmtDate(key.lastUsedAt)}
                      {key.expiresAt && ` · Expires ${fmtDate(key.expiresAt)}`}
                    </p>
                  </div>
                  {key.scopeRestricted && <Badge variant="secondary" className="text-[10px]">Scoped</Badge>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {key.revokedAt ? (
                    <Badge variant="destructive">Revoked</Badge>
                  ) : (
                    <>
                      <Switch checked={key.enabled} onCheckedChange={() => handleToggle(key)} disabled={togglingId === key.id} />
                      <Button
                        type="button" variant="ghost" size="sm"
                        className="gap-1 text-xs"
                        onClick={() => setExpandedScopeKeyId(expandedScopeKeyId === key.id ? null : key.id)}
                      >
                        Scope
                        {expandedScopeKeyId === key.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        type="button" variant="ghost" size="icon-sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setRevokeTarget(key)}
                        disabled={revokingId === key.id}
                        title="Revoke permanently"
                      >
                        {revokingId === key.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {expandedScopeKeyId === key.id && !key.revokedAt && customerId && (
                <KeyScopeEditor customerId={customerId} apiKey={key} scopableApis={scopableApis} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (optional)" className="max-w-xs" />
        <Button type="button" size="sm" className="gap-1" onClick={handleGenerate} disabled={creating}>
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Generate New Key
        </Button>
      </div>

      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently revokes <span className="font-mono font-semibold text-foreground">{revokeTarget?.keyPrefix}</span>
              {revokeTarget?.label ? ` (${revokeTarget.label})` : ""}. Any caller still using it will be rejected immediately. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeTarget && handleRevoke(revokeTarget)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
