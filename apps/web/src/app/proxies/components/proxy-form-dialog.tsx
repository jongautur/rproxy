"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp, PlusCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { cn, daysUntil } from "@/lib/utils";
import type { ProxyHostWithCert } from "@/types/proxy";
import type { AccessListWithRelations } from "@/types/access-list";
import { IssueCertDialog } from "@/app/certificates/components/issue-cert-dialog";

interface CertOption { id: string; domain: string; expiresAt: string | null; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proxy: ProxyHostWithCert | null;
  onSaved: () => void;
}

interface FormState {
  domain: string;
  forwardScheme: "http" | "https" | "grpc" | "grpcs";
  forwardHost: string;
  forwardPort: string;
  listenPort: string;
  httpsPort: string;
  sslEnabled: boolean;
  forceHttps: boolean;
  http2: boolean;
  websocket: boolean;
  accessLog: boolean;
  errorLog: boolean;
  customLocations: string;
  customServer: string;
  certificateId: string;
  accessListId: string | null;
}

const DEFAULT: FormState = {
  domain: "",
  forwardScheme: "http",
  forwardHost: "",
  forwardPort: "80",
  listenPort: "80",
  httpsPort: "443",
  sslEnabled: false,
  forceHttps: false,
  http2: false,
  websocket: false,
  accessLog: false,
  errorLog: true,
  customLocations: "",
  customServer: "",
  certificateId: "",
  accessListId: null,
};

interface NginxTestResult {
  success: boolean;
  output: string;
}

export function ProxyFormDialog({ open, onOpenChange, proxy, onSaved }: Props) {
  const { toast } = useToast();
  const isEdit = !!proxy;

  const [form, setForm] = useState<FormState>(DEFAULT);
  const [portMode, setPortMode] = useState<"80" | "443" | "custom">("80");
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<NginxTestResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [certs, setCerts] = useState<CertOption[]>([]);
  const [accessLists, setAccessLists] = useState<Pick<AccessListWithRelations, "id" | "name" | "authEnabled" | "ipRules">[]>([]);
  const [showIssueCert, setShowIssueCert] = useState(false);

  async function handleCertIssued() {
    setShowIssueCert(false);
    // Re-fetch certs and auto-select the one matching this proxy's domain
    try {
      const r = await fetch("/api/certificates?perPage=100");
      const j = await r.json() as { success: boolean; data: { items: CertOption[] } };
      if (j.success) {
        setCerts(j.data.items);
        const d = form.domain.trim().toLowerCase();
        const match = j.data.items.find((cert) =>
          cert.domain === d ||
          cert.domain === `*.${d.split(".").slice(1).join(".")}`
        );
        if (match) set("certificateId", match.id);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (open) {
      if (proxy) {
        const fp = String(proxy.forwardPort);
        setForm({
          domain: proxy.domain,
          forwardScheme: (proxy.forwardScheme ?? "http") as "http" | "https" | "grpc" | "grpcs",
          forwardHost: proxy.forwardHost,
          forwardPort: fp,
          listenPort: String(proxy.listenPort),
          httpsPort: String(proxy.httpsPort),
          sslEnabled: proxy.sslEnabled,
          forceHttps: proxy.forceHttps,
          http2: proxy.http2,
          websocket: proxy.websocket,
          accessLog: proxy.accessLog,
          errorLog: proxy.errorLog,
          customLocations: proxy.customLocations ?? "",
          customServer: proxy.customServer ?? "",
          certificateId: proxy.certificateId ?? "",
          accessListId: (proxy as { accessListId?: string | null }).accessListId ?? null,
        });
        setPortMode(fp === "80" ? "80" : fp === "443" ? "443" : "custom");
      } else {
        setForm(DEFAULT);
        setPortMode("80");
      }
      setTestResult(null);
      setErrors({});
      setShowAdvanced(false);

      // Load active certificates for the selector
      fetch("/api/certificates?perPage=100")
        .then((r) => r.json() as Promise<{ success: boolean; data: { items: CertOption[] } }>)
        .then((j) => { if (j.success) setCerts(j.data.items); })
        .catch(() => {});

      // Load access lists for the selector
      fetch("/api/access-lists")
        .then((r) => r.json() as Promise<{ success: boolean; data: { lists: Array<{ id: string; name: string; authEnabled: boolean; ipRules: unknown[] }> } }>)
        .then((j) => { if (j.success) setAccessLists(j.data.lists as typeof accessLists); })
        .catch(() => {});
    }
  }, [open, proxy]);


  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.domain.trim()) e.domain = "Domain is required";
    if (!form.forwardHost.trim()) e.forwardHost = "Forward host is required";
    const port = parseInt(form.forwardPort, 10);
    if (!port || port < 1 || port > 65535) e.forwardPort = "Port must be 1–65535";
    const lport = parseInt(form.listenPort, 10);
    if (!lport || lport < 1 || lport > 65535) e.listenPort = "Port must be 1–65535";
    if (form.sslEnabled) {
      const hport = parseInt(form.httpsPort, 10);
      if (!hport || hport < 1 || hport > 65535) e.httpsPort = "Port must be 1–65535";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    try {
      const body = {
        domain: form.domain.trim().toLowerCase(),
        forwardScheme: form.forwardScheme,
        forwardHost: form.forwardHost.trim(),
        forwardPort: parseInt(form.forwardPort, 10),
        listenPort: parseInt(form.listenPort, 10),
        httpsPort: parseInt(form.httpsPort, 10),
        sslEnabled: form.sslEnabled,
        forceHttps: form.forceHttps,
        http2: form.http2,
        websocket: form.websocket,
        accessLog: form.accessLog,
        errorLog: form.errorLog,
        customLocations: form.customLocations.trim() || undefined,
        customServer: form.customServer.trim() || undefined,
        certificateId: form.certificateId || undefined,
        accessListId: form.accessListId ?? null,
      };

      const url = isEdit ? `/api/proxies/${proxy!.id}` : "/api/proxies";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { proxy: unknown; nginxTest: NginxTestResult };
        error?: string;
        details?: Record<string, string[]>;
      };

      if (!res.ok) {
        if (json.details) {
          const e: Record<string, string> = {};
          for (const [k, v] of Object.entries(json.details)) {
            e[k] = v[0] ?? "Invalid";
          }
          setErrors(e);
        } else {
          toast({ variant: "destructive", title: "Save failed", description: json.error });
        }
        return;
      }

      setTestResult(json.data?.nginxTest ?? null);

      if (json.data?.nginxTest?.success === false) {
        toast({
          variant: "destructive",
          title: "Proxy saved but nginx config failed",
          description: "Check the test output below",
        });
        return;
      }

      toast({ title: isEdit ? "Proxy updated" : "Proxy created", description: form.domain });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Proxy Host" : "Add Proxy Host"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general">
          <TabsList className="w-full">
            <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
            <TabsTrigger value="ssl" className="flex-1">SSL</TabsTrigger>
            <TabsTrigger value="advanced" className="flex-1">Advanced</TabsTrigger>
            <TabsTrigger value="access" className="flex-1">Access</TabsTrigger>
          </TabsList>

          {/* ── General ───────────────────────────────────────────────── */}
          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="domain">
                  Domain Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="domain"
                  placeholder="example.com"
                  value={form.domain}
                  onChange={(e) => set("domain", e.target.value)}
                  className={errors.domain ? "border-destructive" : ""}
                  disabled={isEdit}
                />
                {errors.domain && <p className="text-xs text-destructive">{errors.domain}</p>}
              </div>

              <div className="space-y-2">
                <Label>Scheme</Label>
                <div className="flex gap-1">
                  {(["http", "https", "grpc", "grpcs"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => set("forwardScheme", s)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        form.forwardScheme === s
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/40"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="forwardHost">
                  Forward Hostname / IP <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="forwardHost"
                  placeholder="localhost or 192.168.1.10"
                  value={form.forwardHost}
                  onChange={(e) => set("forwardHost", e.target.value)}
                  className={errors.forwardHost ? "border-destructive" : ""}
                />
                {errors.forwardHost && <p className="text-xs text-destructive">{errors.forwardHost}</p>}
              </div>

              <div className="space-y-2">
                <Label>
                  Forward Port <span className="text-destructive">*</span>
                </Label>
                <div className="flex gap-1">
                  {(["80", "443", "custom"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setPortMode(m);
                        if (m !== "custom") set("forwardPort", m);
                      }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        portMode === m
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/40"
                      }`}
                    >
                      {m === "custom" ? "Custom" : m}
                    </button>
                  ))}
                  {portMode === "custom" && (
                    <Input
                      id="forwardPort"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="8080"
                      value={form.forwardPort === "80" || form.forwardPort === "443" ? "" : form.forwardPort}
                      onChange={(e) => set("forwardPort", e.target.value)}
                      className={`w-24 ${errors.forwardPort ? "border-destructive" : ""}`}
                    />
                  )}
                </div>
                {errors.forwardPort && <p className="text-xs text-destructive">{errors.forwardPort}</p>}
              </div>

              {!form.sslEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor="listenPort">
                    Listen Port <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="listenPort"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="80"
                    value={form.listenPort}
                    onChange={(e) => set("listenPort", e.target.value)}
                    className={errors.listenPort ? "border-destructive" : ""}
                  />
                  {errors.listenPort && <p className="text-xs text-destructive">{errors.listenPort}</p>}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="listenPort">
                      HTTP Port <span className="text-muted-foreground text-xs">(redirect)</span>
                    </Label>
                    <Input
                      id="listenPort"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="80"
                      value={form.listenPort}
                      onChange={(e) => set("listenPort", e.target.value)}
                      className={errors.listenPort ? "border-destructive" : ""}
                    />
                    {errors.listenPort && <p className="text-xs text-destructive">{errors.listenPort}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="httpsPort">
                      HTTPS Port <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="httpsPort"
                      type="number"
                      min={1}
                      max={65535}
                      placeholder="443"
                      value={form.httpsPort}
                      onChange={(e) => set("httpsPort", e.target.value)}
                      className={errors.httpsPort ? "border-destructive" : ""}
                    />
                    {errors.httpsPort && <p className="text-xs text-destructive">{errors.httpsPort}</p>}
                  </div>
                </>
              )}
            </div>

            {/* Feature toggles */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {(
                [
                  { key: "websocket", label: "WebSocket Support", desc: "Enables WS/WSS upgrade headers" },
                  { key: "http2",     label: "HTTP/2 Support",    desc: "Requires SSL to be enabled" },
                  { key: "accessLog", label: "Access Logging",    desc: "Log all requests to file" },
                  { key: "errorLog",  label: "Error Logging",     desc: "Log errors to file" },
                ] as const
              ).map(({ key, label, desc }) => (
                <div key={key} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border/50 bg-accent/20">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <Switch
                    checked={form[key]}
                    onCheckedChange={(v) => set(key, v)}
                  />
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── SSL ──────────────────────────────────────────────────── */}
          <TabsContent value="ssl" className="space-y-4 mt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-accent/20">
                <div>
                  <p className="text-sm font-medium">Enable SSL</p>
                  <p className="text-xs text-muted-foreground">Serve this proxy over HTTPS</p>
                </div>
                <Switch
                  checked={form.sslEnabled}
                  onCheckedChange={(v) => set("sslEnabled", v)}
                />
              </div>

              {form.sslEnabled && (
                <div className="flex items-center justify-between p-4 rounded-lg border border-border/50 bg-accent/20">
                  <div>
                    <p className="text-sm font-medium">Force HTTPS</p>
                    <p className="text-xs text-muted-foreground">Redirect all HTTP traffic to HTTPS</p>
                  </div>
                  <Switch
                    checked={form.forceHttps}
                    onCheckedChange={(v) => set("forceHttps", v)}
                  />
                </div>
              )}

              {form.sslEnabled && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>SSL Certificate</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setShowIssueCert(true)}
                    >
                      <PlusCircle className="w-3 h-3" />
                      Issue New
                    </Button>
                  </div>
                  <Select
                    value={form.certificateId || "none"}
                    onValueChange={(v) => set("certificateId", v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a certificate…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No certificate selected</SelectItem>
                      {certs.map((cert) => {
                        const days = cert.expiresAt ? daysUntil(cert.expiresAt) : null;
                        return (
                          <SelectItem key={cert.id} value={cert.id}>
                            {cert.domain}
                            {days !== null && (
                              <span className={`ml-2 text-xs ${days < 30 ? "text-warning" : "text-muted-foreground"}`}>
                                ({days}d)
                              </span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {certs.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No active certificates yet — click &quot;Issue New&quot; above.
                    </p>
                  )}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Advanced ─────────────────────────────────────────────── */}
          <TabsContent value="advanced" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="customLocations">Custom Location Directives</Label>
              <p className="text-xs text-muted-foreground">
                Injected inside the <code className="bg-muted px-1 rounded">location /</code> block. One directive per line.
              </p>
              <Textarea
                id="customLocations"
                placeholder={"proxy_cache my_cache;\nclient_max_body_size 100m;"}
                value={form.customLocations}
                onChange={(e) => set("customLocations", e.target.value)}
                rows={5}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="customServer">Custom Server Directives</Label>
              <p className="text-xs text-muted-foreground">
                Injected inside the <code className="bg-muted px-1 rounded">server</code> block.
              </p>
              <Textarea
                id="customServer"
                placeholder={"error_page 502 /502.html;"}
                value={form.customServer}
                onChange={(e) => set("customServer", e.target.value)}
                rows={4}
              />
            </div>
            <div className="rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs text-muted-foreground">
              Custom directives are validated against a blocklist. Lua, exec, and include path-traversal directives are rejected.
            </div>
          </TabsContent>

          {/* ── Access ───────────────────────────────────────────────────── */}
          <TabsContent value="access" className="space-y-4 mt-4">
            <div>
              <p className="text-sm font-medium">Access List</p>
              <p className="text-xs text-muted-foreground mt-0.5">Restrict this host by IP or require Basic Auth</p>
            </div>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.accessListId ?? ""}
              onChange={(e) => set("accessListId", e.target.value || null)}
            >
              <option value="">No restriction</option>
              {accessLists.map((al) => (
                <option key={al.id} value={al.id}>
                  {al.name}
                  {al.authEnabled ? " (Basic Auth)" : ""}
                  {al.ipRules.length > 0 ? ` · ${al.ipRules.length} IP rule${al.ipRules.length !== 1 ? "s" : ""}` : ""}
                </option>
              ))}
            </select>
            {accessLists.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No access lists yet — create one in the{" "}
                <a href="/access-lists" target="_blank" className="underline hover:text-foreground">Access Lists</a>{" "}
                page, then come back here.
              </p>
            )}
          </TabsContent>
        </Tabs>

        {/* Nginx test result */}
        {testResult && (
          <div className={cn(
            "rounded-lg p-3 text-xs font-mono mt-2",
            testResult.success ? "bg-success/10 border border-success/20 text-success" : "bg-destructive/10 border border-destructive/20 text-destructive"
          )}>
            <div className="flex items-center gap-2 mb-1 font-sans font-medium">
              {testResult.success
                ? <><CheckCircle2 className="w-4 h-4" /> Config test passed</>
                : <><XCircle className="w-4 h-4" /> Config test failed</>
              }
            </div>
            <pre className="whitespace-pre-wrap opacity-80">{testResult.output}</pre>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : (isEdit ? "Save Changes" : "Create Proxy")}
          </Button>
        </DialogFooter>
      </DialogContent>

      <IssueCertDialog
        open={showIssueCert}
        onOpenChange={setShowIssueCert}
        defaultDomain={form.domain.trim().toLowerCase()}
        onIssued={handleCertIssued}
      />
    </Dialog>
  );
}
