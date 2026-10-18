import "server-only";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { AppError } from "../server/errors";
import { decrypt } from "../operations/crypto";
import { effectivePlan, guardBrand } from "../operations/guards";
import { plans } from "../plans";
import {
  MetaThreadsProvider,
  ThreadsError,
  type ThreadsProvider,
} from "./provider";
import { logError } from "../operations/logger";
type Job = {
  id: string;
  user_id: string;
  content_id: string;
  body_snapshot: string;
  scheduled_at: string | null;
  provider_container_id: string | null;
  lock_token: string;
  retry_count: number;
};
export async function runPublications(
  id?: string,
  provider: ThreadsProvider = new MetaThreadsProvider(),
  executor:"immediate"|"cron"="immediate",
) {
  const db = adminClient();
  const { data, error } = await db.rpc("claim_publications", {
    p_id: id ?? null,
  });
  dbError(error);
  const outcomes: { id: string; status: string }[] = [];
  for (const job of (data ?? []) as Job[]) {
    let publishStarted = false;
    try {
      if (job.scheduled_at && !plans[await effectivePlan(job.user_id)].schedule)
        throw new AppError(
          "PLAN_REQUIRED",
          "예약 발행 플랜이 만료되었습니다. 플랜을 확인한 후 다시 시도해 주세요.",
          403,
        );
      const marked=await db.from("publications").update({last_executor:executor}).eq("id",job.id).eq("lock_token",job.lock_token);dbError(marked.error);
      const content = await db
        .from("contents")
        .select("brand_id")
        .eq("id", job.content_id)
        .eq("user_id", job.user_id)
        .single();
      dbError(content.error);
      if (!content.data)
        throw new AppError("NOT_FOUND", "게시할 콘텐츠가 없습니다.", 404);
      await guardBrand(job.user_id, content.data.brand_id);
      const connection = await db
        .from("social_connections")
        .select("provider_user_id,username,access_token_encrypted,expires_at")
        .eq("user_id", job.user_id)
        .eq("provider", "threads")
        .single();
      dbError(connection.error);
      if (
        !connection.data ||
        new Date(connection.data.expires_at).getTime() <= Date.now() + 60000
      )
        throw new AppError(
          "THREADS_EXPIRED",
          "Threads 연결을 다시 설정해 주세요.",
          400,
        );
      const token = decrypt(
        connection.data.access_token_encrypted,
        `threads:${job.user_id}`,
      );
      let container = job.provider_container_id;
      if (!container) {
        container = await provider.createContainer(
          token,
          connection.data.provider_user_id,
          job.body_snapshot,
        );
        const saved = await db
          .from("publications")
          .update({ provider_container_id: container })
          .eq("id", job.id)
          .eq("lock_token", job.lock_token);
        dbError(saved.error);
      }
      const status = await provider.containerStatus(token, container);
      if (status === "IN_PROGRESS")
        throw new ThreadsError(
          "THREADS_PROCESSING",
          "Threads에서 게시물을 준비 중입니다. 잠시 후 다시 확인합니다.",
          true,
        );
      if (status !== "FINISHED")
        throw new ThreadsError(
          "THREADS_CONTAINER",
          "Threads 게시 준비가 실패했거나 이미 처리되었습니다.",
          false,
          status === "PUBLISHED",
        );
      // Durable checkpoint BEFORE the non-idempotent request. If process crashes,
      // the expired lease is quarantined; neither cron nor the retry button republishes.
      const checkpoint = await db
        .from("publications")
        .update({ uncertain: true, username:connection.data.username })
        .eq("id", job.id)
        .eq("lock_token", job.lock_token);
      dbError(checkpoint.error);
      publishStarted = true;
      const postId = await provider.publishContainer(
        token,
        connection.data.provider_user_id,
        container,
      );
      const finished = await db.rpc("finish_publication", {
        p_id: job.id,
        p_lock_token: job.lock_token,
        p_post_id: postId,
      });
      dbError(finished.error);
      if (!finished.data)
        throw new ThreadsError(
          "THREADS_UNCERTAIN",
          "게시 결과 저장을 확인하지 못했습니다.",
          false,
          true,
        );
      if (provider.postLink) {
        try {
          const link = await provider.postLink(token, postId);
          if (link)
            await db
              .from("publications")
              .update({ provider_post_url: link })
              .eq("id", job.id)
              .eq("lock_token", job.lock_token);
        } catch {
          /* A link lookup cannot turn a successful post into a retry. */
        }
      }
      outcomes.push({ id: job.id, status: "published" });
    } catch (error) {
      const uncertain =
        error instanceof ThreadsError ? error.uncertain : publishStarted;
      const retryable =
        error instanceof ThreadsError &&
        error.retryable &&
        !uncertain &&
        job.retry_count < 3;
      const message =
        error instanceof AppError
          ? error.message
          : "게시 처리에 실패했습니다. 운영자에게 문의해 주세요.";
      const updated = await db
        .from("publications")
        .update({
          status: retryable ? "pending" : "failed",
          uncertain,
          error_message: message,
          retry_count: retryable ? job.retry_count + 1 : job.retry_count,
          next_attempt_at: new Date(
            Date.now() + 60000 * 2 ** job.retry_count,
          ).toISOString(),
          locked_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("lock_token", job.lock_token);
      if (updated.error)
        logError("scheduler", "PUBLICATION_STATUS_WRITE_FAILED");
      logError(
        "threads",
        error instanceof AppError ? error.code : "PUBLISH_FAILED",
      );
      outcomes.push({
        id: job.id,
        status: uncertain ? "uncertain" : retryable ? "retrying" : "failed",
      });
    }
  }
  return outcomes;
}
