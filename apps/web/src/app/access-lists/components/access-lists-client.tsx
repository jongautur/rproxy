"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Search, ShieldCheck, Pencil, Trash2, Users, Globe, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AccessListDialog } from "./access-list-dialog";
import type { AccessListWithRelations } from "@/types/access-list";

export function AccessListsClient() {
  const { toast } = useToast();
  const [lists, setLists] = useState<AccessListWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccessListWithRelations | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccessListWithRelations | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/access-lists");
      const json = await res.json() as { success: boolean; data: { lists: AccessListWithRelations[] } };
      if (json.success) setLists(json.data.lists);
    } catch {
      toast({ variant: "destructive", title: "Failed to load access lists" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  const filtered = lists.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleDelete(list: AccessListWithRelations) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/access-lists/${list.id}`, { method: "DELETE" });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        toast({ title: "Access list deleted" });
        setDeleteTarget(null);
        fetchLists();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: json.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Delete failed" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Access Lists
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {loading ? "Loading..." : `${lists.length} access list${lists.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Access List
        </Button>
      </div>

      {lists.length > 3 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search lists..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <ShieldCheck className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">
            {search ? "No access lists match your search" : "No access lists yet"}
          </p>
          {!search && (
            <p className="text-muted-foreground/60 text-xs">
              Create a list to restrict proxy hosts by IP or require login
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((list) => (
            <Card key={list.id} className="hover:border-border/80 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{list.name}</span>
                      {list.authEnabled && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Lock className="w-3 h-3" />
                          Basic Auth
                          {list.authUsers.length > 0 && ` (${list.authUsers.length})`}
                        </Badge>
                      )}
                      {list.ipRules.length > 0 && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Globe className="w-3 h-3" />
                          {list.ipRules.length} IP rule{list.ipRules.length !== 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    {list.authEnabled && list.authUsers.length > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3 shrink-0" />
                        {list.authUsers.map((u) => u.username).join(", ")}
                      </p>
                    )}
                    {list.ipRules.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {list.ipRules.slice(0, 4).map((r) => (
                          <span
                            key={r.id}
                            className={`text-xs font-mono px-1.5 py-0.5 rounded ${r.action === "allow" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
                          >
                            {r.action} {r.address}
                          </span>
                        ))}
                        {list.ipRules.length > 4 && (
                          <span className="text-xs text-muted-foreground">+{list.ipRules.length - 4} more</span>
                        )}
                      </div>
                    )}
                    {list.proxyHosts.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Used by: {list.proxyHosts.map((h) => h.domain).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => { setEditTarget(list); setDialogOpen(true); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(list)}
                      className="hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AccessListDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editTarget={editTarget}
        onSaved={() => { setDialogOpen(false); fetchLists(); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete access list?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be removed and unlinked from all proxy hosts.
              {deleteTarget && deleteTarget.proxyHosts.length > 0 && (
                <> The {deleteTarget.proxyHosts.length} affected proxy host{deleteTarget.proxyHosts.length !== 1 ? "s" : ""} will be redeployed without access restrictions.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
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
