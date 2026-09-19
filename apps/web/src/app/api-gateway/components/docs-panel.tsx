"use client";

import { useState, useEffect, useCallback } from "react";
import { BookOpen, Loader2, ExternalLink, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { ApiDocsSettingsDialog } from "./api-docs-settings-dialog";
import type { ApiDocsSummary, ApiDocsCoverage } from "@/types/api-gateway";

function coverageColor(pct: number): string {
  if (pct >= 80) return "text-success";
  if (pct >= 40) return "text-warning";
  return "text-destructive";
}

function MissingRoutesList({ apiId }: { apiId: string }) {
  const [coverage, setCoverage] = useState<ApiDocsCoverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/gateway/docs/${apiId}`)
      .then((r) => r.json() as Promise<{ success: boolean; data: { coverage: ApiDocsCoverage } }>)
      .then((j) => { if (j.success) setCoverage(j.data.coverage); })
      .finally(() => setLoading(false));
  }, [apiId]);

  if (loading) return <div className="py-4 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (!coverage || coverage.missing.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">Every route counted toward coverage is documented.</p>;
  }

  return (
    <div className="space-y-1 py-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Missing documentation</p>
      {coverage.missing.map((r) => (
        <div key={r.routeId} className="flex items-center gap-2 text-sm font-mono py-1 border-b border-border/50 last:border-0">
          <span className="text-muted-foreground w-16 shrink-0">{r.methods.length > 0 ? r.methods.join("/") : "ANY"}</span>
          <span className="truncate">{r.path}</span>
        </div>
      ))}
    </div>
  );
}

function DocsCard({ summary, onEdit }: { summary: ApiDocsSummary; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate">{summary.docsTitle || summary.apiName}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{summary.apiDomain}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {summary.docsEnabled ? (
              <Badge variant="success">Enabled</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
            )}
            {summary.docsEnabled && (summary.docsPublic ? <Badge variant="info">Public</Badge> : <Badge variant="secondary">Private</Badge>)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Documented</p>
            <p className="font-medium">{summary.documentedRoutes} endpoint{summary.documentedRoutes !== 1 ? "s" : ""}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Undocumented</p>
            <p className="font-medium">{summary.undocumentedRoutes} endpoint{summary.undocumentedRoutes !== 1 ? "s" : ""}</p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Documentation coverage</span>
            <span className={coverageColor(summary.coveragePercent)}>{summary.coveragePercent}%</span>
          </div>
          <Progress value={summary.coveragePercent} />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {summary.undocumentedRoutes} missing
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5" /> Edit Docs
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!summary.docsSlug || !summary.docsEnabled}
              onClick={() => window.open(`/docs/${summary.docsSlug}`, "_blank")}
            >
              <ExternalLink className="w-3.5 h-3.5" /> Preview
            </Button>
          </div>
        </div>

        {expanded && <MissingRoutesList apiId={summary.apiId} key={summary.apiId + summary.undocumentedRoutes} />}
      </CardContent>
    </Card>
  );
}

export function DocsPanel() {
  const { toast } = useToast();
  const [summaries, setSummaries] = useState<ApiDocsSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ApiDocsSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gateway/docs");
      const json = (await res.json()) as { success: boolean; data: ApiDocsSummary[] };
      if (json.success) setSummaries(json.data);
    } catch {
      toast({ variant: "destructive", title: "Failed to load documentation" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchSummaries(); }, [fetchSummaries]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summaries || summaries.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
        No APIs configured yet — add one under the APIs tab first.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">API Documentation</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {summaries.map((s) => (
          <DocsCard
            key={s.apiId}
            summary={s}
            onEdit={() => { setEditing(s); setDialogOpen(true); }}
          />
        ))}
      </div>

      <ApiDocsSettingsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        api={editing}
        onSaved={() => { setDialogOpen(false); setEditing(null); void fetchSummaries(); }}
      />
    </div>
  );
}
