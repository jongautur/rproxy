"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ApiWithRelations } from "@/types/api-gateway";
import { ApiRoutesEditor } from "./api-routes-editor";

interface CertOption { id: string; domain: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: ApiWithRelations | null;
  onSaved: () => void;
}

interface FormState {
  name: string;
  domain: string;
  basePath: string;
  description: string;
  listenPort: string;
  httpsPort: string;
  sslEnabled: boolean;
  certificateId: string;
  maxRequestsPerSecond: string;
  maxBodySizeMb: string;
  corsEnabled: boolean;
}

const DEFAULT: FormState = {
  name: "",
  domain: "",
  basePath: "",
  description: "",
  listenPort: "80",
  httpsPort: "443",
  sslEnabled: false,
  certificateId: "",
  maxRequestsPerSecond: "",
  maxBodySizeMb: "",
  corsEnabled: false,
};

function apiToForm(a: ApiWithRelations): FormState {
  return {
    name: a.name,
    domain: a.domain,
    basePath: a.basePath,
    description: a.description ?? "",
    listenPort: String(a.listenPort),
    httpsPort: String(a.httpsPort),
    sslEnabled: a.sslEnabled,
    certificateId: a.certificateId ?? "",
    maxRequestsPerSecond: a.maxRequestsPerSecond != null ? String(a.maxRequestsPerSecond) : "",
    maxBodySizeMb: a.maxBodySizeMb != null ? String(a.maxBodySizeMb) : "",
    corsEnabled: a.corsEnabled,
  };
}

export function ApiFormDialog({ open, onOpenChange, api, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [certs, setCerts] = useState<CertOption[]>([]);
  const [activeTab, setActiveTab] = useState("general");

  const isEditing = !!api;

  useEffect(() => {
    if (!open) return;
    setActiveTab("general");
    if (api) {
      setForm(apiToForm(api));
    } else {
      setForm(DEFAULT);
    }
    setErrors({});

    fetch("/api/certificates?perPage=100")
      .then((r) => r.json() as Promise<{ success: boolean; data: { items: CertOption[] } }>)
      .then((j) => { if (j.success) setCerts(j.data.items); })
      .catch(() => {});
  }, [open, api]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});

    const body = {
      name: form.name,
      domain: form.domain,
      basePath: form.basePath,
      description: form.description || undefined,
      listenPort: Number(form.listenPort),
      httpsPort: Number(form.httpsPort),
      sslEnabled: form.sslEnabled,
      certificateId: form.certificateId || undefined,
      maxRequestsPerSecond: form.maxRequestsPerSecond ? Number(form.maxRequestsPerSecond) : undefined,
      maxBodySizeMb: form.maxBodySizeMb ? Number(form.maxBodySizeMb) : undefined,
      corsEnabled: form.corsEnabled,
    };

    try {
      const res = isEditing
        ? await fetch(`/api/gateway/apis/${api!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/gateway/apis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const json = (await res.json()) as { success: boolean; error?: string; details?: Record<string, string[]> };

      if (json.success) {
        toast({ title: isEditing ? "API updated" : "API created" });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit API" : "Add API"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="routes">Routes</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Geocoding API" />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Domain</Label>
                  <Input value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="api.example.com" />
                  {errors.domain && <p className="text-xs text-destructive">{errors.domain}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Base Path</Label>
                  <Input value={form.basePath} onChange={(e) => set("basePath", e.target.value)} placeholder="/api (optional)" />
                  {errors.basePath && <p className="text-xs text-destructive">{errors.basePath}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Listen Port</Label>
                  <Input type="number" value={form.listenPort} onChange={(e) => set("listenPort", e.target.value)} />
                  {errors.listenPort && <p className="text-xs text-destructive">{errors.listenPort}</p>}
                </div>
                <div className="space-y-1">
                  <Label>HTTPS Port</Label>
                  <Input type="number" value={form.httpsPort} onChange={(e) => set("httpsPort", e.target.value)} />
                  {errors.httpsPort && <p className="text-xs text-destructive">{errors.httpsPort}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={form.sslEnabled} onCheckedChange={(v) => set("sslEnabled", v)} />
                <Label>SSL enabled</Label>
              </div>

              {form.sslEnabled && (
                <div className="space-y-1">
                  <Label>Certificate</Label>
                  <Select value={form.certificateId} onValueChange={(v) => set("certificateId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select a certificate" /></SelectTrigger>
                    <SelectContent>
                      {certs.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.domain}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Max requests/sec (server safety limit)</Label>
                  <Input
                    type="number"
                    value={form.maxRequestsPerSecond}
                    onChange={(e) => set("maxRequestsPerSecond", e.target.value)}
                    placeholder="Optional — falls back for routes with no limit of their own"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Max body size (MB)</Label>
                  <Input
                    type="number"
                    value={form.maxBodySizeMb}
                    onChange={(e) => set("maxBodySizeMb", e.target.value)}
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={form.corsEnabled} onCheckedChange={(v) => set("corsEnabled", v)} />
                <Label>CORS enabled (permissive — allows any origin)</Label>
              </div>
            </TabsContent>

            <TabsContent value="routes" className="mt-4">
              <ApiRoutesEditor apiId={api?.id ?? null} apiDomain={form.domain} apiBasePath={form.basePath} />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isEditing ? "Save Changes" : "Create API"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
