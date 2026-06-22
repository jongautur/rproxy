"use client";

import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

const EMPTY = { domain: "", certificate: "", privateKey: "", chain: "" };

export function UploadCertDialog({ open, onOpenChange, onUploaded }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function reset() {
    setForm({ ...EMPTY });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/certificates/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: form.domain,
          certificate: form.certificate,
          privateKey: form.privateKey,
          chain: form.chain || undefined,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string };

      if (!json.success) {
        toast({ variant: "destructive", title: "Upload failed", description: json.error });
        return;
      }

      toast({ title: "Certificate uploaded", description: form.domain });
      reset();
      onUploaded();
    } catch {
      toast({ variant: "destructive", title: "Upload failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Upload Custom Certificate
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="domain">Domain</Label>
            <Input
              id="domain"
              placeholder="example.com or *.example.com"
              value={form.domain}
              onChange={(e) => set("domain", e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="certificate">Certificate (PEM)</Label>
            <Textarea
              id="certificate"
              placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
              value={form.certificate}
              onChange={(e) => set("certificate", e.target.value)}
              className="font-mono text-xs h-32 resize-none"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="privateKey">Private Key (PEM)</Label>
            <Textarea
              id="privateKey"
              placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
              value={form.privateKey}
              onChange={(e) => set("privateKey", e.target.value)}
              className="font-mono text-xs h-32 resize-none"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chain">
              CA Chain / Fullchain (PEM){" "}
              <span className="text-muted-foreground font-normal">— optional</span>
            </Label>
            <Textarea
              id="chain"
              placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
              value={form.chain}
              onChange={(e) => set("chain", e.target.value)}
              className="font-mono text-xs h-24 resize-none"
            />
            <p className="text-xs text-muted-foreground">
              If omitted, the certificate itself is used as the fullchain.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Upload certificate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
