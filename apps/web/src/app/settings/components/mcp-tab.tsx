"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Bot, Plus, Copy, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import { formatRelativeTime } from "@/lib/utils";

interface McpToken {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: "READ" | "WRITE";
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

function tokenState(t: McpToken): { label: string; variant: "success" | "secondary" | "destructive" } {
  if (t.revokedAt) return { label: "Revoked", variant: "destructive" };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return { label: "Expired", variant: "secondary" };
  return { label: "Active", variant: "success" };
}

export function McpTab({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<McpToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"READ" | "WRITE">("READ");
  const [expiry, setExpiry] = useState("90");
  const [creating, setCreating] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<McpToken | null>(null);

  const endpoint = typeof window === "undefined" ? "/api/mcp" : `${window.location.origin}/api/mcp`;

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/mcp-tokens");
      const json = await res.json() as { success: boolean; data: { items: McpToken[] } };
      if (json.success) setTokens(json.data.items);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchTokens(); }, [fetchTokens]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch { toast({ variant: "destructive", title: "Copy failed" }); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/settings/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scope,
          ...(expiry !== "never" && { expiresInDays: Number(expiry) }),
        }),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { plaintext: string } };
      if (!json.success || !json.data) {
        toast({ variant: "destructive", title: "Could not create token", description: json.error });
        return;
      }
      setCreateOpen(false);
      setPlaintext(json.data.plaintext);
      setName("");
      setScope("READ");
      setExpiry("90");
      void fetchTokens();
    } catch { toast({ variant: "destructive", title: "Could not create token" }); }
    finally { setCreating(false); }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    try {
      const res = await fetch(`/api/settings/mcp-tokens/${revokeTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        toast({ variant: "destructive", title: "Revoke failed", description: json.error });
        return;
      }
      toast({ title: "Token revoked" });
      void fetchTokens();
    } catch { toast({ variant: "destructive", title: "Revoke failed" }); }
    finally { setRevokeTarget(null); }
  }

  const addCommand = `claude mcp add --transport http rproxy ${endpoint} \\\n  --header "Authorization: Bearer <token>"`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" />
            MCP server
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            AI agents can manage rproxy over the Model Context Protocol. A token acts as you: read tokens can list
            hosts, certificates and gateway config; write tokens (admins only) can also create and update proxy hosts,
            redirects, streams, certificates and gateway routes. Every change is tested with <code>nginx -t</code> and
            rolled back if it fails. Nothing can be deleted over MCP.
          </p>
          <div className="space-y-1">
            <Label>Endpoint</Label>
            <div className="flex gap-2">
              <Input readOnly value={endpoint} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => void copy(endpoint)} aria-label="Copy endpoint">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Claude Code</Label>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre">{addCommand}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Your tokens</CardTitle>
          <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" />
            New token
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No tokens yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {tokens.map((t) => {
                const state = tokenState(t);
                return (
                  <div key={t.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{t.name}</span>
                        <Badge variant={t.scope === "WRITE" ? "warning" : "info"}>{t.scope === "WRITE" ? "Read + write" : "Read only"}</Badge>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        <code>{t.tokenPrefix}_…</code>
                        {" · "}created {formatRelativeTime(t.createdAt)}
                        {" · "}{t.lastUsedAt ? `last used ${formatRelativeTime(t.lastUsedAt)}` : "never used"}
                        {t.expiresAt && !t.revokedAt && ` · expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    {!t.revokedAt && (
                      <Button variant="ghost" size="sm" className="gap-2 text-destructive shrink-0" onClick={() => setRevokeTarget(t)}>
                        <Ban className="w-4 h-4" />
                        Revoke
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New MCP token</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="mcp-token-name">Name</Label>
              <Input id="mcp-token-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. laptop agent" maxLength={64} autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Access</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as "READ" | "WRITE")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="READ">Read only</SelectItem>
                  <SelectItem value="WRITE" disabled={!isAdmin}>Read + write{!isAdmin && " (admins only)"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Expires</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating || !name.trim()}>
                {creating && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={plaintext !== null} onOpenChange={(open) => { if (!open) setPlaintext(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your token now</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This is the only time the token is shown. rproxy stores only a hash of it.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={plaintext ?? ""} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={() => plaintext && void copy(plaintext)} aria-label="Copy token">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPlaintext(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &ldquo;{revokeTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents using this token lose access immediately. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleRevoke()}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
