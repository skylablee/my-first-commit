import "server-only";
import { adminClient } from "../server/admin";
import { AppError } from "../server/errors";
import { dbError } from "../server/api";
import { privateIdentity, secureEqual } from "./crypto";
import { isPlan, plans, type PlanId } from "../plans";
export async function effectivePlan(userId: string): Promise<PlanId> {
  const { data, error } = await adminClient().rpc("effective_plan", {
    p_user_id: userId,
  });
  dbError(error);
  return isPlan(data) ? data : "FREE";
}
export async function guardFeature(
  userId: string,
  feature: "schedule" | "repurpose" | "analytics",
) {
  const plan = await effectivePlan(userId);
  if (!plans[plan][feature])
    throw new AppError(
      "PLAN_REQUIRED",
      `${feature === "schedule" ? "예약 발행" : feature === "repurpose" ? "콘텐츠 재가공" : "고급 분석"}은 상위 플랜에서 사용할 수 있습니다.`,
      403,
    );
  return plan;
}
export async function rateLimit(
  request: Request,
  service: string,
  userId?: string,
) {
  // Only trust platform-normalized client IP on Vercel. Otherwise all requests
  // share an IP bucket: safe against spoofed forwarded headers, conservative locally.
  const ip =
    process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown"
      : "shared";
  const subjects = [
    privateIdentity(`ip:${service}:${ip}`),
    ...(userId ? [privateIdentity(`user:${service}:${userId}`)] : []),
  ];
  const limits: Record<string, number> = {
    ai: 15,
    news: 30,
    threads: 10,
    oauth: 10,
    billing: 10,
    cron: 5,
    auth: 15,
  };
  const { data, error } = await adminClient().rpc("consume_rate_limits", {
    p_subjects: subjects,
    p_service: service,
    p_limit: limits[service] ?? 20,
  });
  dbError(error);
  if (!data)
    throw new AppError(
      "RATE_LIMIT",
      "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      429,
    );
}
export function cronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(
      "CONFIG_MISSING",
      "CRON_SECRET을 32자 이상으로 설정해 주세요.",
      503,
    );
  if (
    !secureEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
  )
    throw new AppError("UNAUTHORIZED", "예약 작업 인증에 실패했습니다.", 401);
}

export async function guardBrand(userId: string, brandId: string) {
  const { data, error } = await adminClient().rpc("is_active_brand", {
    p_user_id: userId,
    p_brand_id: brandId,
  });
  dbError(error);
  if (!data)
    throw new AppError(
      "BRAND_ARCHIVED",
      "이 브랜드는 현재 플랜의 활성 브랜드 수를 초과합니다. 업그레이드하거나 이전 브랜드를 정리해 주세요.",
      403,
    );
}
