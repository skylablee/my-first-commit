import { test, expect } from "@playwright/test";
test("anonymous dashboard is protected and setup works without credentials", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "다시 만나 반가워요" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "처음이신가요? 회원가입" }).click();
  await expect(page.getByLabel("이름", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "회원가입", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "환경 설정 상태 확인" }).click();
  await expect(
    page.getByText("SUPABASE_SERVICE_ROLE_KEY", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OPENAI_API_KEY", { exact: true })).toBeVisible();
});
test("mobile auth and setup do not overflow; unauthorized API requests fail safely", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/setup");
  await expect(
    page.getByText("NAVER_CLIENT_SECRET", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const response = await request.post("/api/generate", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: {},
  });
  expect([401, 503]).toContain(response.status());
  expect(JSON.stringify(await response.json())).not.toMatch(
    /stack|Bearer|sb_secret_/,
  );
  const crossSite = await request.post("/api/auth", {
    headers: { origin: "https://evil.test" },
    data: { action: "logout" },
  });
  expect(crossSite.status()).toBe(403);
});

test("operations endpoints fail closed without credentials or valid signatures", async ({
  page,
  request,
}) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await page.goto("/admin/staging-check");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  const staging = await request.post("/api/admin/staging-check", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { action: "connect", service: "OpenAI" },
  });
  expect([401, 503]).toContain(staging.status());
  expect(JSON.stringify(await staging.json())).not.toMatch(
    /stack|sk_live_|access_token/,
  );
  const forged = await request.post("/api/billing/webhook", {
    data: { id: "forged", type: "payment.succeeded" },
  });
  expect(forged.status()).toBe(401);
  const body = await forged.json();
  expect(body.error.request_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(body)).not.toMatch(/stack|sk_live_|access_token/);
  const cron = await request.get("/api/cron/publish");
  expect([401, 503]).toContain(cron.status());
  const mock = await request.post("/api/billing/mock-confirm", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { plan: "AGENCY" },
  });
  expect([401, 503]).toContain(mock.status());
});
