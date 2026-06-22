import { requireSession } from "@/lib/auth";
import { CertificatesClient } from "./components/certificates-client";

export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
  await requireSession();
  return <CertificatesClient />;
}
