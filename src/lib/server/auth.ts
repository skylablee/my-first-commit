import { appEnvironment } from "../environment";
import { checkBillingMode } from "../operations/mode";
import "server-only";
import { adminClient } from "./admin";
import { logError, requestContext } from "../operations/logger";
import { createClient } from "../supabase/server";
import { AppError } from "./errors";
export async function requireUser() {
  const db = await createClient();
  if (!db)
    throw new AppError(
      "CONFIG_MISSING",
      "Supabase 환경변수를 설정해 주세요.",
      503,
    );
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    throw new AppError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
  const context = requestContext.getStore();
  if (context) context.userId = data.user.id;
  if (["production", "staging"].includes(appEnvironment()))
    await checkBillingMode();
  try {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const { error } = await adminClient()
      .from("active_users")
      .upsert(
        { user_id: data.user.id, day },
        { onConflict: "user_id,day", ignoreDuplicates: true },
      );
    if (error) logError("database", "ACTIVITY_WRITE_FAILED");
  } catch {
    logError("database", "ACTIVITY_WRITE_FAILED");
  }
  return { db, user: data.user };
}
