"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

export default function MfaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading || !code.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Invalid code", description: data.error ?? "Try again" });
        setCode("");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Network error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="rproxy" width={80} height={80} className="rounded-2xl mb-4" priority />
          <h1 className="text-2xl font-bold text-foreground">Two-Factor Auth</h1>
          <p className="text-sm text-muted-foreground mt-1">Enter the code from your authenticator app</p>
        </div>

        <Card className="border-border/50 shadow-2xl">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Verification required</h2>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">6-digit code or backup code</Label>
                <Input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={loading}
                  maxLength={8}
                  className="text-center text-xl tracking-widest font-mono"
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Verifying...</> : "Verify"}
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                You can also enter an 8-character backup code.
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">rproxy — Native Linux Edition</p>
      </div>
    </div>
  );
}
