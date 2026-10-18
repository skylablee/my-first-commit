import { z } from "zod";
import { route, checkOrigin, parseBody, dbError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { adminClient } from "@/lib/server/admin";
import { rateLimit } from "@/lib/operations/guards";
import { runPublications } from "@/lib/threads/worker";
import { AppError } from "@/lib/server/errors";
export const maxDuration = 90;
export async function GET() {
  return route(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db
      .from("publications")
      .select(
        "id,content_id,status,provider_post_id,provider_post_url,scheduled_at,published_at,error_message,retry_count,uncertain,created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    dbError(error);
    return { publications: data ?? [] };
  }, "threads");
}
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "threads", user.id);
    const input = await parseBody(
      request,
      z.object({
        content_id: z.uuid(),
        scheduled_at: z.iso.datetime({ offset: true }).nullable().default(null),
      }),
    );
    const db = adminClient();
    const { data: connection, error: cError } = await db
      .from("social_connections")
      .select("id,expires_at")
      .eq("user_id", user.id)
      .eq("provider", "threads")
      .maybeSingle();
    dbError(cError);
    if (
      !connection ||
      new Date(connection.expires_at).getTime() < Date.now() + 60000
    )
      throw new AppError(
        "THREADS_REQUIRED",
        "먼저 유효한 Threads 계정을 연결해 주세요.",
      );
    const result = await db.rpc("enqueue_publication", {
      p_user_id: user.id,
      p_content_id: input.content_id,
      p_scheduled_at: input.scheduled_at,
    });
    if (result.error)
      throw new AppError(
        "PUBLICATION_REJECTED",
        /PLAN_REQUIRED/.test(result.error.message)
          ? "예약 발행은 Starter 이상 플랜에서 가능합니다."
          : /23505/.test(result.error.code ?? "")
            ? "이미 등록된 게시 작업이 있습니다. 게시 목록을 확인해 주세요."
            : "Threads 본문(1~500자), 채널, 예약 날짜와 소유권을 확인해 주세요.",
        400,
      );
    return {
      id: result.data,
      outcomes: input.scheduled_at ? [] : await runPublications(result.data),
    };
  }, "threads");
}
export async function PATCH(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "threads", user.id);
    const { id } = await parseBody(request, z.object({ id: z.uuid() }));
    const retry = await adminClient().rpc("retry_publication", {
      p_user_id: user.id,
      p_id: id,
    });
    dbError(retry.error);
    if (!retry.data)
      throw new AppError(
        "RETRY_REJECTED",
        "재시도 불가: 처리 중·성공·결과 불명 상태이거나 최대 3회에 도달했습니다.",
        409,
      );
    return { outcomes: await runPublications(id) };
  }, "threads");
}
