"use client";

import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, Info } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onIssued: () => void;
  defaultDomain?: string;
}

const DNS_PROVIDERS = [
  { value: "dns_cf",           label: "Cloudflare" },
  { value: "dns_aws",          label: "AWS Route53" },
  { value: "dns_gd",           label: "GoDaddy" },
  { value: "dns_digitalocean", label: "DigitalOcean" },
  { value: "dns_ovh",          label: "OVH" },
  { value: "dns_namecheap",    label: "Namecheap" },
  { value: "dns_vultr",        label: "Vultr" },
  { value: "dns_linode",       label: "Linode" },
  { value: "dns_duckdns",      label: "DuckDNS" },
  { value: "dns_manual",       label: "Manual (DNS-01)" },
];

const DNS_ENV_HINTS: Record<string, { key: string; label: string }[]> = {
  dns_cf:           [{ key: "CF_Token", label: "Cloudflare API Token" }],
  dns_aws:          [{ key: "AWS_ACCESS_KEY_ID", label: "Access Key ID" }, { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key" }],
  dns_gd:           [{ key: "GD_Key", label: "GoDaddy Key" }, { key: "GD_Secret", label: "GoDaddy Secret" }],
  dns_digitalocean: [{ key: "DO_API_KEY", label: "DigitalOcean API Key" }],
  dns_ovh:          [{ key: "OVH_AK", label: "Application Key" }, { key: "OVH_AS", label: "Application Secret" }, { key: "OVH_CK", label: "Consumer Key" }],
};

interface IssueResult {
  success: boolean;
  output: string;
}

export function IssueCertDialog({ open, onOpenChange, onIssued, defaultDomain }: Props) {
  const { toast } = useToast();
  const [domain, setDomain] = useState("");

  useEffect(() => {
    if (open) setDomain(defaultDomain ?? "");
  }, [open, defaultDomain]);
  const [email, setEmail] = useState("");
  const [challengeType, setChallengeType] = useState<"HTTP" | "DNS">("HTTP");
  const [dnsProvider, setDnsProvider] = useState("dns_cf");
  const [dnsEnv, setDnsEnv] = useState<Record<string, string>>({});
  const [autoRenew, setAutoRenew] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setDomain(""); setEmail("");
    setChallengeType("HTTP"); setDnsProvider("dns_cf");
    setDnsEnv({}); setAutoRenew(true);
    setIssuing(false); setResult(null); setErrors({});
  }

  function handleClose(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  async function handleSubmit() {
    const e: Record<string, string> = {};
    if (!domain.trim()) e.domain = "Domain is required";
    if (!email.trim()) e.email = "Email is required";
    if (challengeType === "DNS" && dnsProvider !== "dns_manual") {
      const required = DNS_ENV_HINTS[dnsProvider] ?? [];
      for (const hint of required) {
        if (!dnsEnv[hint.key]?.trim()) {
          e[`dns_${hint.key}`] = `${hint.label} is required`;
        }
      }
    }
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setIssuing(true);
    setResult(null);

    try {
      const res = await fetch("/api/certificates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim().toLowerCase(),
          provider: "LETSENCRYPT",
          challengeType,
          email: email.trim(),
          dnsProvider: challengeType === "DNS" ? dnsProvider : undefined,
          dnsCredentials: challengeType === "DNS" && Object.keys(dnsEnv).length > 0 ? dnsEnv : undefined,
          autoRenew,
        }),
      });

      const json = await res.json() as {
        success: boolean;
        data?: { certificate: unknown; output: string };
        error?: string;
      };

      setResult({
        success: json.success,
        output: json.data?.output ?? json.error ?? "Unknown error",
      });

      if (json.success) {
        toast({ title: "Certificate issued!", description: domain });
        setTimeout(() => { onIssued(); reset(); }, 2000);
      }
    } catch {
      setResult({ success: false, output: "Network error" });
    } finally {
      setIssuing(false);
    }
  }

  const hints = DNS_ENV_HINTS[dnsProvider] ?? [];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Issue SSL Certificate</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Domain */}
          <div className="space-y-2">
            <Label htmlFor="cert-domain">
              Domain <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cert-domain"
              placeholder="example.com or *.example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className={errors.domain ? "border-destructive" : ""}
              disabled={issuing}
            />
            {errors.domain && <p className="text-xs text-destructive">{errors.domain}</p>}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="cert-email">
              ACME Account Email <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cert-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={errors.email ? "border-destructive" : ""}
              disabled={issuing}
            />
          </div>

          {/* Challenge type */}
          <div className="space-y-2">
            <Label>Challenge Type</Label>
            <Tabs value={challengeType} onValueChange={(v) => setChallengeType(v as "HTTP" | "DNS")}>
              <TabsList className="w-full">
                <TabsTrigger value="HTTP" className="flex-1">HTTP Challenge</TabsTrigger>
                <TabsTrigger value="DNS" className="flex-1">DNS Challenge</TabsTrigger>
              </TabsList>

              <TabsContent value="HTTP" className="mt-3">
                <div className="rounded-lg border border-border/50 bg-accent/20 p-3 text-xs text-muted-foreground flex gap-2">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Nginx must be running and port 80 must be reachable from the internet.
                    The domain must point to this server&apos;s IP.
                  </span>
                </div>
              </TabsContent>

              <TabsContent value="DNS" className="mt-3 space-y-3">
                <div className="space-y-2">
                  <Label>DNS Provider</Label>
                  <Select value={dnsProvider} onValueChange={setDnsProvider}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DNS_PROVIDERS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {hints.length > 0 && (
                  <div className="space-y-2">
                    {hints.map((hint) => (
                      <div key={hint.key} className="space-y-1">
                        <Label className="text-xs">{hint.label} <span className="text-destructive">*</span></Label>
                        <Input
                          type="password"
                          placeholder={hint.key}
                          value={dnsEnv[hint.key] ?? ""}
                          onChange={(e) => setDnsEnv((prev) => ({ ...prev, [hint.key]: e.target.value }))}
                          disabled={issuing}
                          className={`font-mono text-xs ${errors[`dns_${hint.key}`] ? "border-destructive" : ""}`}
                        />
                        {errors[`dns_${hint.key}`] && <p className="text-xs text-destructive">{errors[`dns_${hint.key}`]}</p>}
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Credentials are used only for this request and not stored in plaintext.
                    </p>
                  </div>
                )}

                {dnsProvider === "dns_manual" && (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground flex gap-2">
                    <Info className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                    <span>Manual DNS requires you to add a TXT record when prompted. The server must remain accessible during validation.</span>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Auto-renew */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-accent/20">
            <div>
              <p className="text-sm font-medium">Auto-renew</p>
              <p className="text-xs text-muted-foreground">Automatically renew 30 days before expiry</p>
            </div>
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} disabled={issuing} />
          </div>

          {/* Result output */}
          {result && (
            <div className={cn(
              "rounded-lg p-3 text-xs font-mono",
              result.success
                ? "bg-success/10 border border-success/20 text-success"
                : "bg-destructive/10 border border-destructive/20 text-destructive"
            )}>
              <div className="flex items-center gap-2 mb-2 font-sans font-medium text-sm">
                {result.success
                  ? <><CheckCircle2 className="w-4 h-4" /> Certificate issued successfully</>
                  : <><XCircle className="w-4 h-4" /> Issuance failed</>
                }
              </div>
              <pre className="whitespace-pre-wrap opacity-80 max-h-40 overflow-y-auto">{result.output}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={issuing}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={issuing || !!result?.success}>
            {issuing
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Issuing…</>
              : "Issue Certificate"
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
