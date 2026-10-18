import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const db = await createClient();
  if (db) {
    const { data } = await db.auth.getUser();
    if (data.user) redirect("/");
  }
  return (
    <div className="auth-layout">
      <AuthForm configured={Boolean(db)} />
    </div>
  );
}
