"use client";

import { useState, useEffect } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import type { ApiDocsSummary } from "@/types/api-gateway";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: ApiDocsSummary | null;
  onSaved: () => void;
}

interface FormState {
  docsEnabled: boolean;
  docsTitle: string;
  docsDescription: string;
  docsVersion: string;
  docsIntro: string;
  docsAuthContent: string;
  docsErrorsContent: string;
  docsNotes: string;
  docsPublic: boolean;
  docsSlug: string;
  docsLogoUrl: string;
  docsCountDisabledRoutes: boolean;
}

const DEFAULT: FormState = {
  docsEnabled: false,
  docsTitle: "",
  docsDescription: "",
  docsVersion: "1.0.0",
  docsIntro: "",
  docsAuthContent: "",
  docsErrorsContent: "",
  docsNotes: "",
  docsPublic: false,
  docsSlug: "",
  docsLogoUrl: "",
  docsCountDisabledRoutes: false,
};

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function ApiDocsSettingsDialog({ open, onOpenChange, api, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  useEffect(() => {
    if (!open || !api) return;
    setActiveTab("general");
    setErrors({});
    setLoading(true);
    fetch(`/api/gateway/docs/${api.apiId}`)
      .then((r) => r.json() as Promise<{ success: boolean; data: { api: Record<string, unknown> } }>)
      .then((j) => {
        if (!j.success) return;
        const a = j.data.api;
        setForm({
          docsEnabled: !!a.docsEnabled,
          docsTitle: (a.docsTitle as string) ?? "",
          docsDescription: (a.docsDescription as string) ?? "",
          docsVersion: (a.docsVersion as string) ?? "1.0.0",
          docsIntro: (a.docsIntro as string) ?? "",
          docsAuthContent: (a.docsAuthContent as string) ?? "",
          docsErrorsContent: (a.docsErrorsContent as string) ?? "",
          docsNotes: (a.docsNotes as string) ?? "",
          docsPublic: !!a.docsPublic,
          docsSlug: (a.docsSlug as string) ?? slugify(api.apiName),
          docsLogoUrl: (a.docsLogoUrl as string) ?? "",
          docsCountDisabledRoutes: !!a.docsCountDisabledRoutes,
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load documentation settings" }))
      .finally(() => setLoading(false));
  }, [open, api, toast]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api) return;
    setSaving(true);
    setErrors({});

    const body = {
      docsEnabled: form.docsEnabled,
      docsTitle: form.docsTitle || undefined,
      docsDescription: form.docsDescription || undefined,
      docsVersion: form.docsVersion || undefined,
      docsIntro: form.docsIntro || undefined,
      docsAuthContent: form.docsAuthContent || undefined,
      docsErrorsContent: form.docsErrorsContent || undefined,
      docsNotes: form.docsNotes || undefined,
      docsPublic: form.docsPublic,
      docsSlug: form.docsSlug || undefined,
      docsLogoUrl: form.docsLogoUrl || undefined,
      docsCountDisabledRoutes: form.docsCountDisabledRoutes,
    };

    try {
      const res = await fetch(`/api/gateway/docs/${api.apiId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; error?: string; details?: Record<string, string[]> };

      if (json.success) {
        toast({ title: "Documentation settings saved" });
        onSaved();
      } else if (json.details) {
        const fieldErrors: Record<string, string> = {};
        for (const [k, v] of Object.entries(json.details)) fieldErrors[k] = v[0] ?? "Invalid value";
        setErrors(fieldErrors);
        toast({ variant: "destructive", title: "Validation failed" });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  if (!api) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Documentation settings — {api.apiName}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch checked={form.docsEnabled} onCheckedChange={(v) => set("docsEnabled", v)} />
              <Label>Enable documentation for this API</Label>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="getting-started">Getting Started</TabsTrigger>
                <TabsTrigger value="auth">Authentication</TabsTrigger>
                <TabsTrigger value="errors">Errors</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Title</Label>
                    <Input value={form.docsTitle} onChange={(e) => set("docsTitle", e.target.value)} placeholder={api.apiName} />
                  </div>
                  <div className="space-y-1">
                    <Label>Version</Label>
                    <Input value={form.docsVersion} onChange={(e) => set("docsVersion", e.target.value)} placeholder="1.0.0" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Short description</Label>
                  <Textarea
                    className="font-sans min-h-[60px]"
                    value={form.docsDescription}
                    onChange={(e) => set("docsDescription", e.target.value)}
                    placeholder="What this API does, at a glance."
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Documentation slug</Label>
                    <Input value={form.docsSlug} onChange={(e) => set("docsSlug", slugify(e.target.value))} placeholder="sleik-api" />
                    {errors.docsSlug && <p className="text-xs text-destructive">{errors.docsSlug}</p>}
                    {form.docsSlug && (
                      <a
                        href={`/docs/${form.docsSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        /docs/{form.docsSlug} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>Logo URL (optional)</Label>
                    <Input value={form.docsLogoUrl} onChange={(e) => set("docsLogoUrl", e.target.value)} placeholder="https://..." />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={form.docsPublic} onCheckedChange={(v) => set("docsPublic", v)} />
                  <Label>Public (no login required to view /docs/{form.docsSlug || "<slug>"})</Label>
                </div>

                <div className="flex items-center gap-2">
                  <Switch checked={form.docsCountDisabledRoutes} onCheckedChange={(v) => set("docsCountDisabledRoutes", v)} />
                  <Label>Count disabled routes toward documentation coverage</Label>
                </div>
              </TabsContent>

              <TabsContent value="getting-started" className="mt-4 space-y-1">
                <Label>Introduction / Getting Started (Markdown)</Label>
                <Textarea
                  className="min-h-[220px]"
                  value={form.docsIntro}
                  onChange={(e) => set("docsIntro", e.target.value)}
                  placeholder="## Getting Started&#10;&#10;Base URL, how to obtain an API key, a first request example..."
                />
              </TabsContent>

              <TabsContent value="auth" className="mt-4 space-y-1">
                <Label>Authentication (Markdown)</Label>
                <Textarea
                  className="min-h-[220px]"
                  value={form.docsAuthContent}
                  onChange={(e) => set("docsAuthContent", e.target.value)}
                  placeholder="Present your API key in the `X-Api-Key` header on every request..."
                />
              </TabsContent>

              <TabsContent value="errors" className="mt-4 space-y-1">
                <Label>Common Errors (Markdown)</Label>
                <Textarea
                  className="min-h-[220px]"
                  value={form.docsErrorsContent}
                  onChange={(e) => set("docsErrorsContent", e.target.value)}
                  placeholder="401 — missing or invalid API key&#10;429 — rate limit or quota exceeded..."
                />
              </TabsContent>

              <TabsContent value="notes" className="mt-4 space-y-1">
                <Label>Custom Notes (Markdown)</Label>
                <Textarea
                  className="min-h-[220px]"
                  value={form.docsNotes}
                  onChange={(e) => set("docsNotes", e.target.value)}
                  placeholder="Anything else developers integrating with this API should know."
                />
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
