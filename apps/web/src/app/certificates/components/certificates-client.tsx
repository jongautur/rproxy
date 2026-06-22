"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, Lock, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { CertTable } from "./cert-table";
import { IssueCertDialog } from "./issue-cert-dialog";
import { UploadCertDialog } from "./upload-cert-dialog";
import type { CertificateWithHosts } from "@/types/certificate";

interface PaginatedCerts {
  items: CertificateWithHosts[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export function CertificatesClient() {
  const { toast } = useToast();
  const [data, setData] = useState<PaginatedCerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [issueOpen, setIssueOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const fetchCerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: "20", ...(search && { search }) });
      const res = await fetch(`/api/certificates?${params}`);
      const json = await res.json() as { success: boolean; data: PaginatedCerts };
      if (json.success) setData(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load certificates" });
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    const id = setTimeout(() => fetchCerts(), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [fetchCerts, search]);

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="w-6 h-6 text-primary" />
            SSL Certificates
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {data ? `${data.total} certificate${data.total !== 1 ? "s" : ""}` : "Manage SSL/TLS certificates"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Certificate
          </Button>
          <Button size="sm" onClick={() => setIssueOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Issue Certificate
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search domains..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      <CertTable
        data={data}
        loading={loading}
        onRefresh={fetchCerts}
        page={page}
        onPageChange={setPage}
      />

      <IssueCertDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        onIssued={() => { setIssueOpen(false); void fetchCerts(); }}
      />

      <UploadCertDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => { setUploadOpen(false); void fetchCerts(); }}
      />
    </div>
  );
}
