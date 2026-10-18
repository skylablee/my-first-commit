import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { guardBrand } from "../operations/guards";
import { AppError } from "../server/errors";
import { runPublications } from "../threads/worker";
import { result, failure } from "./results";
export const STAGING_POST_TEXT = "BizContent AI staging connection test";
export async function queueThreadsTest(
  adminId: string,
  session: SupabaseClient,
  brandId: string,
  scheduled: boolean,
) {
  await guardBrand(adminId, brandId);
  const db = adminClient();
  const c = await db
    .from("social_connections")
    .select("id,expires_at")
    .eq("user_id", adminId)
    .eq("provider", "threads")
    .single();
  dbError(c.error);
  if (!c.data || new Date(c.data.expires_at).getTime() <= Date.now() + 60000)
    throw new AppError(
      "THREADS_REQUIRED",
      "먼저 OAuth로 유효한 Threads 계정을 연결하세요.",
    );
  const created = await session
    .from("contents")
    .insert({
      user_id: adminId,
      brand_id: brandId,
      title: scheduled
        ? "staging +5 minute schedule"
        : "staging immediate publish",
      body: STAGING_POST_TEXT,
      platform: "threads",
      status: "draft",
    })
    .select("id")
    .single();
  dbError(created.error);
  const registered = await db
    .from("staging_resources")
    .insert({
      admin_id: adminId,
      user_id: adminId,
      kind: scheduled ? "threads_schedule_content" : "threads_content",
      resource_id: created.data!.id,
    });
  dbError(registered.error);
  const queued = await db.rpc("enqueue_publication", {
    p_user_id: adminId,
    p_content_id: created.data!.id,
    p_scheduled_at: scheduled
      ? new Date(Date.now() + 300000).toISOString()
      : null,
  });
  if (queued.error)
    throw new AppError(
      "SCHEDULE_TEST",
      queued.error.message.includes("PLAN_REQUIRED")
        ? "관리자 테스트 계정에 Starter 이상 테스트 구독이 필요합니다."
        : "테스트 게시 작업 등록에 실패했습니다.",
      409,
    );
  const tagged = await db
    .from("staging_resources")
    .insert({
      admin_id: adminId,
      user_id: adminId,
      kind: scheduled ? "threads_schedule_job" : "threads_job",
      resource_id: queued.data,
    });
  dbError(tagged.error);
  if (!scheduled) await runPublications(queued.data);
  return {
    pending: true,
    publication_id: queued.data,
    scheduled_at: scheduled ? "+5 minutes" : null,
    message: scheduled
      ? "예약 등록 완료. 실제 scheduler 실행을 관찰해야 PASS로 판정합니다."
      : "게시 요청 완료. 결과 조회로 최종 판정합니다.",
  };
}
export async function observeThreads(adminId: string, publicationId: string) {
  const db = adminClient();
  let scheduled = false;
  try {
    const marker = await db
      .from("staging_resources")
      .select("kind")
      .eq("admin_id", adminId)
      .eq("resource_id", publicationId)
      .in("kind", ["threads_job", "threads_schedule_job"])
      .single();
    dbError(marker.error);
    if (!marker.data)
      throw new AppError(
        "TEST_RESOURCE",
        "내가 생성한 staging 게시 작업만 관찰할 수 있습니다.",
        403,
      );
    scheduled = marker.data.kind === "threads_schedule_job";
    const job = await db
      .from("publications")
      .select(
        "status,provider_post_id,published_at,scheduled_at,username,retry_count,uncertain,error_message,last_executor",
      )
      .eq("id", publicationId)
      .eq("user_id", adminId)
      .single();
    dbError(job.error);
    const history = await db
      .from("publication_transitions")
      .select("status,created_at")
      .eq("publication_id", publicationId)
      .order("created_at");
    dbError(history.error);
    const value = job.data!,
      states = (history.data ?? []).map((i) => i.status);
    if (["pending", "scheduled", "publishing"].includes(value.status))
      return {
        pending: true,
        publication_id: publicationId,
        message: "실제 게시 결과를 기다리는 중입니다.",
        status: value.status,
        history: history.data,
      };
    if (
      value.status !== "published" ||
      !value.provider_post_id ||
      !value.published_at ||
      !value.username ||
      value.uncertain
    )
      throw new AppError(
        "THREADS_TEST_FAILED",
        "테스트 게시가 성공 상태가 아닙니다. 연동 관리의 오류와 재시도 횟수를 확인하세요.",
        409,
      );
    if (
      states.filter((s) => s === "published").length !== 1 ||
      !states.includes("publishing")
    )
      throw new AppError(
        "PUBLICATION_DUPLICATE",
        "게시 상태 전이 또는 중복 성공 기록이 올바르지 않습니다.",
        409,
      );
    if (
      scheduled &&
      (!states.includes("scheduled") ||
        value.last_executor !== "cron" ||
        new Date(value.published_at) < new Date(value.scheduled_at))
    )
      throw new AppError(
        "SCHEDULER_TEST",
        "정상 Cron 예약 발행의 실행 시점·실행자·상태 전이를 확인하지 못했습니다.",
        409,
      );
    return result(
      "Threads",
      scheduled ? "scheduled_publish" : "immediate_publish",
      "PASS",
      "실제 게시 ID·계정·시간과 작업당 한 번의 성공 전이를 확인했습니다.",
      {
        api_called: true,
        publication_id: publicationId,
        provider_post_id: value.provider_post_id,
        published_at: value.published_at,
        username: value.username,
        retry_count: value.retry_count,
        history: history.data,
        scope:
          "앱의 작업 성공 기록 기준입니다. 제공자 전체 계정에 수동 중복 게시가 없는지까지 증명하지는 않습니다.",
      },
    );
  } catch (error) {
    return failure(
      "Threads",
      scheduled ? "scheduled_publish" : "immediate_publish",
      error,
      { publication_id: publicationId },
    );
  }
}
