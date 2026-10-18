import "server-only";
import { appEnvironment } from "../environment";
import { services, type StagingService } from "./types";
export function serviceConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const required: Record<StagingService, string[]> = {
    Supabase: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
    OpenAI: ["OPENAI_API_KEY"],
    Gemini: ["GEMINI_API_KEY"],
    Naver: ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"],
    Threads: [
      "THREADS_APP_ID",
      "THREADS_APP_SECRET",
      "THREADS_REDIRECT_URI",
      "TOKEN_ENCRYPTION_KEY",
    ],
    Payment: [
      "PAYMENT_PROVIDER",
      "PAYMENT_SECRET_KEY",
      "PAYMENT_WEBHOOK_SECRET",
      "PAYMENT_PRICE_STARTER",
      "PAYMENT_PRICE_PRO",
      "PAYMENT_PRICE_AGENCY",
    ],
    Cron: ["CRON_SECRET", "APP_URL"],
  };
  return services.map((name) => ({
    name,
    missing: required[name].filter(
      (key) =>
        !(
          key === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
            ? env[key] || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            : env[key]
        )?.trim(),
    ),
    sandbox:
      name === "Payment"
        ? env.PAYMENT_PROVIDER === "stripe" &&
          Boolean(env.PAYMENT_SECRET_KEY?.startsWith("sk_test_"))
        : undefined,
  }));
}
export function assertNoMockProduction() {
  if (
    appEnvironment() === "production" &&
    (!process.env.PAYMENT_SECRET_KEY?.startsWith("sk_live_") ||
      process.env.PAYMENT_PROVIDER !== "stripe")
  )
    return false;
  return true;
}
