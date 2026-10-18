import "server-only";
import { requireUser } from "../server/auth";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { AppError } from "../server/errors";
export async function requireAdmin() {
  const auth = await requireUser();
  const { data, error } = await adminClient()
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  dbError(error);
  if (data?.role !== "admin")
    throw new AppError("FORBIDDEN", "관리자 권한이 필요합니다.", 403);
  return auth;
}
