import "server-only";
import { appEnvironment } from "../environment";
import { adminClient } from "../server/admin";
import { AppError } from "../server/errors";
import { dbError } from "../server/api";
export function stagingEnabled() {
  const env = appEnvironment();
  return (
    env === "staging" ||
    (["development", "test"].includes(env) &&
      process.env.STAGING_VALIDATION_ENABLED === "true")
  );
}
export async function requireStaging() {
  if (!stagingEnabled())
    throw new AppError(
      "STAGING_DISABLED",
      "실행은 staging 또는 명시적으로 활성화한 개발 환경에서만 가능합니다.",
      403,
    );
  const { data, error } = await adminClient()
    .from("operating_settings")
    .select("staging_validation_enabled")
    .eq("id", true)
    .single();
  dbError(error);
  if (!data?.staging_validation_enabled)
    throw new AppError(
      "STAGING_DISABLED",
      "전용 staging DB에서 staging_validation_enabled를 활성화해 주세요.",
      403,
    );
}
export function requireTestPayment() {
  if (
    !stagingEnabled() ||
    process.env.PAYMENT_PROVIDER !== "stripe" ||
    !process.env.PAYMENT_SECRET_KEY?.startsWith("sk_test_")
  )
    throw new AppError(
      "SANDBOX_ONLY",
      "Stripe test key만 사용할 수 있습니다. 실제 금액을 청구하는 테스트는 차단합니다.",
      403,
    );
}
