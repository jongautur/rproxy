"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

export function LocalDnsTab() {
  const { toast } = useToast();
  const [form, setForm] = useState({ serverUrl: "", targetIp: "", enabled: false, apiToken: "" });
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    void fetch("/api/settings/local-dns").then(async (res) => {
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setForm({ serverUrl: json.data.serverUrl, targetIp: json.data.targetIp, enabled: json.data.enabled, apiToken: "" });
      setConfigured(json.data.configured);
    }).catch(() => { setLoadError(true); toast({ variant: "destructive", title: "Could not load local DNS settings" }); }).finally(() => setBusy(false));
  }, [toast]);
  async function request(method: string, sync = false) {
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/local-dns${sync ? "/sync" : ""}`, {
        method, headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify(form) } : {}),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Request failed");
      if (sync) toast({ title: "Local DNS sync finished", description: `${json.data.synced} hosts synced. Failed: ${json.data.errors.join(", ") || "none"}` });
      else if (method === "DELETE") {
        setConfigured(false); setForm({ serverUrl: "", targetIp: "", enabled: false, apiToken: "" });
        toast({ title: "Local DNS disconnected" });
      } else {
        setConfigured(true); setForm((value) => ({ ...value, apiToken: "" }));
        toast({ title: "Local DNS settings saved" });
      }
    } catch (e) { toast({ variant: "destructive", title: "Local DNS request failed", description: e instanceof Error ? e.message : "Request failed" }); }
    finally { setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle className="text-base">Local DNS · Technitium</CardTitle>
      <p className="text-sm text-muted-foreground">Point new proxy hostnames to rproxy&apos;s LAN IP in Technitium, alongside Cloudflare DNS.</p>
    </CardHeader>
    <CardContent><form onSubmit={(e) => { e.preventDefault(); void request("PUT"); }}>
      <fieldset disabled={busy || loadError} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="local-dns-url">Technitium server URL</Label><Input id="local-dns-url" placeholder="https://dns.sleik.is" value={form.serverUrl} onChange={(e) => setForm({ ...form, serverUrl: e.target.value })} required /></div>
        <div className="space-y-2"><Label htmlFor="local-dns-token">API token</Label><Input id="local-dns-token" type="password" autoComplete="new-password" placeholder={configured ? "Leave blank to keep saved token" : "Technitium API token"} value={form.apiToken} onChange={(e) => setForm({ ...form, apiToken: e.target.value })} required={!configured} /></div>
        <div className="space-y-2"><Label htmlFor="local-dns-ip">rproxy LAN IPv4 address</Label><Input id="local-dns-ip" placeholder="192.168.1.10" value={form.targetIp} onChange={(e) => setForm({ ...form, targetIp: e.target.value })} required /></div>
        <div className="flex items-center justify-between"><Label htmlFor="local-dns-enabled">Automatic local DNS records</Label><Switch id="local-dns-enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} /></div>
        <p className="text-xs text-muted-foreground">Create matching authoritative zones in Technitium first and grant the token user permission to modify records. Saving tests authentication. Local DNS replaces each hostname&apos;s A record set with the LAN IP (TTL 300 seconds). Deleted or renamed hosts leave old DNS records for manual cleanup.</p>
        <div className="flex flex-wrap gap-2"><Button type="submit">{busy ? "Working…" : "Save and test connection"}</Button>
          {configured && <Button type="button" variant="outline" disabled={!form.enabled} onClick={() => void request("POST", true)}>Sync existing hosts</Button>}
          {configured && <Button type="button" variant="outline" onClick={() => void request("DELETE")}>Disconnect</Button>}
        </div>
        <p className="text-xs text-muted-foreground">Sync uses saved settings. Disconnecting leaves existing records in place.</p>
      </fieldset>
    </form></CardContent>
  </Card>;
}
