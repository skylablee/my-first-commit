import "server-only";
import { randomUUID } from "node:crypto";
import { logError, requestContext, type Category } from "../operations/logger";
import { requestOrigin } from "./origin";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, publicError } from "./errors";
import { adminClient } from "./admin";
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== requestOrigin(request))
    throw new AppError("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
}
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_BODY", "JSON 형식으로 요청해 주세요.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_BODY", "요청 내용이 없습니다.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 60000)
        throw new AppError("BODY_TOO_LARGE", "입력 내용이 너무 깁니다.", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return schema.parse(
      JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))),
    );
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "입력 형식과 글자 수를 확인해 주세요.",
    );
  }
}
export function dbError(error: { code?: string; message?: string } | null) {
  if (error?.message?.includes("PUBLICATION_PENDING"))
    throw new AppError(
      "PUBLICATION_PENDING",
      "대기·처리 중인 발행이 있어 콘텐츠를 삭제할 수 없습니다.",
      409,
    );
  if (error?.code === "P0001")
    throw new AppError(
      "PLAN_LIMIT",
      "플랜의 브랜드 수 한도 또는 사용량 제한에 도달했습니다.",
      403,
    );
  if (error)
    throw new AppError(
      "DATABASE_ERROR",
      "데이터 처리에 실패했습니다. DB 스키마와 접근 권한을 확인해 주세요.",
      503,
    );
}
export async function recordError(
  userId: string,
  service: string,
  endpoint: string,
  error: unknown,
) {
  const safe = publicError(error);
  const requestId = logError(
    service === "openai" || service === "gemini"
      ? "AI"
      : service === "google_trends" ||
          service === "google" ||
          service === "naver"
        ? "news"
        : "database",
    safe.code,
  );
  try {
    const db = adminClient();
    await db.from("api_errors").upsert(
      {
        user_id: userId,
        service,
        error_category:["auth","database","AI","news","threads","billing","scheduler"].includes(service)?service:service==="openai"||service==="gemini"?"AI":"news",
        endpoint,
        error_code: safe.code,
        message: safe.message,
        request_id: requestId,
      },
      { onConflict: "request_id", ignoreDuplicates: true },
    );
  } catch {
    /* An unavailable error store must not replace the original error. */
  }
}
export async function route(
  handler: () => Promise<unknown>,
  category: Category = "database",
) {
  const requestId = randomUUID();
  return requestContext.run({ requestId }, async () => {
    try {
      return NextResponse.json(await handler(), {
        headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
      });
    } catch (error) {
      const safe =
        error instanceof ZodError
          ? new AppError("VALIDATION_ERROR", "입력 형식을 확인해 주세요.")
          : publicError(error);
      logError(
        safe.code.startsWith("AUTH") || safe.code === "UNAUTHORIZED"
          ? "auth"
          : safe.code.includes("BILLING") || safe.code.includes("WEBHOOK")
            ? "billing"
            : safe.code.includes("THREADS")
              ? "threads"
              : category,
        safe.code,
        requestId,
      );
      const userId = requestContext.getStore()?.userId;
      if (userId) await recordError(userId, category, "server", safe);
      return NextResponse.json(
        {
          error: {
            code: safe.code,
            message: safe.message,
            request_id: requestId,
          },
        },
        {
          status: safe.status,
          headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
        },
      );
    }
  });
}
export async function enforceRate(userId: string, service: string) {
  const { data, error } = await adminClient().rpc("consume_api_request", {
    p_service: service,
    p_user_id: userId,
  });
  dbError(error);
  if (!data)
    throw new AppError(
      "RATE_LIMIT",
      "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
}
