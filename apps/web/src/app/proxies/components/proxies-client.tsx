"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Globe, CornerUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProxyTable } from "./proxy-table";
import { ProxyFormDialog } from "./proxy-form-dialog";
import { RedirectTable } from "./redirect-table";
import { RedirectFormDialog } from "./redirect-form-dialog";
import type { ProxyHostWithCert } from "@/types/proxy";
import type { RedirectHostWithCert } from "@/types/redirect";

interface PaginatedProxies {
  items: ProxyHostWithCert[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function ProxiesClient() {
  const { toast } = useToast();

  // Proxy state
  const [proxyData, setProxyData] = useState<PaginatedProxies | null>(null);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxyPage, setProxyPage] = useState(1);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<ProxyHostWithCert | null>(null);

  // Redirect state
  const [redirectItems, setRedirectItems] = useState<RedirectHostWithCert[]>([]);
  const [redirectLoading, setRedirectLoading] = useState(true);
  const [redirectDialogOpen, setRedirectDialogOpen] = useState(false);
  const [editRedirect, setEditRedirect] = useState<RedirectHostWithCert | null>(null);

  const [reloading, setReloading] = useState(false);
  const [activeTab, setActiveTab] = useState("proxy");

  // ── Fetch proxies ────────────────────────────────────────────────────────────
  const fetchProxies = useCallback(async () => {
    setProxyLoading(true);
    try {
      const params = new URLSearchParams({ page: String(proxyPage), perPage: "20" });
      const res = await fetch(`/api/proxies?${params}`);
      const json = await res.json() as { success: boolean; data: PaginatedProxies };
      if (json.success) setProxyData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load proxy hosts" });
    } finally {
      setProxyLoading(false);
    }
  }, [proxyPage, toast]);

  // ── Fetch redirects ──────────────────────────────────────────────────────────
  const fetchRedirects = useCallback(async () => {
    setRedirectLoading(true);
    try {
      const res = await fetch("/api/redirects");
      const json = await res.json() as { success: boolean; data: { items: RedirectHostWithCert[] } };
      if (json.success) setRedirectItems(json.data.items);
    } catch {
      toast({ variant: "destructive", title: "Failed to load redirects" });
    } finally {
      setRedirectLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchProxies(); }, [fetchProxies]);
  useEffect(() => { void fetchRedirects(); }, [fetchRedirects]);

  async function handleReloadNginx() {
    setReloading(true);
    try {
      const res = await fetch("/api/system/nginx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reload" }),
      });
      const json = await res.json() as { success: boolean; data: { success: boolean; output: string } };
      if (json.data?.success) {
        toast({ title: "Nginx reloaded", description: "Configuration applied successfully" });
      } else {
        toast({ variant: "destructive", title: "Reload failed", description: json.data?.output });
      }
    } catch {
      toast({ variant: "destructive", title: "Reload failed" });
    } finally {
      setReloading(false);
    }
  }

  const totalHosts = (proxyData?.total ?? 0) + redirectItems.length;

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            Hosts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalHosts} host{totalHosts !== 1 ? "s" : ""} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReloadNginx} disabled={reloading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${reloading ? "animate-spin" : ""}`} />
            Reload Nginx
          </Button>
          {activeTab === "proxy" && (
            <Button size="sm" onClick={() => { setEditProxy(null); setProxyDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Proxy Host
            </Button>
          )}
          {activeTab === "redirect" && (
            <Button size="sm" onClick={() => { setEditRedirect(null); setRedirectDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Redirect
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="proxy" className="gap-2">
            <Globe className="w-4 h-4" />
            Proxy Hosts
            {proxyData && (
              <span className="ml-1 text-xs bg-muted rounded px-1.5 py-0.5">{proxyData.total}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="redirect" className="gap-2">
            <CornerUpRight className="w-4 h-4" />
            Redirects
            <span className="ml-1 text-xs bg-muted rounded px-1.5 py-0.5">{redirectItems.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proxy" className="mt-4">
          <ProxyTable
            data={proxyData}
            loading={proxyLoading}
            onEdit={(p) => { setEditProxy(p); setProxyDialogOpen(true); }}
            onRefresh={fetchProxies}
            page={proxyPage}
            onPageChange={setProxyPage}
          />
        </TabsContent>

        <TabsContent value="redirect" className="mt-4">
          <RedirectTable
            items={redirectItems}
            loading={redirectLoading}
            onEdit={(r) => { setEditRedirect(r); setRedirectDialogOpen(true); }}
            onRefresh={fetchRedirects}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ProxyFormDialog
        open={proxyDialogOpen}
        onOpenChange={setProxyDialogOpen}
        proxy={editProxy}
        onSaved={() => { setProxyDialogOpen(false); setEditProxy(null); void fetchProxies(); }}
      />
      <RedirectFormDialog
        open={redirectDialogOpen}
        onOpenChange={setRedirectDialogOpen}
        redirect={editRedirect}
        onSaved={() => { setRedirectDialogOpen(false); setEditRedirect(null); void fetchRedirects(); }}
      />
    </div>
  );
}
