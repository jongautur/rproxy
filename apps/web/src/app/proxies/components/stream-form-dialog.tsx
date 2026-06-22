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
import type { StreamHost } from "@prisma/client";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editingStream?: StreamHost | null;
  onSaved: () => void;
}

type FormState = { name: string; protocol: "TCP" | "UDP" | "TCP_UDP"; listenPort: string; forwardHost: string; forwardPort: string };
const EMPTY: FormState = { name: "", protocol: "TCP", listenPort: "", forwardHost: "", forwardPort: "" };

export function StreamFormDialog({ open, onOpenChange, editingStream, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingStream) {
        setForm({
          name: editingStream.name,
          protocol: editingStream.protocol as FormState["protocol"],
          listenPort: String(editingStream.listenPort),
          forwardHost: editingStream.forwardHost,
          forwardPort: String(editingStream.forwardPort),
        });
      } else {
        setForm(EMPTY);
      }
    }
  }, [open, editingStream]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        protocol: form.protocol,
        listenPort: parseInt(form.listenPort),
        forwardHost: form.forwardHost,
        forwardPort: parseInt(form.forwardPort),
      };
      const url = editingStream ? `/api/streams/${editingStream.id}` : "/api/streams";
      const method = editingStream ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) { toast({ variant: "destructive", title: "Failed", description: json.error }); return; }
      toast({ title: editingStream ? "Stream host updated" : "Stream host created" });
      onOpenChange(false);
      onSaved();
    } catch { toast({ variant: "destructive", title: "Save failed" }); }
    finally { setSaving(false); }
  }

  const set = (k: keyof typeof form) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingStream ? "Edit Stream Host" : "Add Stream Host"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="postgres-db" value={form.name} onChange={(e) => set("name")(e.target.value)} disabled={!!editingStream} required />
            <p className="text-xs text-muted-foreground">A label for this stream host.</p>
          </div>

          <div className="space-y-1.5">
            <Label>Protocol</Label>
            <Select value={form.protocol} onValueChange={set("protocol")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TCP">TCP</SelectItem>
                <SelectItem value="UDP">UDP</SelectItem>
                <SelectItem value="TCP_UDP">TCP + UDP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Listen port</Label>
            <Input type="number" min={1} max={65535} placeholder="5432" value={form.listenPort} onChange={(e) => set("listenPort")(e.target.value)} required />
            <p className="text-xs text-muted-foreground">Port nginx will listen on. Must not conflict with ports 80, 443, or 81.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Forward host</Label>
              <Input placeholder="192.168.1.10" value={form.forwardHost} onChange={(e) => set("forwardHost")(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Forward port</Label>
              <Input type="number" min={1} max={65535} placeholder="5432" value={form.forwardPort} onChange={(e) => set("forwardPort")(e.target.value)} required />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingStream ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
