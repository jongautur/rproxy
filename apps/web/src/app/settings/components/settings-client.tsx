"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Settings, Users, Key, Download, Database, HardDrive,
  Plus, Trash2, Loader2, CheckCircle2, ShieldCheck, ShieldOff, User, Bell, Globe, Webhook, FileWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { cn, formatRelativeTime } from "@/lib/utils";
import { NotificationsTab } from "./notifications-tab";
import { TotpCard } from "./totp-card";

interface AppUser {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: "ADMIN" | "VIEWER";
  createdAt: string;
}

interface Profile {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  totpEnabled?: boolean;
}

interface SettingsData {
  users: AppUser[];
  settings: { key: string; value: string }[];
}

export function SettingsClient({ currentUserId }: { currentUserId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [totpEnabled, setTotpEnabled] = useState(false);

  // Profile
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "", email: "", username: "" });
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  // Create user dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", role: "VIEWER" as "ADMIN" | "VIEWER" });
  const [addSaving, setAddSaving] = useState(false);

  // Delete confirmation
  const [delTarget, setDelTarget] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Log retention
  const [logMaxGb, setLogMaxGb] = useState("10");
  const [logUsed, setLogUsed] = useState<{ usedBytes: number; maxGb: number } | null>(null);
  const [logSaving, setLogSaving] = useState(false);

  // Default (unmatched-domain) nginx page
  const [defaultPageMode, setDefaultPageMode] = useState<"nginx_default" | "redirect" | "custom_html" | "no_response">("nginx_default");
  const [defaultPageRedirectUrl, setDefaultPageRedirectUrl] = useState("");
  const [defaultPageHtml, setDefaultPageHtml] = useState("");
  const [defaultPageSaving, setDefaultPageSaving] = useState(false);

  // Custom 403 (access-list deny) page
  const [error403Html, setError403Html] = useState("");
  const [error403Saving, setError403Saving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json() as { success: boolean; data: SettingsData };
      if (json.success) {
        setData(json.data);
        const find = (key: string) => json.data.settings.find((s) => s.key === key)?.value;
        const maxGbSetting = find("log_max_gb");
        if (maxGbSetting) setLogMaxGb(maxGbSetting);
        const mode = find("default_page_mode");
        if (mode) setDefaultPageMode(mode as typeof defaultPageMode);
        setDefaultPageRedirectUrl(find("default_page_redirect_url") ?? "");
        setDefaultPageHtml(find("default_page_html") ?? "");
        setError403Html(find("error_403_html") ?? "");
      }
    } catch {
      // VIEWER gets 403 — fine
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/profile");
      const json = await res.json() as { success: boolean; data: { user: Profile } };
      if (json.success) {
        setProfile(json.data.user);
        setTotpEnabled(json.data.user.totpEnabled ?? false);
        setProfileForm({
          firstName: json.data.user.firstName ?? "",
          lastName: json.data.user.lastName ?? "",
          email: json.data.user.email,
          username: json.data.user.username,
        });
      }
    } catch { /* ignore */ }
  }, []);

  const fetchLogUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/log-usage");
      const json = await res.json() as { success: boolean; data: { usedBytes: number; maxGb: number } };
      if (json.success) setLogUsed(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchData();
    fetchProfile();
    fetchLogUsage();
  }, [fetchData, fetchProfile, fetchLogUsage]);

  async function handleSaveProfile() {
    setProfileSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: profileForm.firstName,
          lastName: profileForm.lastName,
          email: profileForm.email,
          username: profileForm.username,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { user: Profile } };
      if (json.success && json.data) {
        toast({ title: "Profile saved" });
        setProfile(json.data.user);
        setTotpEnabled(json.data.user.totpEnabled ?? false);
      } else {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveLogLimit() {
    const gb = parseInt(logMaxGb);
    if (isNaN(gb) || gb < 1 || gb > 100) {
      toast({ variant: "destructive", title: "Max GB must be between 1 and 100" });
      return;
    }
    setLogSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "log_max_gb", value: String(gb) }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Log limit saved" });
        setLogUsed((u) => u ? { ...u, maxGb: gb } : { usedBytes: 0, maxGb: gb });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setLogSaving(false);
    }
  }

  async function patchSetting(key: string, value: string): Promise<{ success: boolean; error?: string }> {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return res.json() as Promise<{ success: boolean; error?: string }>;
  }

  async function handleSaveDefaultPage() {
    if (defaultPageMode === "redirect" && !defaultPageRedirectUrl.trim()) {
      toast({ variant: "destructive", title: "Redirect URL is required" });
      return;
    }
    setDefaultPageSaving(true);
    try {
      // The mode save triggers the actual nginx redeploy (see PATCH
      // /api/settings) — save the mode-specific field first so it's already
      // in place by the time that redeploy reads it.
      if (defaultPageMode === "redirect") {
        const r = await patchSetting("default_page_redirect_url", defaultPageRedirectUrl.trim());
        if (!r.success) { toast({ variant: "destructive", title: "Save failed", description: r.error }); return; }
      } else if (defaultPageMode === "custom_html") {
        const r = await patchSetting("default_page_html", defaultPageHtml);
        if (!r.success) { toast({ variant: "destructive", title: "Save failed", description: r.error }); return; }
      }
      const modeResult = await patchSetting("default_page_mode", defaultPageMode);
      if (modeResult.success) {
        toast({ title: "Default page saved" });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: modeResult.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setDefaultPageSaving(false);
    }
  }

  async function handleSaveError403() {
    setError403Saving(true);
    try {
      const result = await patchSetting("error_403_html", error403Html);
      if (result.success) {
        toast({ title: "403 page saved" });
      } else {
        toast({ variant: "destructive", title: "Save failed", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Save failed" });
    } finally {
      setError403Saving(false);
    }
  }

  async function handlePasswordChange() {
    if (pwNew !== pwConfirm) {
      toast({ variant: "destructive", title: "Passwords don't match" });
      return;
    }
    if (pwNew.length < 8) {
      toast({ variant: "destructive", title: "Password must be at least 8 characters" });
      return;
    }
    setPwSaving(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Password updated" });
        setPwCurrent(""); setPwNew(""); setPwConfirm("");
      } else {
        toast({ variant: "destructive", title: "Update failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    } finally {
      setPwSaving(false);
    }
  }

  async function handleAddUser() {
    setAddSaving(true);
    try {
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "User created", description: newUser.username });
        setAddOpen(false);
        setNewUser({ username: "", email: "", password: "", role: "VIEWER" });
        fetchData();
      } else {
        toast({ variant: "destructive", title: "Create failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Create failed" });
    } finally {
      setAddSaving(false);
    }
  }

  async function handleDeleteUser(user: AppUser) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/settings/users/${user.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "User deleted", description: user.username });
        setDelTarget(null);
        fetchData();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleRoleChange(user: AppUser, role: "ADMIN" | "VIEWER") {
    try {
      const res = await fetch(`/api/settings/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Role updated" });
        fetchData();
      } else {
        toast({ variant: "destructive", title: "Update failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Update failed" });
    }
  }

  const displayName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username
    : "";

  return (
    <div className="p-8 space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" />
          Settings
        </h1>
        {displayName && (
          <p className="text-muted-foreground text-sm mt-1">Signed in as {displayName}</p>
        )}
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-6">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-4 h-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Key className="w-4 h-4" />
            Security
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-2">
            <Database className="w-4 h-4" />
            Data
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="nginx" className="gap-2">
            <Globe className="w-4 h-4" />
            Nginx
          </TabsTrigger>
          {!loading && data && (
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
          )}
        </TabsList>

        {/* Profile tab */}
        <TabsContent value="profile">
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="w-4 h-4" />
                Your Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>First name</Label>
                  <Input
                    placeholder="Jon"
                    value={profileForm.firstName}
                    onChange={(e) => setProfileForm((f) => ({ ...f, firstName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Last name</Label>
                  <Input
                    placeholder="Smith"
                    value={profileForm.lastName}
                    onChange={(e) => setProfileForm((f) => ({ ...f, lastName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  placeholder="jonma"
                  value={profileForm.username}
                  onChange={(e) => setProfileForm((f) => ({ ...f, username: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Used to log in. Letters, numbers, . _ - only.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              {profile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{profile.role}</Badge>
                  <span>Account role</span>
                </div>
              )}
              <Button
                onClick={handleSaveProfile}
                disabled={profileSaving || !profileForm.username || !profileForm.email}
              >
                {profileSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Save Profile
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security tab */}
        <TabsContent value="security">
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="w-4 h-4" />
                Change Password
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <div className="space-y-1.5">
                <Label>Current password</Label>
                <Input type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <Input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm new password</Label>
                <Input
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className={pwConfirm && pwNew !== pwConfirm ? "border-destructive" : ""}
                />
              </div>
              <Button
                onClick={handlePasswordChange}
                disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
              >
                {pwSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Update Password
              </Button>
            </CardContent>
          </Card>

          <TotpCard totpEnabled={totpEnabled} onToggle={() => setTotpEnabled((v) => !v)} />
        </TabsContent>

        {/* Data tab */}
        <TabsContent value="data" className="space-y-6">
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4" />
                Data Management
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-3">
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => window.open("/api/system/export", "_blank")}
                >
                  <Download className="w-3.5 h-3.5" />
                  Export config (JSON)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => window.open("/api/system/backup", "_blank")}
                >
                  <Database className="w-3.5 h-3.5" />
                  Database backup (SQL)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                JSON export contains all proxy hosts and certificates (no secrets). SQL backup is a full pg_dump of the rproxy database.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                Log Retention
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              {logUsed && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Disk usage</span>
                    <span className={cn("font-medium tabular-nums",
                      logUsed.usedBytes > logUsed.maxGb * 1073741824 * 0.9 ? "text-destructive" : "")}>
                      {logUsed.usedBytes >= 1073741824
                        ? (logUsed.usedBytes / 1073741824).toFixed(2) + " GB"
                        : logUsed.usedBytes >= 1048576
                          ? (logUsed.usedBytes / 1048576).toFixed(1) + " MB"
                          : (logUsed.usedBytes / 1024).toFixed(0) + " KB"}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all",
                        logUsed.usedBytes / (logUsed.maxGb * 1073741824) > 0.9 ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${Math.min(100, (logUsed.usedBytes / (logUsed.maxGb * 1073741824)) * 100).toFixed(1)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Nginx access/error logs and app logs — old files removed automatically when limit is reached
                  </p>
                </div>
              )}
              <div className="flex items-end gap-3">
                <div className="w-40 space-y-1.5">
                  <Label>Max storage (GB)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={logMaxGb}
                    onChange={(e) => setLogMaxGb(e.target.value)}
                  />
                </div>
                <Button onClick={handleSaveLogLimit} disabled={logSaving}>
                  {logSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab />
        </TabsContent>

        <TabsContent value="nginx" className="space-y-6">
          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Default Page
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <p className="text-xs text-muted-foreground">
                What a visitor sees when their request doesn&apos;t match any configured proxy or redirect host — e.g. hitting this server&apos;s raw IP, or an old/typo&apos;d domain.
              </p>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={defaultPageMode} onValueChange={(v) => setDefaultPageMode(v as typeof defaultPageMode)}>
                  <SelectTrigger className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nginx_default">Default nginx page</SelectItem>
                    <SelectItem value="redirect">Redirect</SelectItem>
                    <SelectItem value="custom_html">Custom HTML</SelectItem>
                    <SelectItem value="no_response">No response</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {defaultPageMode === "redirect" && (
                <div className="space-y-1.5">
                  <Label>Redirect URL</Label>
                  <Input
                    placeholder="https://example.com"
                    value={defaultPageRedirectUrl}
                    onChange={(e) => setDefaultPageRedirectUrl(e.target.value)}
                  />
                </div>
              )}

              {defaultPageMode === "custom_html" && (
                <div className="space-y-1.5">
                  <Label>HTML</Label>
                  <Textarea
                    className="font-mono text-xs min-h-40"
                    placeholder="<!DOCTYPE html>..."
                    value={defaultPageHtml}
                    onChange={(e) => setDefaultPageHtml(e.target.value)}
                  />
                </div>
              )}

              {defaultPageMode === "no_response" && (
                <p className="text-xs text-muted-foreground">
                  The connection is closed immediately with no response — nginx&apos;s <code>return 444</code>.
                </p>
              )}

              <Button onClick={handleSaveDefaultPage} disabled={defaultPageSaving}>
                {defaultPageSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-base flex items-center gap-2">
                <FileWarning className="w-4 h-4" />
                Custom 403 Page
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <p className="text-xs text-muted-foreground">
                Shown instead of nginx&apos;s stock 403 page whenever an access list denies a request. Leave blank to use nginx&apos;s default. Applies to every proxy host.
              </p>
              <Textarea
                className="font-mono text-xs min-h-40"
                placeholder="<!DOCTYPE html>... (blank = nginx default)"
                value={error403Html}
                onChange={(e) => setError403Html(e.target.value)}
              />
              <Button onClick={handleSaveError403} disabled={error403Saving}>
                {error403Saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users tab — admin only */}
        {!loading && data && (
          <TabsContent value="users">
            <Card>
              <CardHeader className="pb-3 pt-4 px-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Users
                  </CardTitle>
                  <Button size="sm" onClick={() => setAddOpen(true)} className="gap-2">
                    <Plus className="w-3.5 h-3.5" />
                    Add user
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="space-y-2">
                  {data.users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-border/50 hover:bg-accent/20 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                          user.role === "ADMIN" ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          {(user.firstName?.[0] ?? user.username[0])?.toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">
                              {user.firstName || user.lastName
                                ? [user.firstName, user.lastName].filter(Boolean).join(" ")
                                : user.username}
                            </p>
                            {user.id === currentUserId && (
                              <Badge variant="secondary" className="text-xs">you</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            @{user.username} · {user.email} · joined {formatRelativeTime(user.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={user.role}
                          onValueChange={(v) => handleRoleChange(user, v as "ADMIN" | "VIEWER")}
                          disabled={user.id === currentUserId}
                        >
                          <SelectTrigger className="w-28 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ADMIN">
                              <span className="flex items-center gap-1.5"><ShieldCheck className="w-3 h-3" />Admin</span>
                            </SelectItem>
                            <SelectItem value="VIEWER">
                              <span className="flex items-center gap-1.5"><ShieldOff className="w-3 h-3" />Viewer</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={user.id === currentUserId}
                          onClick={() => setDelTarget(user)}
                          className="hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Add user dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setNewUser({ username: "", email: "", password: "", role: "VIEWER" }); setAddOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                placeholder="jonma"
                value={newUser.username}
                onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={newUser.role} onValueChange={(v) => setNewUser((u) => ({ ...u, role: v as "ADMIN" | "VIEWER" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="VIEWER">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={addSaving || !newUser.username || !newUser.email || !newUser.password}>
              {addSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete user confirmation */}
      <AlertDialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-semibold text-foreground">{delTarget?.username}</span>.
              Their audit log entries will be anonymized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => delTarget && handleDeleteUser(delTarget)}
              disabled={deleting}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
