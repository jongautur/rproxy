"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Plug, Users, BarChart3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApisTable } from "./apis-table";
import { ApiFormDialog } from "./api-form-dialog";
import { CustomersTable } from "./customers-table";
import { CustomerFormDialog } from "./customer-form-dialog";
import { AnalyticsPanel } from "./analytics-panel";
import type { ApiWithRelations, CustomerWithRelations } from "@/types/api-gateway";

interface PaginatedApis {
  items: ApiWithRelations[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface PaginatedCustomers {
  items: CustomerWithRelations[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function ApiGatewayClient() {
  const { toast } = useToast();

  const [apiData, setApiData] = useState<PaginatedApis | null>(null);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiPage, setApiPage] = useState(1);
  const [apiSearch, setApiSearch] = useState("");
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [editApi, setEditApi] = useState<ApiWithRelations | null>(null);

  const [customerData, setCustomerData] = useState<PaginatedCustomers | null>(null);
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState<CustomerWithRelations | null>(null);

  const [activeTab, setActiveTab] = useState("apis");

  const fetchApis = useCallback(async () => {
    setApiLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(apiPage),
        perPage: "20",
        ...(apiSearch && { search: apiSearch }),
      });
      const res = await fetch(`/api/gateway/apis?${params}`);
      const json = (await res.json()) as { success: boolean; data: PaginatedApis };
      if (json.success) setApiData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load APIs" });
    } finally {
      setApiLoading(false);
    }
  }, [apiPage, apiSearch, toast]);

  const fetchCustomers = useCallback(async () => {
    setCustomerLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(customerPage),
        perPage: "20",
        ...(customerSearch && { search: customerSearch }),
      });
      const res = await fetch(`/api/gateway/customers?${params}`);
      const json = (await res.json()) as { success: boolean; data: PaginatedCustomers };
      if (json.success) setCustomerData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load customers" });
    } finally {
      setCustomerLoading(false);
    }
  }, [customerPage, customerSearch, toast]);

  useEffect(() => {
    const id = setTimeout(() => void fetchApis(), apiSearch ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchApis, apiSearch]);

  useEffect(() => {
    const id = setTimeout(() => void fetchCustomers(), customerSearch ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchCustomers, customerSearch]);

  return (
    <div className="p-4 md:p-8 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="w-6 h-6 text-primary" />
            API Gateway
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {apiData?.total ?? 0} API{apiData?.total !== 1 ? "s" : ""} configured
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === "apis" && (
            <Button size="sm" onClick={() => { setEditApi(null); setApiDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add API
            </Button>
          )}
          {activeTab === "customers" && (
            <Button size="sm" onClick={() => { setEditCustomer(null); setCustomerDialogOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="apis" className="gap-2">
            <Plug className="w-4 h-4" />
            APIs
            {apiData && <span className="ml-1 text-xs bg-muted rounded px-1.5 py-0.5">{apiData.total}</span>}
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-2">
            <Users className="w-4 h-4" />
            Customers
            {customerData && <span className="ml-1 text-xs bg-muted rounded px-1.5 py-0.5">{customerData.total}</span>}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="apis" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name or domain..."
              value={apiSearch}
              onChange={(e) => { setApiSearch(e.target.value); setApiPage(1); }}
              className="pl-9"
            />
          </div>
          <ApisTable
            data={apiData}
            loading={apiLoading}
            onEdit={(a) => { setEditApi(a); setApiDialogOpen(true); }}
            onRefresh={fetchApis}
            page={apiPage}
            onPageChange={setApiPage}
          />
        </TabsContent>

        <TabsContent value="customers" className="mt-4 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name or email..."
              value={customerSearch}
              onChange={(e) => { setCustomerSearch(e.target.value); setCustomerPage(1); }}
              className="pl-9"
            />
          </div>
          <CustomersTable
            data={customerData}
            loading={customerLoading}
            onEdit={(c) => { setEditCustomer(c); setCustomerDialogOpen(true); }}
            onRefresh={fetchCustomers}
            page={customerPage}
            onPageChange={setCustomerPage}
          />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <AnalyticsPanel />
        </TabsContent>
      </Tabs>

      <ApiFormDialog
        open={apiDialogOpen}
        onOpenChange={setApiDialogOpen}
        api={editApi}
        onSaved={() => { setApiDialogOpen(false); setEditApi(null); void fetchApis(); }}
      />
      <CustomerFormDialog
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        customer={editCustomer}
        onSaved={() => { setCustomerDialogOpen(false); setEditCustomer(null); void fetchCustomers(); }}
      />
    </div>
  );
}
