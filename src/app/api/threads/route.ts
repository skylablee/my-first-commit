import { route, checkOrigin, dbError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { adminClient } from "@/lib/server/admin";
import { rateLimit } from "@/lib/operations/guards";
import { audit } from "@/lib/operations/audit";
export async function GET() {
  return route(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db
      .from("social_connections")
      .select("id,provider,provider_user_id,username,expires_at,scopes")
      .eq("user_id", user.id)
      .eq("provider", "threads")
      .maybeSingle();
    dbError(error);
    return { connection: data };
  }, "threads");
}
export async function DELETE(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "oauth", user.id);
    const { error } = await adminClient()
      .from("social_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("provider", "threads");
    dbError(error);
    await audit(user.id, "integration.disconnect", "threads");
    return { ok: true };
  }, "threads");
}
