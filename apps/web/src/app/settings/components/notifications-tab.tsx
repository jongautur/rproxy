"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, Send, Globe, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";

interface Channel {
  id: string;
  type: "email" | "webhook";
  label: string;
  enabled: boolean;
  config: Record<string, string>;
}

const EMAIL_EMPTY = { label: "Email", host: "", port: "587", secure: "false", username: "", password: "", from: "", to: "" };
const WEBHOOK_EMPTY = { label: "Webhook", url: "", secret: "" };

export function NotificationsTab() {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"email" | "webhook">("email");
  const [emailForm, setEmailForm] = useState({ ...EMAIL_EMPTY });
  const [webhookForm, setWebhookForm] = useState({ ...WEBHOOK_EMPTY });
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/notifications");
      const json = await res.json() as { success: boolean; data: { channels: Channel[] } };
      if (json.success) setChannels(json.data.channels);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetch_(); }, [fetch_]);

  async function handleToggle(ch: Channel) {
    await fetch(`/api/settings/notifications/${ch.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: ch.label, enabled: !ch.enabled }),
    });
    void fetch_();
  }

  async function handleDelete(ch: Channel) {
    setDeleting(true);
    try {
      await fetch(`/api/settings/notifications/${ch.id}`, { method: "DELETE" });
      toast({ title: "Channel deleted" });
      void fetch_();
    } catch { toast({ variant: "destructive", title: "Delete failed" }); }
    finally { setDeleting(false); setDeleteTarget(null); }
  }

  async function handleTest(ch: Channel) {
    setTestingId(ch.id);
    try {
      const res = await fetch(`/api/settings/notifications/${ch.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const json = await res.json() as { success: boolean; data: { success: boolean; error?: string } };
      if (json.data?.success) {
        toast({ title: "Test sent successfully" });
      } else {
        toast({ variant: "destructive", title: "Test failed", description: json.data?.error });
      }
    } catch { toast({ variant: "destructive", title: "Test failed" }); }
    finally { setTestingId(null); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = addType === "email"
        ? { type: "email", ...emailForm, port: parseInt(emailForm.port), secure: emailForm.secure === "true" }
        : { type: "webhook", ...webhookForm };

      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) { toast({ variant: "destructive", title: "Failed", description: json.error }); return; }
      toast({ title: "Notification channel added" });
      setAddOpen(false);
      setEmailForm({ ...EMAIL_EMPTY });
      setWebhookForm({ ...WEBHOOK_EMPTY });
      void fetch_();
    } catch { toast({ variant: "destructive", title: "Save failed" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Notification Channels</CardTitle>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Channel
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Receive alerts when a proxy host goes down, a certificate is about to expire, or renewal fails.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : channels.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No channels configured.</p>
          ) : (
            <div className="space-y-3">
              {channels.map((ch) => (
                <div key={ch.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                  <div className="flex items-center gap-3">
                    {ch.type === "email"
                      ? <Mail className="w-4 h-4 text-primary" />
                      : <Globe className="w-4 h-4 text-primary" />
                    }
                    <div>
                      <p className="text-sm font-medium">{ch.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {ch.type === "email" ? ch.config.to : ch.config.url}
                      </p>
                    </div>
                    <Badge variant={ch.enabled ? "success" : "secondary"} className="ml-2">
                      {ch.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm" variant="outline"
                      onClick={() => handleTest(ch)}
                      disabled={testingId === ch.id}
                    >
                      {testingId === ch.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Send className="w-4 h-4" />
                      }
                      <span className="ml-1.5">Test</span>
                    </Button>
                    <Switch checked={ch.enabled} onCheckedChange={() => handleToggle(ch)} />
                    <Button
                      size="icon-sm" variant="ghost"
                      className="hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(ch)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add channel dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Notification Channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Channel type</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as "email" | "webhook")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (SMTP)</SelectItem>
                  <SelectItem value="webhook">Webhook (HTTP POST)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addType === "email" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input value={emailForm.label} onChange={(e) => setEmailForm((p) => ({ ...p, label: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>SMTP Host</Label>
                    <Input placeholder="smtp.example.com" value={emailForm.host} onChange={(e) => setEmailForm((p) => ({ ...p, host: e.target.value }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input type="number" value={emailForm.port} onChange={(e) => setEmailForm((p) => ({ ...p, port: e.target.value }))} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input value={emailForm.username} onChange={(e) => setEmailForm((p) => ({ ...p, username: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password</Label>
                    <Input type="password" value={emailForm.password} onChange={(e) => setEmailForm((p) => ({ ...p, password: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input type="email" placeholder="rproxy@example.com" value={emailForm.from} onChange={(e) => setEmailForm((p) => ({ ...p, from: e.target.value }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="email" placeholder="admin@example.com" value={emailForm.to} onChange={(e) => setEmailForm((p) => ({ ...p, to: e.target.value }))} required />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="secure"
                    checked={emailForm.secure === "true"}
                    onCheckedChange={(v) => setEmailForm((p) => ({ ...p, secure: String(v) }))}
                  />
                  <Label htmlFor="secure">TLS (port 465)</Label>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input value={webhookForm.label} onChange={(e) => setWebhookForm((p) => ({ ...p, label: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Webhook URL</Label>
                  <Input type="url" placeholder="https://hooks.example.com/..." value={webhookForm.url} onChange={(e) => setWebhookForm((p) => ({ ...p, url: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Secret <span className="text-muted-foreground font-normal">— optional</span></Label>
                  <Input placeholder="Sent as X-Webhook-Secret header" value={webhookForm.secret} onChange={(e) => setWebhookForm((p) => ({ ...p, secret: e.target.value }))} />
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add channel
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete channel?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-semibold text-foreground">{deleteTarget?.label}</span> — you will no longer receive notifications through this channel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
