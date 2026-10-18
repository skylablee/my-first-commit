import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/operations/admin";
import { AppError } from "@/lib/server/errors";
import { StagingCheckPanel } from "@/components/staging-check-panel";
export const dynamic = "force-dynamic";
export default async function StagingPage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AppError && e.status === 401) redirect("/login");
    notFound();
  }
  return <StagingCheckPanel />;
}
