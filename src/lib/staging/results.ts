import "server-only";
import { randomUUID } from "node:crypto";
import { adminClient } from "../server/admin";
import { requestContext } from "../operations/logger";
import { AppError } from "../server/errors";
import { dbError } from "../server/api";
import type { CheckResult, StagingService, ResultStatus } from "./types";
export function result(
  service: StagingService,
  testName: string,
  status: ResultStatus,
  message: string,
  details: Record<string, unknown> = {},
  category?: string,
): CheckResult {
  return {
    service,
    test_name: testName,
    status,
    safe_message: message,
    details,
    request_id: requestContext.getStore()?.requestId ?? randomUUID(),
    created_at: new Date().toISOString(),
    ...(category ? { error_category: category } : {}),
  };
}
export function failure(
  service: StagingService,
  testName: string,
  error: unknown,
  details: Record<string, unknown> = {},
): CheckResult {
  const safe =
    error instanceof AppError
      ? error
      : new AppError(
          "INTERNAL_ERROR",
          "테스트 처리에 실패했습니다. 요청 ID로 로그를 확인해 주세요.",
          500,
        );
  return result(
    service,
    testName,
    safe.code === "CONFIG_MISSING" ? "NOT CONFIGURED" : "FAIL",
    safe.message,
    details,
    safe.code,
  );
}
export async function saveResult(adminId: string, r: CheckResult) {
  const { data, error } = await adminClient()
    .from("staging_checks")
    .insert({
      admin_id: adminId,
      test_name: r.test_name,
      service: r.service,
      status: r.status,
      safe_message: r.safe_message,
      request_id: r.request_id,
      latency_ms: r.latency_ms ?? null,
      error_category: r.error_category ?? null,
      details: r.details,
    })
    .select("id")
    .single();
  dbError(error);
  return { ...r, id: data?.id };
}
