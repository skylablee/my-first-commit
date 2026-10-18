import { redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function Page() {
  const db = await createClient();
  if (!db) redirect("/login");
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  return (
    <Workspace
      userId={data.user.id}
      userLabel={
        typeof data.user.user_metadata.name === "string"
          ? data.user.user_metadata.name
          : (data.user.email ?? "사장님")
      }
    />
  );
}
