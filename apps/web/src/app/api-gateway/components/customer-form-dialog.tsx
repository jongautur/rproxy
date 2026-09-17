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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import type { CustomerWithRelations } from "@/types/api-gateway";
import { CustomerKeysEditor } from "./customer-keys-editor";
import { CustomerAccessEditor } from "./customer-access-editor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: CustomerWithRelations | null;
  onSaved: () => void;
}

interface FormState {
  name: string;
  email: string;
  notes: string;
  enabled: boolean;
}

const DEFAULT: FormState = { name: "", email: "", notes: "", enabled: true };

export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  // Tracks the id of a customer created during this dialog session, so the
  // Keys/Access tabs work immediately after "Create" without requiring the
  // admin to close and reopen the dialog.
  const [savedId, setSavedId] = useState<string | null>(null);

  const isEditing = !!customer;

  useEffect(() => {
    if (!open) return;
    setActiveTab("general");
    if (customer) {
      setForm({ name: customer.name, email: customer.email ?? "", notes: customer.notes ?? "", enabled: customer.enabled });
      setSavedId(customer.id);
    } else {
      setForm(DEFAULT);
      setSavedId(null);
    }
    setErrors({});
  }, [open, customer]);

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
      email: form.email || undefined,
      notes: form.notes || undefined,
      enabled: form.enabled,
    };

    try {
      const res = savedId
        ? await fetch(`/api/gateway/customers/${savedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/gateway/customers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const json = (await res.json()) as { success: boolean; data?: { id: string }; error?: string; details?: Record<string, string[]> };

      if (json.success) {
        toast({ title: savedId ? "Customer updated" : "Customer created" });
        if (!savedId && json.data) {
          // First save of a brand-new customer — stay open so Keys/Access
          // tabs become usable, matching the "save API first" pattern used
          // by the Routes tab on the API form.
          setSavedId(json.data.id);
        } else {
          onSaved();
        }
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
          <DialogTitle>{isEditing || savedId ? "Edit Customer" : "Add Customer"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="keys">API Keys</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme Corp" />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Optional" />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" rows={3} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
                <Label>Enabled</Label>
              </div>
            </TabsContent>

            <TabsContent value="keys" className="mt-4">
              <CustomerKeysEditor customerId={savedId} />
            </TabsContent>

            <TabsContent value="access" className="mt-4">
              <CustomerAccessEditor customerId={savedId} />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {savedId ? "Save Changes" : "Create Customer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
