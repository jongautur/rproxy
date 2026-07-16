"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Loader2, Send, Globe, Mail, Home, Pencil } from "lucide-react";
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
  type: "email" | "webhook" | "home_assistant";
  label: string;
  enabled: boolean;
  config: Record<string, string>;
}

const EMAIL_EMPTY = { label: "Email", host: "", port: "587", secure: "false", username: "", password: "", from: "", to: "" };
const WEBHOOK_EMPTY = { label: "Webhook", url: "", secret: "" };
const HOME_ASSISTANT_EMPTY = { label: "Home Assistant", url: "", accessToken: "", notificationService: "" };
const MASKED = "••••••••";

export function NotificationsTab() {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [addType, setAddType] = useState<"email" | "webhook" | "home_assistant">("email");
  const [emailForm, setEmailForm] = useState({ ...EMAIL_EMPTY });
  const [webhookForm, setWebhookForm] = useState({ ...WEBHOOK_EMPTY });
  const [homeAssistantForm, setHomeAssistantForm] = useState({ ...HOME_ASSISTANT_EMPTY });
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

  const formType = editingChannel?.type ?? addType;

  function openAdd() {
    setEditingChannel(null);
    setAddType("email");
    setEmailForm({ ...EMAIL_EMPTY });
    setWebhookForm({ ...WEBHOOK_EMPTY });
    setHomeAssistantForm({ ...HOME_ASSISTANT_EMPTY });
    setDialogOpen(true);
  }

  function openEdit(ch: Channel) {
    setEditingChannel(ch);
    if (ch.type === "email") {
      setEmailForm({ ...EMAIL_EMPTY, ...ch.config, label: ch.label });
    } else if (ch.type === "home_assistant") {
      setHomeAssistantForm({ ...HOME_ASSISTANT_EMPTY, ...ch.config, label: ch.label });
    } else {
      setWebhookForm({ ...WEBHOOK_EMPTY, ...ch.config, label: ch.label });
    }
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let config: Record<string, unknown>;
      if (formType === "email") {
        config = { ...emailForm, port: parseInt(emailForm.port), secure: emailForm.secure === "true" };
      } else if (formType === "home_assistant") {
        config = { ...homeAssistantForm };
      } else {
        config = { ...webhookForm };
      }

      let res: Response;
      if (editingChannel) {
        // Secret-ish fields are pre-filled with the masked placeholder from
        // the server (their plaintext is never sent back). If left
        // untouched, drop them from the payload so the merge on the
        // backend keeps the existing value instead of overwriting it with
        // the literal mask string.
        const { label, ...rest } = config;
        for (const key of ["password", "secret", "accessToken"]) {
          if (rest[key] === MASKED) delete rest[key];
        }
        res = await fetch(`/api/settings/notifications/${editingChannel.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, enabled: editingChannel.enabled, config: rest }),
        });
      } else {
        res = await fetch("/api/settings/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: formType, ...config }),
        });
      }

      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) { toast({ variant: "destructive", title: "Failed", description: json.error }); return; }
      toast({ title: editingChannel ? "Channel updated" : "Notification channel added" });
      setDialogOpen(false);
      setEditingChannel(null);
      setEmailForm({ ...EMAIL_EMPTY });
      setWebhookForm({ ...WEBHOOK_EMPTY });
      setHomeAssistantForm({ ...HOME_ASSISTANT_EMPTY });
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
            <Button size="sm" onClick={openAdd}>
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
                      : ch.type === "home_assistant"
                      ? <Home className="w-4 h-4 text-primary" />
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
                      onClick={() => openEdit(ch)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
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

      {/* Add/Edit channel dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditingChannel(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingChannel ? "Edit Notification Channel" : "Add Notification Channel"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Channel type</Label>
              <Select
                value={formType}
                onValueChange={(v) => setAddType(v as "email" | "webhook" | "home_assistant")}
                disabled={!!editingChannel}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email (SMTP)</SelectItem>
                  <SelectItem value="webhook">Webhook (HTTP POST)</SelectItem>
                  <SelectItem value="home_assistant">Home Assistant</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formType === "email" ? (
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
                    <Label>Password {editingChannel && <span className="text-muted-foreground font-normal">— leave unchanged to keep current</span>}</Label>
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
            ) : formType === "home_assistant" ? (
              <>
                <div className="space-y-1.5">
                  <Label>Label</Label>
                  <Input value={homeAssistantForm.label} onChange={(e) => setHomeAssistantForm((p) => ({ ...p, label: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Home Assistant URL</Label>
                  <Input type="url" placeholder="https://homeassistant.local:8123" value={homeAssistantForm.url} onChange={(e) => setHomeAssistantForm((p) => ({ ...p, url: e.target.value }))} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Long-Lived Access Token {editingChannel && <span className="text-muted-foreground font-normal">— leave unchanged to keep current</span>}</Label>
                  <Input type="password" placeholder="Profile → Security → Long-lived access tokens" value={homeAssistantForm.accessToken} onChange={(e) => setHomeAssistantForm((p) => ({ ...p, accessToken: e.target.value }))} required={!editingChannel} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notification Service <span className="text-muted-foreground font-normal">— optional</span></Label>
                  <Input placeholder="default: notify all devices" value={homeAssistantForm.notificationService} onChange={(e) => setHomeAssistantForm((p) => ({ ...p, notificationService: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">
                    Find device-specific services under Developer Tools → Services in Home Assistant, search &quot;notify&quot;. Leave blank to notify every configured target.
                  </p>
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
                  <Label>Secret <span className="text-muted-foreground font-normal">— optional{editingChannel && ", leave unchanged to keep current"}</span></Label>
                  <Input placeholder="Sent as X-Webhook-Secret header" value={webhookForm.secret} onChange={(e) => setWebhookForm((p) => ({ ...p, secret: e.target.value }))} />
                </div>
              </>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setEditingChannel(null); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingChannel ? "Save changes" : "Add channel"}
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
