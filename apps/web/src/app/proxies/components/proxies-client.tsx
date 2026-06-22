"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, RefreshCw, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { ProxyTable } from "./proxy-table";
import { ProxyFormDialog } from "./proxy-form-dialog";
import type { ProxyHostWithCert } from "@/types/proxy";

interface PaginatedProxies {
  items: ProxyHostWithCert[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function ProxiesClient() {
  const { toast } = useToast();
  const [data, setData] = useState<PaginatedProxies | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProxy, setEditProxy] = useState<ProxyHostWithCert | null>(null);
  const [reloading, setReloading] = useState(false);

  const fetchProxies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        perPage: "20",
        ...(search && { search }),
      });
      const res = await fetch(`/api/proxies?${params}`);
      const json = await res.json() as { success: boolean; data: PaginatedProxies };
      if (json.success) setData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load proxies" });
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    const id = setTimeout(() => fetchProxies(), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchProxies, search]);

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

  function handleCreate() {
    setEditProxy(null);
    setDialogOpen(true);
  }

  function handleEdit(proxy: ProxyHostWithCert) {
    setEditProxy(proxy);
    setDialogOpen(true);
  }

  function handleSaved() {
    setDialogOpen(false);
    setEditProxy(null);
    fetchProxies();
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            Proxy Hosts
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data ? `${data.total} host${data.total !== 1 ? "s" : ""} configured` : "Manage your reverse proxies"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReloadNginx}
            disabled={reloading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${reloading ? "animate-spin" : ""}`} />
            Reload Nginx
          </Button>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Add Proxy Host
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search domains or hosts..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <ProxyTable
        data={data}
        loading={loading}
        onEdit={handleEdit}
        onRefresh={fetchProxies}
        page={page}
        onPageChange={setPage}
      />

      {/* Create/Edit dialog */}
      <ProxyFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        proxy={editProxy}
        onSaved={handleSaved}
      />
    </div>
  );
}
