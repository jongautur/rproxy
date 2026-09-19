"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus, Trash2, Loader2, Save, Search, ChevronDown, ChevronUp, KeyRound, EyeOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { ApiRoutePublic, ApiRouteAuthType } from "@/types/api-gateway";
import { RouteDocsEditor } from "./route-docs-editor";

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

interface RouteDraft {
  path: string;
  methods: string[]; // empty = any method
  upstreamScheme: string;
  upstreamHost: string;
  upstreamPort: string;
  upstreamPath: string;
  authRequired: boolean;
  enabled: boolean;
  // Credential rproxy presents to the BACKEND — independent of authRequired
  // above (which gates the caller). upstreamAuthValue is always blank on
  // load, even for a route that already has one configured (the server
  // never sends the secret back) — see upstreamAuthConfigured below.
  upstreamAuthType: ApiRouteAuthType;
  upstreamAuthHeaderName: string;
  upstreamAuthValue: string;
}

const EMPTY_DRAFT: RouteDraft = {
  path: "",
  methods: [],
  upstreamScheme: "http",
  upstreamHost: "",
  upstreamPort: "80",
  upstreamPath: "",
  authRequired: true,
  enabled: true,
  upstreamAuthType: "NONE",
  upstreamAuthHeaderName: "",
  upstreamAuthValue: "",
};

function routeToDraft(r: ApiRoutePublic): RouteDraft {
  return {
    path: r.path,
    methods: r.methods,
    upstreamScheme: r.upstreamScheme,
    upstreamHost: r.upstreamHost,
    upstreamPort: String(r.upstreamPort),
    upstreamPath: r.upstreamPath ?? "",
    authRequired: r.authRequired,
    enabled: r.enabled,
    upstreamAuthType: r.upstreamAuthType,
    upstreamAuthHeaderName: r.upstreamAuthHeaderName ?? "",
    upstreamAuthValue: "",
  };
}

function draftToBody(d: RouteDraft) {
  return {
    path: d.path,
    methods: d.methods,
    upstreamScheme: d.upstreamScheme,
    upstreamHost: d.upstreamHost,
    upstreamPort: Number(d.upstreamPort),
    upstreamPath: d.upstreamPath || undefined,
    authRequired: d.authRequired,
    enabled: d.enabled,
    upstreamAuthType: d.upstreamAuthType,
    upstreamAuthHeaderName: d.upstreamAuthType === "API_KEY" ? (d.upstreamAuthHeaderName || "X-Api-Key") : undefined,
    // Blank means "leave the existing secret alone" (see route.service.ts) —
    // never sent as an explicit clear; switch type to None for that.
    upstreamAuthValue: d.upstreamAuthValue || undefined,
  };
}

// The externally-callable URL for this route — Api.basePath and route.path
// concatenate directly into one location block (see generateApiGatewayConfig
// in api-gateway-config.ts), so showing that assembled result here is the
// difference between guessing why a route "isn't matching" and seeing it.
function fullRoutePreview(apiDomain: string, apiBasePath: string, routePath: string): string {
  const base = apiBasePath === "/" ? "" : apiBasePath;
  const path = routePath || "/";
  const joined = (base + (path === "/" ? "" : path)) || "/";
  return `${apiDomain || "<domain>"}${joined}`;
}

function RouteFields({
  draft, onChange, apiDomain, apiBasePath, authConfigured,
}: {
  draft: RouteDraft; onChange: (d: RouteDraft) => void; apiDomain: string; apiBasePath: string;
  // Whether THIS route already has an upstream-auth secret stored server
  // side — drives the secret field's placeholder; a new (unsaved) route is
  // never configured yet.
  authConfigured: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">Path</Label>
        <Input
          value={draft.path}
          onChange={(e) => onChange({ ...draft, path: e.target.value })}
          placeholder="/v1/geocode/search"
        />
        <p className="text-xs text-muted-foreground font-mono truncate">
          → {fullRoutePreview(apiDomain, apiBasePath, draft.path)}
        </p>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">Methods (none selected = any method)</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ALL_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.methods.includes(m)}
                onChange={(e) => {
                  const methods = e.target.checked
                    ? [...draft.methods, m]
                    : draft.methods.filter((x) => x !== m);
                  onChange({ ...draft, methods });
                }}
                className="accent-primary"
              />
              <span className="font-mono">{m}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Upstream Scheme</Label>
        <Select value={draft.upstreamScheme} onValueChange={(v) => onChange({ ...draft, upstreamScheme: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="http">http</SelectItem>
            <SelectItem value="https">https</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Upstream Host</Label>
        <Input
          value={draft.upstreamHost}
          onChange={(e) => onChange({ ...draft, upstreamHost: e.target.value })}
          placeholder="nominatim"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Upstream Port</Label>
        <Input
          type="number"
          value={draft.upstreamPort}
          onChange={(e) => onChange({ ...draft, upstreamPort: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Upstream Path (optional rewrite)</Label>
        <Input
          value={draft.upstreamPath}
          onChange={(e) => onChange({ ...draft, upstreamPath: e.target.value })}
          placeholder="/search — blank = pass through"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch checked={draft.authRequired} onCheckedChange={(v) => onChange({ ...draft, authRequired: v })} />
        <Label className="text-xs">Require API key (caller → rproxy)</Label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch checked={draft.enabled} onCheckedChange={(v) => onChange({ ...draft, enabled: v })} />
        <Label className="text-xs">Enabled</Label>
      </div>

      <div className="space-y-2 sm:col-span-2 pt-2 border-t border-border/50 mt-1">
        <Label className="text-xs flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> Upstream authentication (rproxy → backend)
        </Label>
        <p className="text-xs text-muted-foreground">
          Optional — for a backend that requires its own credential, separate from the API key callers present above.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select
              value={draft.upstreamAuthType}
              onValueChange={(v: ApiRouteAuthType) => onChange({ ...draft, upstreamAuthType: v, upstreamAuthValue: "" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">None</SelectItem>
                <SelectItem value="BEARER">Bearer token</SelectItem>
                <SelectItem value="API_KEY">API key header</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.upstreamAuthType === "API_KEY" && (
            <div className="space-y-1">
              <Label className="text-xs">Header name</Label>
              <Input
                value={draft.upstreamAuthHeaderName}
                onChange={(e) => onChange({ ...draft, upstreamAuthHeaderName: e.target.value })}
                placeholder="X-Api-Key"
              />
            </div>
          )}
        </div>
        {draft.upstreamAuthType !== "NONE" && (
          <div className="space-y-1">
            <Label className="text-xs">{draft.upstreamAuthType === "BEARER" ? "Bearer token" : "Header value"}</Label>
            <Input
              type="password"
              value={draft.upstreamAuthValue}
              onChange={(e) => onChange({ ...draft, upstreamAuthValue: e.target.value })}
              placeholder={authConfigured ? "•••••••• (set — leave blank to keep it)" : "Required"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsed, single-line view of a route — what most of the list looks like
// once there are more than a handful of routes, so scanning/finding one
// doesn't mean scrolling past a full edit form for every other route.
function RouteSummaryRow({ route, onClick }: { route: ApiRoutePublic; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors rounded-lg border border-border",
        !route.enabled && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs shrink-0 text-muted-foreground w-24 truncate">
          {route.methods.length > 0 ? route.methods.join("/") : "ANY"}
        </span>
        <span className="font-mono text-sm truncate">{route.path}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
        <span className="text-xs hidden sm:inline truncate max-w-[14rem]">
          {route.upstreamScheme}://{route.upstreamHost}:{route.upstreamPort}
        </span>
        {route.upstreamAuthType !== "NONE" && (
          <span title={`Upstream auth: ${route.upstreamAuthType === "BEARER" ? "Bearer token" : route.upstreamAuthHeaderName ?? "API key header"}`}>
            <Lock className="w-3.5 h-3.5" />
          </span>
        )}
        {route.authRequired ? (
          <span title="Requires API key"><KeyRound className="w-3.5 h-3.5" /></span>
        ) : (
          <span title="No API key required"><EyeOff className="w-3.5 h-3.5" /></span>
        )}
        <ChevronDown className="w-4 h-4" />
      </div>
    </button>
  );
}

export function ApiRoutesEditor({ apiId, apiDomain, apiBasePath }: { apiId: string | null; apiDomain: string; apiBasePath: string }) {
  const { toast } = useToast();
  const [routes, setRoutes] = useState<ApiRoutePublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RouteDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<RouteDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchRoutes = useCallback(async () => {
    if (!apiId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes`);
      const json = (await res.json()) as { success: boolean; data: ApiRoutePublic[] };
      if (json.success) {
        setRoutes(json.data);
        setDrafts(Object.fromEntries(json.data.map((r) => [r.id, routeToDraft(r)])));
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load routes" });
    } finally {
      setLoading(false);
    }
  }, [apiId, toast]);

  useEffect(() => { void fetchRoutes(); }, [fetchRoutes]);

  async function handleSave(routeId: string) {
    if (!apiId) return;
    const draft = drafts[routeId];
    if (!draft) return;
    setSavingId(routeId);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes/${routeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(draft)),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Route saved" });
        void fetchRoutes();
      } else {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(routeId: string) {
    if (!apiId) return;
    setDeletingId(routeId);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes/${routeId}`, { method: "DELETE" });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Route deleted" });
        if (expandedId === routeId) setExpandedId(null);
        void fetchRoutes();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCreate() {
    if (!apiId || !newDraft) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftToBody(newDraft)),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Route added" });
        setNewDraft(null);
        void fetchRoutes();
      } else {
        toast({ variant: "destructive", title: "Add route failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Add route failed" });
    } finally {
      setCreating(false);
    }
  }

  const filteredRoutes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter((r) => r.path.toLowerCase().includes(q) || r.upstreamHost.toLowerCase().includes(q));
  }, [routes, search]);

  if (!apiId) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        Save the API first, then add routes.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {routes.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by path or upstream host..."
            className="pl-8 h-8 text-sm"
          />
        </div>
      )}

      <div className="space-y-2 max-h-[26rem] overflow-y-auto pr-1">
        {filteredRoutes.map((r) => {
          const draft = drafts[r.id] ?? routeToDraft(r);
          const isExpanded = expandedId === r.id;
          if (!isExpanded) {
            return <RouteSummaryRow key={r.id} route={r} onClick={() => setExpandedId(r.id)} />;
          }
          return (
            <div key={r.id} className="rounded-lg border border-primary/30 p-3 space-y-3 bg-accent/10">
              <RouteFields
                draft={draft}
                onChange={(d) => setDrafts((prev) => ({ ...prev, [r.id]: d }))}
                apiDomain={apiDomain}
                apiBasePath={apiBasePath}
                authConfigured={r.upstreamAuthConfigured}
              />
              <RouteDocsEditor apiId={apiId} route={r} onSaved={fetchRoutes} />
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setExpandedId(null)}>
                  <ChevronUp className="w-3.5 h-3.5" /> Collapse
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 gap-1"
                    onClick={() => handleDelete(r.id)}
                    disabled={deletingId === r.id}
                  >
                    {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1"
                    onClick={() => handleSave(r.id)}
                    disabled={savingId === r.id}
                  >
                    {savingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {routes.length === 0 && !newDraft && (
          <p className="text-sm text-muted-foreground text-center py-4">No routes yet.</p>
        )}
        {routes.length > 0 && filteredRoutes.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No routes match &quot;{search}&quot;.</p>
        )}
      </div>

      {newDraft ? (
        <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
          <RouteFields draft={newDraft} onChange={setNewDraft} apiDomain={apiDomain} apiBasePath={apiBasePath} authConfigured={false} />
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setNewDraft(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" className="gap-1" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Route
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setNewDraft(EMPTY_DRAFT)}>
          <Plus className="w-3.5 h-3.5" /> Add Route
        </Button>
      )}
    </div>
  );
}
