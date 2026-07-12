"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, Copy, Loader2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";

interface Props {
  totpEnabled: boolean;
  onToggle: () => void;
}

type Step = "idle" | "setup" | "backup" | "disable";

interface SetupData {
  secret: string;
  qrSvg: string;
}

export function TotpCard({ totpEnabled, onToggle }: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("idle");
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disableCode, setDisableCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  async function startSetup() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/totp");
      const json = await res.json() as { success: boolean; data: SetupData };
      setSetup(json.data);
      setCode("");
      setStep("setup");
    } catch {
      toast({ variant: "destructive", title: "Failed to start 2FA setup" });
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setLoading(true);
    try {
      const res = await fetch("/api/settings/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: setup.secret, code }),
      });
      const json = await res.json() as { success: boolean; error?: string; data?: { backupCodes: string[] } };
      if (!json.success) {
        toast({ variant: "destructive", title: "Failed", description: json.error });
        return;
      }
      setBackupCodes(json.data!.backupCodes);
      setStep("backup");
    } catch {
      toast({ variant: "destructive", title: "Verification failed" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/settings/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        toast({ variant: "destructive", title: "Failed", description: json.error });
        return;
      }
      toast({ title: "Two-factor authentication disabled" });
      setStep("idle");
      setDisableCode("");
      onToggle();
    } catch {
      toast({ variant: "destructive", title: "Failed to disable 2FA" });
    } finally {
      setLoading(false);
    }
  }

  function handleBackupDone() {
    setStep("idle");
    setSetup(null);
    setCode("");
    onToggle();
    toast({ title: "Two-factor authentication enabled" });
  }

  function copyBackup() {
    void navigator.clipboard.writeText(backupCodes.join("\n"));
    toast({ title: "Backup codes copied" });
  }

  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="text-base flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Two-Factor Authentication
          </div>
          <Badge variant={totpEnabled ? "success" : "secondary"}>
            {totpEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {step === "idle" && !totpEnabled && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add a second factor using any TOTP authenticator app (Google Authenticator, Authy, Bitwarden, etc.).
            </p>
            <Button onClick={startSetup} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Set up 2FA
            </Button>
          </div>
        )}

        {step === "idle" && totpEnabled && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your account is protected with two-factor authentication.
            </p>
            <Button variant="destructive" size="sm" onClick={() => { setDisableCode(""); setStep("disable"); }}>
              <ShieldOff className="w-4 h-4 mr-2" />
              Disable 2FA
            </Button>
          </div>
        )}

        {step === "setup" && setup && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>

            {/* Inline SVG — no external requests */}
            <div
              className="mx-auto w-fit p-3 bg-white rounded-lg border border-border"
              dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
            />

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Manual entry key</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={showSecret ? setup.secret : "••••••••••••••••••••••••••••••••"}
                  className="font-mono text-xs"
                />
                <Button type="button" size="icon" variant="ghost" onClick={() => setShowSecret((v) => !v)}>
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  type="button" size="icon" variant="ghost"
                  onClick={() => { void navigator.clipboard.writeText(setup.secret); toast({ title: "Key copied" }); }}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <form onSubmit={handleEnable} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Verification code</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={6}
                  className="font-mono text-center text-xl tracking-widest"
                  autoFocus
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={loading || code.length !== 6}>
                  {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Enable 2FA
                </Button>
                <Button type="button" variant="outline" onClick={() => setStep("idle")}>Cancel</Button>
              </div>
            </form>
          </div>
        )}

        {step === "backup" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Save your backup codes</p>
              <p className="text-xs text-muted-foreground mt-1">
                Store these somewhere safe. Each code can only be used once if you lose your authenticator.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((c) => (
                <div key={c} className="bg-muted rounded px-3 py-1.5 text-center tracking-widest">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyBackup}>
                <Copy className="w-4 h-4 mr-2" />Copy all
              </Button>
              <Button size="sm" onClick={handleBackupDone}>
                Done — I&apos;ve saved them
              </Button>
            </div>
          </div>
        )}

        {step === "disable" && (
          <form onSubmit={handleDisable} className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter your current TOTP code or a backup code to confirm.
            </p>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="000000 or backup code"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                maxLength={8}
                className="font-mono"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={loading || !disableCode}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Disable 2FA
              </Button>
              <Button type="button" variant="outline" onClick={() => setStep("idle")}>Cancel</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
