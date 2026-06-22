import { requireSession } from "@/lib/auth";
import { AccessListsClient } from "./components/access-lists-client";

export const dynamic = "force-dynamic";

export default async function AccessListsPage() {
  await requireSession();
  return <AccessListsClient />;
}
