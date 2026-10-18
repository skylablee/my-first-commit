import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const checks: { service: string; status: string }[] = [];
async function check(
  service: string,
  url: string | undefined,
  headers: Record<string, string>,
  configured: boolean,
) {
  if (!configured || !url) {
    checks.push({ service, status: "미설정 — 실연결 미검증" });
    return;
  }
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
    });
    await r.body?.cancel();
    checks.push({
      service,
      status: r.ok ? "연결 응답 확인" : `실패 HTTP ${r.status}`,
    });
  } catch {
    checks.push({ service, status: "네트워크·TLS·timeout 오류" });
  }
}
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
await Promise.all([
  check(
    "Supabase DB",
    supabase ? `${supabase}/rest/v1/plans?select=id&limit=1` : undefined,
    serviceKey
      ? { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
      : {},
    Boolean(supabase && serviceKey),
  ),
  check(
    "OpenAI (모델 목록, 생성 비용 없음)",
    "https://api.openai.com/v1/models",
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    Boolean(process.env.OPENAI_API_KEY),
  ),
  check(
    "Gemini (모델 목록, 생성 비용 없음)",
    "https://generativelanguage.googleapis.com/v1beta/models",
    { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
    Boolean(process.env.GEMINI_API_KEY),
  ),
  check(
    "Naver News (검색 quota 사용)",
    "https://openapi.naver.com/v1/search/news.json?query=%EC%86%8C%EC%83%81%EA%B3%B5%EC%9D%B8&display=1",
    {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID ?? "",
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET ?? "",
    },
    Boolean(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
  ),
  check(
    "Google News RSS",
    "https://news.google.com/rss/search?q=small+business&hl=ko&gl=KR&ceid=KR:ko",
    {},
    true,
  ),
  check(
    "Google Trends RSS",
    "https://trends.google.com/trending/rss?geo=KR",
    {},
    true,
  ),
  check(
    "Stripe (잔액 조회, 과금 없음)",
    "https://api.stripe.com/v1/balance",
    {
      Authorization: `Basic ${Buffer.from(`${process.env.PAYMENT_SECRET_KEY ?? ""}:`).toString("base64")}`,
    },
    process.env.PAYMENT_PROVIDER === "stripe" &&
      Boolean(process.env.PAYMENT_SECRET_KEY),
  ),
]);
for (const check of checks) console.log(`${check.service}: ${check.status}`);
console.log(
  "이 검사는 HTTP 연결 응답만 확인합니다. 가입·AI 생성·결제·게시의 기능 검증은 staging 계정에서 별도로 실행하세요. Threads는 OAuth 후 연결 계정 조회·테스트 게시로 확인해야 합니다.",
);
if (checks.some((c) => c.status !== "연결 응답 확인")) process.exitCode = 2;
