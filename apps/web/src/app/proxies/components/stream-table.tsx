"use client";

import { useState } from "react";
import { Pencil, Trash2, Loader2, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import type { StreamHost } from "@prisma/client";

interface Props {
  items: StreamHost[];
  onEdit: (s: StreamHost) => void;
  onRefresh: () => void;
}

const PROTOCOL_LABELS: Record<string, string> = { TCP: "TCP", UDP: "UDP", TCP_UDP: "TCP+UDP" };

function EmptyState() {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
      <p className="font-medium text-foreground">No stream hosts</p>
      <p className="text-sm mt-1">Forward raw TCP/UDP ports — databases, game servers, MQTT, etc.</p>
    </div>
  );
}

export function StreamTable({ items, onEdit, onRefresh }: Props) {
  const { toast } = useToast();
  const [deleteTarget, setDeleteTarget] = useState<StreamHost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function handleToggle(stream: StreamHost) {
    setToggling(stream.id);
    try {
      await fetch(`/api/streams/${stream.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !stream.enabled }),
      });
      onRefresh();
    } catch { toast({ variant: "destructive", title: "Toggle failed" }); }
    finally { setToggling(null); }
  }

  async function handleDelete(stream: StreamHost) {
    setDeleting(true);
    try {
      await fetch(`/api/streams/${stream.id}`, { method: "DELETE" });
      toast({ title: "Stream host deleted" });
      onRefresh();
    } catch { toast({ variant: "destructive", title: "Delete failed" }); }
    finally { setDeleting(false); setDeleteTarget(null); }
  }

  if (items.length === 0) return <EmptyState />;

  return (
    <>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-muted-foreground">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Protocol</th>
              <th className="text-left px-4 py-3 font-medium">Listen</th>
              <th className="text-left px-4 py-3 font-medium">Forward</th>
              <th className="text-center px-4 py-3 font-medium">Enabled</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3">
                  <Badge variant="outline">{PROTOCOL_LABELS[s.protocol] ?? s.protocol}</Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs">:{s.listenPort}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.forwardHost}:{s.forwardPort}</td>
                <td className="px-4 py-3 text-center">
                  {toggling === s.id
                    ? <Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" />
                    : <Switch checked={s.enabled} onCheckedChange={() => handleToggle(s)} />
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" onClick={() => onEdit(s)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon-sm" variant="ghost"
                      className="hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete stream host?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-semibold text-foreground">{deleteTarget?.name}</span> — port{" "}
              <span className="font-mono">{deleteTarget?.listenPort}</span> will stop forwarding immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
