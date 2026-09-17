"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CloudCog, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatRelativeTime } from "@/lib/utils";

interface CloudflareStatus {
  configured: boolean;
  ddnsEnabled: boolean;
  autoDnsEnabled: boolean;
  defaultProxied: boolean;
  proxyAfterSsl: boolean;
  deleteDnsWithHost: boolean;
  lastPublicIp: string | null;
  lastCheckedAt: string | null;
}

export function CloudflareTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState<CloudflareStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/cloudflare");
      const json = await res.json() as { success: boolean; data: CloudflareStatus };
      if (json.success) setStatus(json.data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchStatus(); }, [fetchStatus]);

  async function handleSaveToken(e: React.FormEvent) {
    e.preventDefault();
    if (!apiToken.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/cloudflare", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: apiToken.trim() }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        toast({ variant: "destructive", title: "Connection failed", description: json.error });
        return;
      }
      toast({ title: "Connected to Cloudflare" });
      setApiToken("");
      void fetchStatus();
    } catch { toast({ variant: "destructive", title: "Save failed" }); }
    finally { setSaving(false); }
  }

  async function handleToggle(key: "ddnsEnabled" | "autoDnsEnabled" | "defaultProxied" | "proxyAfterSsl" | "deleteDnsWithHost", value: boolean) {
    try {
      const res = await fetch("/api/settings/cloudflare", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        toast({ variant: "destructive", title: "Update failed", description: json.error });
        return;
      }
      void fetchStatus();
    } catch { toast({ variant: "destructive", title: "Update failed" }); }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/settings/cloudflare/sync", { method: "POST" });
      const json = await res.json() as {
        success: boolean;
        data?: { linked: number; alreadyLinked: number; notFound: number; errors: string[] };
        error?: string;
      };
      if (!json.success || !json.data) {
        toast({ variant: "destructive", title: "Sync failed", description: json.error });
        return;
      }
      const { linked, notFound, errors } = json.data;
      toast({
        title: "Sync complete",
        description: `${linked} host${linked === 1 ? "" : "s"} linked, ${notFound} with no matching record${errors.length ? `, ${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}`,
      });
    } catch { toast({ variant: "destructive", title: "Sync failed" }); }
    finally { setSyncing(false); }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/settings/cloudflare", { method: "DELETE" });
      toast({ title: "Disconnected from Cloudflare" });
      void fetchStatus();
    } catch { toast({ variant: "destructive", title: "Disconnect failed" }); }
    finally { setDisconnecting(false); setConfirmDisconnect(false); }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CloudCog className="w-4 h-4 text-primary" />
              Cloudflare
            </CardTitle>
            {status && (
              <Badge variant={status.configured ? "success" : "secondary"}>
                {status.configured ? "Connected" : "Not connected"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Connect a Cloudflare API token to automatically create DNS records for new proxies and keep them in sync with this server&apos;s public IP.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              <form onSubmit={handleSaveToken} className="space-y-3">
                <div className="space-y-1.5">
                  <Label>API Token</Label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder={status?.configured ? "Enter a new token to replace the current one" : "Cloudflare API token (Zone:DNS edit)"}
                      value={apiToken}
                      onChange={(e) => setApiToken(e.target.value)}
                    />
                    <Button type="submit" disabled={saving || !apiToken.trim()}>
                      {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {status?.configured ? "Update" : "Connect"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Create a token at Cloudflare → My Profile → API Tokens with Zone:DNS edit permission for the zones you want rproxy to manage.
                  </p>
                </div>
              </form>

              {status?.configured && (
                <>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Dynamic DNS</p>
                      <p className="text-xs text-muted-foreground">Keep matching A records in sync when this server&apos;s public IP changes.</p>
                    </div>
                    <Switch checked={status.ddnsEnabled} onCheckedChange={(v) => handleToggle("ddnsEnabled", v)} />
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Automatic DNS records</p>
                      <p className="text-xs text-muted-foreground">Create an A record automatically when a new proxy is created or a certificate is issued.</p>
                    </div>
                    <Switch checked={status.autoDnsEnabled} onCheckedChange={(v) => handleToggle("autoDnsEnabled", v)} />
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Sync existing hosts</p>
                      <p className="text-xs text-muted-foreground">Link hosts created before Cloudflare was connected to their existing DNS records. Read-only — never creates or changes a record.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
                      {syncing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                      Sync
                    </Button>
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Proxy new DNS records by default</p>
                      <p className="text-xs text-muted-foreground">Records created before a certificate exists stay DNS-only (grey cloud) unless enabled.</p>
                    </div>
                    <Switch checked={status.defaultProxied} onCheckedChange={(v) => handleToggle("defaultProxied", v)} />
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Enable Cloudflare proxy after SSL is issued</p>
                      <p className="text-xs text-muted-foreground">Automatically switch a domain&apos;s record to proxied (orange cloud) once its certificate is active.</p>
                    </div>
                    <Switch checked={status.proxyAfterSsl} onCheckedChange={(v) => handleToggle("proxyAfterSsl", v)} />
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 rounded-lg border border-border/50 bg-accent/20">
                    <div>
                      <p className="text-sm font-medium">Delete DNS record with host</p>
                      <p className="text-xs text-muted-foreground">When a proxy is deleted, also delete the Cloudflare A record rproxy created for it.</p>
                    </div>
                    <Switch checked={status.deleteDnsWithHost} onCheckedChange={(v) => handleToggle("deleteDnsWithHost", v)} />
                  </div>

                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Last known public IP: <span className="font-medium text-foreground">{status.lastPublicIp ?? "not checked yet"}</span></p>
                    {status.lastCheckedAt && <p>Last checked {formatRelativeTime(status.lastCheckedAt)}</p>}
                  </div>

                  <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </Button>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Cloudflare?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the stored API token and disables DDNS and automatic DNS record creation. Existing DNS records in Cloudflare are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
