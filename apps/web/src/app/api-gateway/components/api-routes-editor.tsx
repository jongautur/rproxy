"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ApiRoute } from "@prisma/client";

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
};

function routeToDraft(r: ApiRoute): RouteDraft {
  return {
    path: r.path,
    methods: r.methods,
    upstreamScheme: r.upstreamScheme,
    upstreamHost: r.upstreamHost,
    upstreamPort: String(r.upstreamPort),
    upstreamPath: r.upstreamPath ?? "",
    authRequired: r.authRequired,
    enabled: r.enabled,
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
  };
}

function RouteFields({ draft, onChange }: { draft: RouteDraft; onChange: (d: RouteDraft) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-xs">Path</Label>
        <Input
          value={draft.path}
          onChange={(e) => onChange({ ...draft, path: e.target.value })}
          placeholder="/v1/geocode/search"
        />
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
        <Label className="text-xs">Require API key (enforced from a later phase)</Label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch checked={draft.enabled} onCheckedChange={(v) => onChange({ ...draft, enabled: v })} />
        <Label className="text-xs">Enabled</Label>
      </div>
    </div>
  );
}

export function ApiRoutesEditor({ apiId }: { apiId: string | null }) {
  const { toast } = useToast();
  const [routes, setRoutes] = useState<ApiRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RouteDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<RouteDraft | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchRoutes = useCallback(async () => {
    if (!apiId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gateway/apis/${apiId}/routes`);
      const json = (await res.json()) as { success: boolean; data: ApiRoute[] };
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
    <div className="space-y-4">
      {routes.map((r) => {
        const draft = drafts[r.id] ?? routeToDraft(r);
        return (
          <div key={r.id} className="rounded-lg border border-border p-3 space-y-3">
            <RouteFields draft={draft} onChange={(d) => setDrafts((prev) => ({ ...prev, [r.id]: d }))} />
            <div className="flex items-center justify-end gap-2">
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
        );
      })}

      {routes.length === 0 && !newDraft && (
        <p className="text-sm text-muted-foreground text-center py-4">No routes yet.</p>
      )}

      {newDraft ? (
        <div className="rounded-lg border border-dashed border-border p-3 space-y-3">
          <RouteFields draft={newDraft} onChange={setNewDraft} />
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
