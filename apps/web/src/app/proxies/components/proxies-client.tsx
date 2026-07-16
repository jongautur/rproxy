"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Globe, CornerUpRight, Network, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProxyTable } from "./proxy-table";
import { ProxyFormDialog } from "./proxy-form-dialog";
import { RedirectTable } from "./redirect-table";
import { RedirectFormDialog } from "./redirect-form-dialog";
import type { ProxyHostWithCert } from "@/types/proxy";
import type { RedirectHostWithCert } from "@/types/redirect";
import { StreamTable } from "./stream-table";
import { StreamFormDialog } from "./stream-form-dialog";
import type { StreamHost } from "@prisma/client";

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
  const [proxySearch, setProxySearch] = useState("");
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<ProxyHostWithCert | null>(null);

  // Redirect state
  const [redirectItems, setRedirectItems] = useState<RedirectHostWithCert[]>([]);
  const [redirectLoading, setRedirectLoading] = useState(true);
  const [redirectDialogOpen, setRedirectDialogOpen] = useState(false);
  const [editRedirect, setEditRedirect] = useState<RedirectHostWithCert | null>(null);

  // Stream state
  const [streamItems, setStreamItems] = useState<StreamHost[]>([]);
  const [streamLoading, setStreamLoading] = useState(true);
  const [streamDialogOpen, setStreamDialogOpen] = useState(false);
  const [editStream, setEditStream] = useState<StreamHost | null>(null);

  const [reloading, setReloading] = useState(false);
  const [activeTab, setActiveTab] = useState("proxy");

  // ── Fetch proxies ────────────────────────────────────────────────────────────
  const fetchProxies = useCallback(async () => {
    setProxyLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(proxyPage),
        perPage: "20",
        ...(proxySearch && { search: proxySearch }),
      });
      const res = await fetch(`/api/proxies?${params}`);
      const json = await res.json() as { success: boolean; data: PaginatedProxies };
      if (json.success) setProxyData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load proxy hosts" });
    } finally {
      setProxyLoading(false);
    }
  }, [proxyPage, proxySearch, toast]);

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

  const fetchStreams = useCallback(async () => {
    setStreamLoading(true);
    try {
      const res = await fetch("/api/streams");
      const json = await res.json() as { success: boolean; data: { items: StreamHost[] } };
      if (json.success) setStreamItems(json.data.items);
    } catch {
      toast({ variant: "destructive", title: "Failed to load stream hosts" });
    } finally {
      setStreamLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const id = setTimeout(() => void fetchProxies(), proxySearch ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchProxies, proxySearch]);
  useEffect(() => { void fetchRedirects(); }, [fetchRedirects]);
  useEffect(() => { void fetchStreams(); }, [fetchStreams]);

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

  const totalHosts = (proxyData?.total ?? 0) + redirectItems.length + streamItems.length;

  return (
    <div className="p-4 md:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            Hosts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalHosts} host{totalHosts !== 1 ? "s" : ""} configured
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          {activeTab === "stream" && (
            <Button size="sm" onClick={() => { setEditStream(null); setStreamDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Stream Host
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
          <TabsTrigger value="stream" className="gap-2">
            <Network className="w-4 h-4" />
            Stream
            <span className="ml-1 text-xs bg-muted rounded px-1.5 py-0.5">{streamItems.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proxy" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search domain or forward host..."
              value={proxySearch}
              onChange={(e) => { setProxySearch(e.target.value); setProxyPage(1); }}
              className="pl-9"
            />
          </div>
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

        <TabsContent value="stream" className="mt-4">
          <StreamTable
            items={streamItems}
            onEdit={(s) => { setEditStream(s); setStreamDialogOpen(true); }}
            onRefresh={fetchStreams}
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
      <StreamFormDialog
        open={streamDialogOpen}
        onOpenChange={setStreamDialogOpen}
        editingStream={editStream}
        onSaved={() => { setStreamDialogOpen(false); setEditStream(null); void fetchStreams(); }}
      />
    </div>
  );
}
