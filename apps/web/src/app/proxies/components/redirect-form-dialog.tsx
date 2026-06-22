"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { RedirectHostWithCert } from "@/types/redirect";

interface Certificate { id: string; domain: string; status: string }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  redirect: RedirectHostWithCert | null;
  onSaved: () => void;
}

const EMPTY = {
  sourceDomain: "",
  destination: "",
  redirectCode: 301 as 301 | 302,
  preservePath: true,
  sslEnabled: false,
  certificateId: "",
};

export function RedirectFormDialog({ open, onOpenChange, redirect, onSaved }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [form, setForm] = useState({ ...EMPTY });

  useEffect(() => {
    if (!open) return;
    if (redirect) {
      setForm({
        sourceDomain: redirect.sourceDomain,
        destination: redirect.destination,
        redirectCode: redirect.redirectCode as 301 | 302,
        preservePath: redirect.preservePath,
        sslEnabled: redirect.sslEnabled,
        certificateId: redirect.certificateId ?? "",
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [open, redirect]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/certificates")
      .then((r) => r.json() as Promise<{ success: boolean; data: { items: Certificate[] } }>)
      .then((j) => { if (j.success) setCerts(j.data.items.filter((c) => c.status === "ACTIVE")); })
      .catch(() => {});
  }, [open]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...form,
        redirectCode: Number(form.redirectCode),
        certificateId: form.certificateId || undefined,
      };

      const url = redirect ? `/api/redirects/${redirect.id}` : "/api/redirects";
      const method = redirect ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { nginxResult?: { success: boolean; output: string } } };

      if (!json.success) {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
        return;
      }

      const nginxResult = json.data?.nginxResult;
      if (nginxResult && !nginxResult.success) {
        toast({ variant: "destructive", title: "Nginx error", description: nginxResult.output });
        return;
      }

      toast({ title: redirect ? "Redirect updated" : "Redirect created" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{redirect ? "Edit Redirect" : "Add Redirect Host"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source domain */}
          <div className="space-y-1.5">
            <Label htmlFor="sourceDomain">Source domain</Label>
            <Input
              id="sourceDomain"
              placeholder="old.example.com"
              value={form.sourceDomain}
              onChange={(e) => set("sourceDomain", e.target.value)}
              disabled={!!redirect}
              required
            />
            {redirect && (
              <p className="text-xs text-muted-foreground">Source domain cannot be changed after creation</p>
            )}
          </div>

          {/* Destination */}
          <div className="space-y-1.5">
            <Label htmlFor="destination">Destination URL</Label>
            <Input
              id="destination"
              placeholder="https://new.example.com"
              value={form.destination}
              onChange={(e) => set("destination", e.target.value)}
              required
            />
          </div>

          {/* Redirect code */}
          <div className="space-y-1.5">
            <Label>Redirect type</Label>
            <Select
              value={String(form.redirectCode)}
              onValueChange={(v) => set("redirectCode", Number(v) as 301 | 302)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="301">301 — Permanent (cached by browsers)</SelectItem>
                <SelectItem value="302">302 — Temporary</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Toggles */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Preserve path</p>
                <p className="text-xs text-muted-foreground">Append the request path to the destination</p>
              </div>
              <Switch checked={form.preservePath} onCheckedChange={(v) => set("preservePath", v)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">SSL on source</p>
                <p className="text-xs text-muted-foreground">Terminate SSL on the source domain</p>
              </div>
              <Switch checked={form.sslEnabled} onCheckedChange={(v) => set("sslEnabled", v)} />
            </div>
          </div>

          {/* Certificate (only when SSL enabled) */}
          {form.sslEnabled && (
            <div className="space-y-1.5">
              <Label>Certificate</Label>
              <Select
                value={form.certificateId}
                onValueChange={(v) => set("certificateId", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a certificate" />
                </SelectTrigger>
                <SelectContent>
                  {certs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.domain}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {redirect ? "Save changes" : "Create redirect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
