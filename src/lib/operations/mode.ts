import "server-only";
import { appEnvironment } from "../environment";
import { adminClient } from "../server/admin";
import { AppError } from "../server/errors";
export async function checkBillingMode(mock = false) {
  const { data, error } = await adminClient()
    .from("operating_settings")
    .select("allow_mock_billing,staging_validation_enabled")
    .eq("id", true)
    .single();
  if (error || !data)
    throw new AppError(
      "DATABASE_ERROR",
      "PHASE 3 운영 설정 마이그레이션을 확인해 주세요.",
      503,
    );
  if (mock && !data.allow_mock_billing)
    throw new AppError(
      "MOCK_FORBIDDEN",
      "개발 DB에서 allow_mock_billing을 명시적으로 활성화해야 합니다.",
      403,
    );
  if (
    ["production", "staging"].includes(appEnvironment()) &&
    (data.allow_mock_billing || (appEnvironment()==="production" && data.staging_validation_enabled))
  )
    throw new AppError(
      "SANDBOX_DATABASE",
      "운영 환경에서 mock 결제가 활성화된 DB를 사용할 수 없습니다.",
      503,
    );
}
