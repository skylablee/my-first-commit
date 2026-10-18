import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../supabase/config";
import { AppError } from "./errors";
export function adminClient() {
  const config = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !key)
    throw new AppError(
      "CONFIG_MISSING",
      "서버 DB 키를 설정해 주세요. AI 사용량과 요청 제한 기록에 필요합니다.",
      503,
    );
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
}
