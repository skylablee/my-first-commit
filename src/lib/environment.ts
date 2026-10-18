// Pure validation shared by prebuild and server. Never return secret values.
export const environmentNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "NAVER_CLIENT_ID",
  "NAVER_CLIENT_SECRET",
  "THREADS_APP_ID",
  "THREADS_APP_SECRET",
  "THREADS_REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY",
  "PAYMENT_PROVIDER",
  "PAYMENT_SECRET_KEY",
  "PAYMENT_CLIENT_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_PRICE_STARTER",
  "PAYMENT_PRICE_PRO",
  "PAYMENT_PRICE_AGENCY",
  "CRON_SECRET",
  "APP_URL",
  "DEPLOYMENT_PROFILE",
] as const;
export function appEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  const stage =
    env.VERCEL_ENV === "production"
      ? "production"
      : env.VERCEL_ENV === "preview"
        ? "staging"
        : (env.APP_ENV ?? "development");
  return stage;
}
export function validateEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  const stage = appEnvironment(env);
  const errors: string[] = [];
  if (!["development", "staging", "production", "test"].includes(stage))
    errors.push(
      "APP_ENV는 development/staging/production/test 중 하나여야 합니다.",
    );
  const profile = env.DEPLOYMENT_PROFILE ?? "full";
  if (!["core", "full"].includes(profile))
    errors.push("DEPLOYMENT_PROFILE은 core/full 중 하나여야 합니다.");
  const threadsKeys = [
    "TOKEN_ENCRYPTION_KEY",
    "THREADS_APP_ID",
    "THREADS_APP_SECRET",
    "THREADS_REDIRECT_URI",
  ];
  const newsKeys = ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"];
  const billingKeys = [
    "PAYMENT_PROVIDER",
    "PAYMENT_SECRET_KEY",
    "PAYMENT_WEBHOOK_SECRET",
    "PAYMENT_PRICE_STARTER",
    "PAYMENT_PRICE_PRO",
    "PAYMENT_PRICE_AGENCY",
  ];
  const enabled = (keys: string[]) =>
    profile !== "core" || keys.some((key) => Boolean(env[key]));
  const threadsEnabled = enabled(threadsKeys);
  const billingEnabled = enabled(billingKeys);
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "APP_URL",
    ...(threadsEnabled ? threadsKeys : []),
    ...(enabled(newsKeys) ? newsKeys : []),
    ...(billingEnabled ? billingKeys : []),
  ];
  if (stage === "production" || stage === "staging") {
    for (const name of required)
      if (
        !(name === "NEXT_PUBLIC_SUPABASE_ANON_KEY"
          ? env[name] || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          : env[name])
      )
        errors.push(`${name} 미설정`);
    if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY)
      errors.push("OPENAI_API_KEY 또는 GEMINI_API_KEY가 필요합니다.");
    if (
      stage === "production" &&
      env.PAYMENT_SECRET_KEY &&
      !env.PAYMENT_SECRET_KEY.startsWith("sk_live_")
    )
      errors.push("production에는 Stripe live secret key가 필요합니다.");
    if (
      stage === "staging" &&
      env.PAYMENT_SECRET_KEY &&
      !env.PAYMENT_SECRET_KEY.startsWith("sk_test_")
    )
      errors.push("staging에는 Stripe test secret key가 필요합니다.");
    if (
      env.PAYMENT_WEBHOOK_SECRET &&
      !env.PAYMENT_WEBHOOK_SECRET.startsWith("whsec_")
    )
      errors.push("Stripe webhook signing secret 형식을 확인하세요.");
    if (billingEnabled && env.PAYMENT_PROVIDER !== "stripe")
      errors.push(
        "운영 결제는 현재 stripe만 지원합니다. mock은 development/test 전용입니다.",
      );
    if ((env.CRON_SECRET?.length ?? 0) < 32)
      errors.push("CRON_SECRET은 32자 이상이어야 합니다.");
    for (const key of [
      "APP_URL",
      ...(threadsEnabled ? ["THREADS_REDIRECT_URI"] : []),
      "NEXT_PUBLIC_SUPABASE_URL",
    ]) {
      try {
        const u = new URL(env[key] ?? "");
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          ["localhost", "127.0.0.1"].includes(u.hostname)
        )
          throw new Error();
      } catch {
        errors.push(`${key}에 공개 HTTPS URL이 필요합니다.`);
      }
    }
    if (threadsEnabled)
      try {
        if (
          new URL(env.THREADS_REDIRECT_URI ?? "").origin !==
            new URL(env.APP_URL ?? "").origin ||
          new URL(env.THREADS_REDIRECT_URI ?? "").pathname !==
            "/api/threads/callback"
        )
          errors.push(
            "THREADS_REDIRECT_URI는 APP_URL의 /api/threads/callback 이어야 합니다.",
          );
      } catch {}
  }
  if (
    env.TOKEN_ENCRYPTION_KEY &&
    !/^[a-fA-F0-9]{64}$/.test(env.TOKEN_ENCRYPTION_KEY)
  )
    errors.push("TOKEN_ENCRYPTION_KEY는 32바이트 hex(64자)여야 합니다.");
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ]) {
    const value = env[key];
    if (value?.startsWith("sb_secret_"))
      errors.push(`${key}에 secret key를 사용할 수 없습니다.`);
    if (value?.split(".").length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(value.split(".")[1], "base64url").toString(),
        );
        if (payload.role !== "anon")
          errors.push(`${key}에는 anon 역할 공개 키만 사용할 수 있습니다.`);
      } catch {}
    }
  }
  return { stage, valid: errors.length === 0, errors };
}
