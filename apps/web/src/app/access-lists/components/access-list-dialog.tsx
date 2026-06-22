"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, ShieldCheck, ChevronUp, ChevronDown } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import type { AccessListWithRelations } from "@/types/access-list";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: AccessListWithRelations | null;
  onSaved: () => void;
}

interface NewUser { localId: string; username: string; password: string; }
interface IpRule { localId: string; address: string; action: "allow" | "deny"; }

function isValidIp(address: string): boolean {
  const ipv4 = /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)(\/([012]?\d|3[012]))?$/;
  return ipv4.test(address) || address === "all";
}

let ctr = 0;
const uid = () => `tmp-${++ctr}`;

export function AccessListDialog({ open, onOpenChange, editTarget, onSaved }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authRealm, setAuthRealm] = useState("Restricted");
  const [existingUsers, setExistingUsers] = useState<{ id: string; username: string }[]>([]);
  const [deleteUserIds, setDeleteUserIds] = useState<string[]>([]);
  const [newUsers, setNewUsers] = useState<NewUser[]>([]);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [ipRules, setIpRules] = useState<IpRule[]>([]);
  const [newIp, setNewIp] = useState("");
  const [newIpAction, setNewIpAction] = useState<"allow" | "deny">("allow");

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      setName(editTarget.name);
      setAuthEnabled(editTarget.authEnabled);
      setAuthRealm(editTarget.authRealm || "Restricted");
      setExistingUsers([...editTarget.authUsers]);
      setDeleteUserIds([]);
      setNewUsers([]);
      setIpRules(editTarget.ipRules.map((r) => ({
        localId: uid(),
        address: r.address,
        action: r.action as "allow" | "deny",
      })));
    } else {
      setName(""); setAuthEnabled(false); setAuthRealm("Restricted");
      setExistingUsers([]); setDeleteUserIds([]); setNewUsers([]); setIpRules([]);
    }
    setNewUsername(""); setNewPassword(""); setNewIp(""); setNewIpAction("allow");
  }, [open, editTarget]);

  function addUser() {
    if (!newUsername.trim() || !newPassword.trim()) return;
    if (!/^[a-zA-Z0-9._@-]{1,64}$/.test(newUsername.trim())) {
      toast({ variant: "destructive", title: "Invalid username", description: "Use letters, numbers, . _ @ - only" });
      return;
    }
    setNewUsers((u) => [...u, { localId: uid(), username: newUsername.trim(), password: newPassword }]);
    setNewUsername(""); setNewPassword("");
  }

  function addIpRule() {
    const addr = newIp.trim();
    if (!addr) return;
    if (!isValidIp(addr)) {
      toast({ variant: "destructive", title: "Invalid address", description: "e.g. 192.168.1.0/24 or 10.0.0.1" });
      return;
    }
    setIpRules((r) => [...r, { localId: uid(), address: addr, action: newIpAction }]);
    setNewIp("");
  }

  function moveRule(index: number, dir: -1 | 1) {
    setIpRules((r) => {
      const n = [...r];
      const swap = index + dir;
      if (swap < 0 || swap >= n.length) return n;
      [n[index], n[swap]] = [n[swap]!, n[index]!];
      return n;
    });
  }

  async function handleSave() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    if (authEnabled && existingUsers.length === 0 && newUsers.length === 0) {
      toast({ variant: "destructive", title: "Add at least one user or disable Basic Auth" });
      return;
    }
    setSaving(true);
    try {
      const isEdit = !!editTarget;
      const url = isEdit ? `/api/access-lists/${editTarget.id}` : "/api/access-lists";
      const method = isEdit ? "PATCH" : "POST";
      const body = isEdit
        ? {
            name: name.trim(), authEnabled,
            authRealm: authRealm || "Restricted",
            addUsers: newUsers.map(({ username, password }) => ({ username, password })),
            deleteUserIds,
            ipRules: ipRules.map(({ address, action }) => ({ address, action })),
          }
        : {
            name: name.trim(), authEnabled,
            authRealm: authRealm || "Restricted",
            users: newUsers.map(({ username, password }) => ({ username, password })),
            ipRules: ipRules.map(({ address, action }) => ({ address, action })),
          };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: isEdit ? "Access list updated" : "Access list created" });
        onSaved();
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
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            {editTarget ? "Edit Access List" : "New Access List"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-1">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="Internal only" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Basic Auth */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Basic Authentication</p>
                <p className="text-xs text-muted-foreground">Require HTTP username / password</p>
              </div>
              <Switch checked={authEnabled} onCheckedChange={setAuthEnabled} />
            </div>

            {authEnabled && (
              <div className="space-y-3 border-l-2 border-border pl-3 ml-1">
                <div className="space-y-1.5">
                  <Label className="text-xs">Realm (shown in browser prompt)</Label>
                  <Input
                    placeholder="Restricted"
                    value={authRealm}
                    onChange={(e) => setAuthRealm(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                {existingUsers.length > 0 && (
                  <div className="space-y-1">
                    {existingUsers.map((u) => (
                      <div key={u.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-border/60 text-sm">
                        <span className="font-mono text-sm">{u.username}</span>
                        <Button variant="ghost" size="icon-sm"
                          onClick={() => {
                            setDeleteUserIds((ids) => [...ids, u.id]);
                            setExistingUsers((us) => us.filter((x) => x.id !== u.id));
                          }}
                          className="hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {newUsers.length > 0 && (
                  <div className="space-y-1">
                    {newUsers.map((u) => (
                      <div key={u.localId} className="flex items-center justify-between px-2.5 py-1.5 rounded-md border border-primary/30 bg-primary/5 text-sm">
                        <span className="flex items-center gap-2 font-mono">
                          {u.username}
                          <Badge variant="secondary" className="text-xs">new</Badge>
                        </span>
                        <Button variant="ghost" size="icon-sm"
                          onClick={() => setNewUsers((us) => us.filter((x) => x.localId !== u.localId))}
                          className="hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input placeholder="username" value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addUser()}
                    className="h-8 text-sm font-mono" />
                  <Input type="password" placeholder="password" value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addUser()}
                    className="h-8 text-sm w-28" />
                  <Button size="sm" variant="outline" onClick={addUser}
                    disabled={!newUsername || !newPassword} className="h-8 shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {authEnabled && existingUsers.length === 0 && newUsers.length === 0 && (
                  <p className="text-xs text-warning">Add at least one user</p>
                )}
              </div>
            )}
          </div>

          {/* IP Rules */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">IP Access Rules</p>
              <p className="text-xs text-muted-foreground">
                Rules evaluated in order.{" "}
                <code className="text-xs bg-muted px-1 rounded">deny all</code>{" "}
                is appended automatically.
              </p>
            </div>

            {ipRules.length > 0 && (
              <div className="space-y-1">
                {ipRules.map((rule, i) => (
                  <div key={rule.localId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border/60 text-sm">
                    <span className={`shrink-0 font-mono text-xs px-1.5 py-0.5 rounded font-medium ${rule.action === "allow" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                      {rule.action}
                    </span>
                    <span className="font-mono flex-1 text-sm">{rule.address}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => moveRule(i, -1)}>
                        <ChevronUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" disabled={i === ipRules.length - 1} onClick={() => moveRule(i, 1)}>
                        <ChevronDown className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-sm"
                        onClick={() => setIpRules((r) => r.filter((x) => x.localId !== rule.localId))}
                        className="hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="px-2.5 py-1.5 rounded-md border border-dashed border-border/40 text-xs font-mono text-muted-foreground/60">
                  deny all; (implicit)
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Select value={newIpAction} onValueChange={(v) => setNewIpAction(v as "allow" | "deny")}>
                <SelectTrigger className="w-24 h-8 text-sm shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder="192.168.1.0/24"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addIpRule()}
                className="h-8 text-sm font-mono"
              />
              <Button size="sm" variant="outline" onClick={addIpRule} disabled={!newIp} className="h-8 shrink-0">
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editTarget ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
