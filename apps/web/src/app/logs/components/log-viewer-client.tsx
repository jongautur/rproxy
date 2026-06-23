"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  FileText, Play, Pause, RefreshCw, Download,
  Search, ChevronDown, Loader2, Wifi, WifiOff, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

interface LogFile {
  name: string;
  path: string;
}

type ConnStatus = "disconnected" | "connecting" | "connected" | "error";

function colorLine(line: string): string {
  // nginx access log: highlight status codes
  return line
    .replace(/" (5\d\d) /g, '" <span class="text-red-400">$1</span> ')
    .replace(/" (4\d\d) /g, '" <span class="text-yellow-400">$1</span> ')
    .replace(/" (3\d\d) /g, '" <span class="text-blue-400">$1</span> ')
    .replace(/" (2\d\d) /g, '" <span class="text-green-400">$1</span> ');
}

const MAX_LINES = 2000;

export function LogViewerClient() {
  const { toast } = useToast();
  const [files, setFiles] = useState<LogFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [lines, setLines] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [liveMode, setLiveMode] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connStatus, setConnStatus] = useState<ConnStatus>("disconnected");
  const [lineCount, setLineCount] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const logBodyRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<string[]>([]);

  // Keep linesRef in sync for callbacks
  linesRef.current = lines;

  // Load available log files
  useEffect(() => {
    fetch("/api/logs")
      .then((r) => r.json() as Promise<{ success: boolean; data: { files: LogFile[] } }>)
      .then((j) => {
        if (j.success) {
          setFiles(j.data.files);
          if (j.data.files.length > 0) setSelectedFile(j.data.files[0]!.name);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll when new lines arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, autoScroll]);

  // Detect manual scroll up → disable auto-scroll
  const handleScroll = useCallback(() => {
    const el = logBodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const appendLines = useCallback((newLines: string[]) => {
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      return combined.length > MAX_LINES ? combined.slice(-MAX_LINES) : combined;
    });
    setLineCount((c) => c + newLines.length);
  }, []);

  const connectSSE = useCallback((file: string) => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    setLines([]);
    setLineCount(0);
    setConnStatus("connecting");

    const es = new EventSource(`/api/logs/stream?file=${encodeURIComponent(file)}`);
    esRef.current = es;

    es.addEventListener("init", (e) => {
      const { lines: initLines } = JSON.parse(e.data) as { lines: string[] };
      setLines(initLines);
      setLineCount(initLines.length);
      setConnStatus("connected");
    });

    es.addEventListener("lines", (e) => {
      const { lines: newLines } = JSON.parse(e.data) as { lines: string[] };
      appendLines(newLines);
    });

    es.addEventListener("rotate", () => {
      setLines([]);
      setLineCount(0);
      toast({ title: "Log rotated", description: `${file} was rotated` });
    });

    es.addEventListener("heartbeat", () => {
      setConnStatus("connected");
    });

    es.addEventListener("error", () => {
      setConnStatus("error");
      // EventSource auto-reconnects; just surface the status
    });

    es.onopen = () => setConnStatus("connected");
  }, [appendLines, toast]);

  const disconnectSSE = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setConnStatus("disconnected");
  }, []);

  // Connect SSE when file selected and live mode is on
  useEffect(() => {
    if (!selectedFile) return;
    if (liveMode) {
      connectSSE(selectedFile);
    } else {
      disconnectSSE();
      // Load static snapshot
      setLines([]);
      setLineCount(0);
      setConnStatus("connecting");
      fetch(`/api/logs?file=${encodeURIComponent(selectedFile)}&lines=500`)
        .then((r) => r.json() as Promise<{ success: boolean; data: { content: string } }>)
        .then((j) => {
          if (j.success) {
            const ls = j.data.content.split("\n").filter(Boolean);
            setLines(ls);
            setLineCount(ls.length);
          }
          setConnStatus("disconnected");
        })
        .catch(() => setConnStatus("error"));
    }

    return () => disconnectSSE();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, liveMode]);

  // Filter lines
  const filteredLines = search.trim()
    ? lines.filter((l) => l.toLowerCase().includes(search.toLowerCase()))
    : lines;

  function handleDownload() {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedFile || "nginx.log";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 md:p-8 space-y-6 animate-fade-in h-full flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" />
            Log Viewer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live nginx access and error logs
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* File select */}
            <Select value={selectedFile} onValueChange={setSelectedFile} disabled={files.length === 0}>
              <SelectTrigger className="w-full sm:w-64">
                <FileText className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                <SelectValue placeholder={files.length === 0 ? "No log files found" : "Select log file"} />
              </SelectTrigger>
              <SelectContent>
                {files.map((f) => (
                  <SelectItem key={f.name} value={f.name}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Live mode toggle */}
            <Button
              variant={liveMode ? "default" : "outline"}
              size="sm"
              onClick={() => setLiveMode((v) => !v)}
              className="gap-2"
            >
              {liveMode ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {liveMode ? "Live" : "Static"}
            </Button>

            {/* Refresh (static mode) */}
            {!liveMode && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setLiveMode(false); setSelectedFile((f) => f); }}
                className="gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
            )}

            {/* Connection status */}
            <div className="flex items-center gap-1.5 text-xs">
              {connStatus === "connected" && (
                <><Wifi className="w-3.5 h-3.5 text-green-500" /><span className="text-green-500">Live</span></>
              )}
              {connStatus === "connecting" && (
                <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Connecting…</span></>
              )}
              {connStatus === "error" && (
                <><WifiOff className="w-3.5 h-3.5 text-destructive" /><span className="text-destructive">Reconnecting…</span></>
              )}
              {connStatus === "disconnected" && (
                <><WifiOff className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-muted-foreground">Static</span></>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Line count */}
            <Badge variant="secondary" className="font-mono text-xs">
              {search ? `${filteredLines.length} / ${lineCount}` : lineCount} lines
            </Badge>

            {/* Search */}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Filter…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 w-44 text-sm"
              />
            </div>

            {/* Download */}
            <Button variant="ghost" size="icon-sm" onClick={handleDownload} title="Download" disabled={lines.length === 0}>
              <Download className="w-4 h-4" />
            </Button>

            {/* Scroll to bottom */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
              title="Scroll to bottom"
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Log output */}
      <div
        ref={logBodyRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-auto bg-[#0d1117] rounded-xl border border-border font-mono text-xs leading-5 p-4"
        style={{ minHeight: "60vh", maxHeight: "70vh" }}
      >
        {filteredLines.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            {connStatus === "connecting"
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading logs…</>
              : !selectedFile
              ? "No log file selected"
              : search
              ? "No lines match filter"
              : "Log file is empty"
            }
          </div>
        ) : (
          filteredLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all py-px px-1 rounded hover:bg-white/5",
                line.includes(" 5") ? "text-red-300" :
                line.includes(" 4") ? "text-yellow-200" :
                line.includes("[error]") || line.includes("[crit]") ? "text-red-400" :
                line.includes("[warn]") ? "text-yellow-300" :
                "text-[#c9d1d9]"
              )}
              dangerouslySetInnerHTML={{ __html: colorLine(line) }}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {!autoScroll && lines.length > 0 && (
        <button
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
          className="fixed bottom-8 right-8 flex items-center gap-2 bg-primary text-primary-foreground text-xs font-medium px-3 py-2 rounded-full shadow-lg hover:opacity-90 transition-opacity"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
