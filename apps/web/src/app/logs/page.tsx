import { requireSession } from "@/lib/auth";
import { LogViewerClient } from "./components/log-viewer-client";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  await requireSession();
  return <LogViewerClient />;
}
