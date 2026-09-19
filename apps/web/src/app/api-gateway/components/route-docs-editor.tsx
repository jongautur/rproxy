"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Save, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ApiRoutePublic, ApiRouteDocsFormData, DocParameter, DocResponse, ApiRouteMethod } from "@/types/api-gateway";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const ALL_METHODS: ApiRouteMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeToDocsDraft(r: ApiRoutePublic): ApiRouteDocsFormData {
  return {
    docInclude: r.docInclude,
    docSummary: r.docSummary ?? "",
    docDescription: r.docDescription ?? "",
    docCategory: r.docCategory ?? "",
    docDeprecated: r.docDeprecated,
    docParameters: ((r.docParameters as unknown as DocParameter[]) ?? []),
    docRequestBodyDescription: r.docRequestBodyDescription ?? "",
    docRequestBodyExample: r.docRequestBodyExample ?? "",
    docResponses: ((r.docResponses as unknown as DocResponse[]) ?? []),
    docNotes: r.docNotes ?? "",
    docAnyMethods: r.docAnyMethods,
  };
}

// Route path/method/auth/enabled state is never duplicated here — pulled
// read-only from `route` for display only. Saving this section PATCHes
// /api/gateway/docs/[apiId]/routes/[routeId], which never redeploys nginx
// (see docs.service.ts).
export function RouteDocsEditor({ apiId, route, onSaved }: { apiId: string; route: ApiRoutePublic; onSaved?: () => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ApiRouteDocsFormData>(() => routeToDocsDraft(route));
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(routeToDocsDraft(route)); }, [route]);

  function set<K extends keyof ApiRouteDocsFormData>(key: K, value: ApiRouteDocsFormData[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const showBodyFields = route.methods.length === 0 || route.methods.some((m) => BODY_METHODS.has(m));
  const isAnyMethod = route.methods.length === 0;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/gateway/docs/${apiId}/routes/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          docSummary: draft.docSummary || undefined,
          docDescription: draft.docDescription || undefined,
          docCategory: draft.docCategory || undefined,
          docRequestBodyDescription: draft.docRequestBodyDescription || undefined,
          docRequestBodyExample: draft.docRequestBodyExample || undefined,
          docNotes: draft.docNotes || undefined,
        }),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Documentation saved" });
        onSaved?.();
      } else {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  function addParameter() {
    set("docParameters", [...draft.docParameters, { name: "", in: "query", required: false, description: "" }]);
  }
  function updateParameter(i: number, patch: Partial<DocParameter>) {
    set("docParameters", draft.docParameters.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function removeParameter(i: number) {
    set("docParameters", draft.docParameters.filter((_, idx) => idx !== i));
  }

  function addResponse() {
    set("docResponses", [...draft.docResponses, { status: "200", description: "", example: "" }]);
  }
  function updateResponse(i: number, patch: Partial<DocResponse>) {
    set("docResponses", draft.docResponses.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeResponse(i: number) {
    set("docResponses", draft.docResponses.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3 border-t border-border/50 pt-3 mt-1">
      <Label className="text-xs flex items-center gap-1.5">
        <BookOpen className="w-3 h-3" /> Documentation
      </Label>

      <div className="flex items-center gap-2">
        <Switch checked={draft.docInclude} onCheckedChange={(v) => set("docInclude", v)} />
        <Label className="text-xs">Include in docs</Label>
      </div>

      {draft.docInclude && (
        <div className="space-y-3">
          {isAnyMethod && (
            <div className="space-y-1">
              <Label className="text-xs">
                Methods to document (this route allows any method — OpenAPI needs explicit methods)
              </Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {ALL_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.docAnyMethods.includes(m)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...draft.docAnyMethods, m]
                          : draft.docAnyMethods.filter((x) => x !== m);
                        set("docAnyMethods", next);
                      }}
                      className="accent-primary"
                    />
                    <span className="font-mono">{m}</span>
                  </label>
                ))}
              </div>
              {draft.docAnyMethods.length === 0 && (
                <p className="text-xs text-warning">No methods selected — this route will be skipped in the generated OpenAPI document.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={draft.docSummary} onChange={(e) => set("docSummary", e.target.value)} placeholder="Open garage door" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Input value={draft.docCategory} onChange={(e) => set("docCategory", e.target.value)} placeholder="Home" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description</Label>
            <Textarea
              className="font-sans min-h-[60px]"
              value={draft.docDescription}
              onChange={(e) => set("docDescription", e.target.value)}
              placeholder="Sends an open command to the garage door controller."
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch checked={draft.docDeprecated} onCheckedChange={(v) => set("docDeprecated", v)} />
            <Label className="text-xs">Deprecated</Label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Parameters</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={addParameter}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            {draft.docParameters.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto_1fr_auto] gap-1.5 items-center">
                <Input className="h-8 text-xs" value={p.name} onChange={(e) => updateParameter(i, { name: e.target.value })} placeholder="name" />
                <Select value={p.in} onValueChange={(v: DocParameter["in"]) => updateParameter(i, { in: v })}>
                  <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="query">query</SelectItem>
                    <SelectItem value="path">path</SelectItem>
                    <SelectItem value="header">header</SelectItem>
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={p.required} onChange={(e) => updateParameter(i, { required: e.target.checked })} className="accent-primary" />
                  req
                </label>
                <Input className="h-8 text-xs" value={p.description ?? ""} onChange={(e) => updateParameter(i, { description: e.target.value })} placeholder="description" />
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeParameter(i)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {showBodyFields && (
            <div className="space-y-2 border-t border-border/50 pt-2">
              <Label className="text-xs">Request Body</Label>
              <Input
                className="h-8 text-xs"
                value={draft.docRequestBodyDescription}
                onChange={(e) => set("docRequestBodyDescription", e.target.value)}
                placeholder="Body description"
              />
              <Textarea
                className="min-h-[80px]"
                value={draft.docRequestBodyExample}
                onChange={(e) => set("docRequestBodyExample", e.target.value)}
                placeholder='{"example": "JSON body"}'
              />
            </div>
          )}

          <div className="space-y-2 border-t border-border/50 pt-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Responses</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={addResponse}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            {draft.docResponses.map((r, i) => (
              <div key={i} className="space-y-1 rounded border border-border/50 p-2">
                <div className="flex gap-1.5 items-center">
                  <Input className="h-8 text-xs w-20" value={r.status} onChange={(e) => updateResponse(i, { status: e.target.value })} placeholder="200" />
                  <Input className="h-8 text-xs flex-1" value={r.description ?? ""} onChange={(e) => updateResponse(i, { description: e.target.value })} placeholder="Description" />
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeResponse(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <Textarea
                  className="min-h-[50px]"
                  value={r.example ?? ""}
                  onChange={(e) => updateResponse(i, { example: e.target.value })}
                  placeholder="Example response body (optional)"
                />
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea
              className="font-sans min-h-[50px]"
              value={draft.docNotes}
              onChange={(e) => set("docNotes", e.target.value)}
              placeholder="Anything else worth knowing about this endpoint."
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" size="sm" className="gap-1" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Documentation
        </Button>
      </div>
    </div>
  );
}
