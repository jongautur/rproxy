import { requireSession } from "@/lib/auth";
import { ProxiesClient } from "./components/proxies-client";

export const dynamic = "force-dynamic";

export default async function ProxiesPage() {
  await requireSession();
  return <ProxiesClient />;
}
