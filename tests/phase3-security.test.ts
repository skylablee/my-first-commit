import { afterEach, expect, test, vi } from "vitest";
import { createHmac } from "node:crypto";
import { encrypt, decrypt } from "../src/lib/operations/crypto";
import {
  verifySignature,
  MockPaymentProvider,
  StripePaymentProvider,
} from "../src/lib/billing/provider";
import { validateEnvironment } from "../src/lib/environment";
import { MetaThreadsProvider } from "../src/lib/threads/provider";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test("AES-GCM hides tokens, authenticates ciphertext and binds it to user/provider", () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "11".repeat(32));
  const encrypted = encrypt("private-token", "threads:alice");
  expect(encrypted).not.toContain("private-token");
  expect(decrypt(encrypted, "threads:alice")).toBe("private-token");
  expect(() => decrypt(encrypted, "threads:bob")).toThrow();
  const parts = encrypted.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  expect(() => decrypt(parts.join("."), "threads:alice")).toThrow();
});
test("webhook signatures reject forged payloads, old timestamps and missing secret", () => {
  const body = '{"id":"evt_1"}',
    now = Date.now(),
    t = Math.floor(now / 1000);
  const signature = `t=${t},v1=${createHmac("sha256", "secret").update(`${t}.${body}`).digest("hex")}`;
  expect(() => verifySignature(body, signature, "secret", now)).not.toThrow();
  expect(() => verifySignature(body + " ", signature, "secret", now)).toThrow();
  expect(() =>
    verifySignature(body, signature, "secret", now + 301000),
  ).toThrow();
  expect(() => verifySignature(body, signature, "", now)).toThrow();
});
test("production rejects missing credentials and mock provider, development still runs", () => {
  expect(validateEnvironment({ APP_ENV: "development" }).valid).toBe(true);
  const production = validateEnvironment({
    APP_ENV: "production",
    PAYMENT_PROVIDER: "mock",
  });
  expect(production.valid).toBe(false);
  expect(production.errors.join()).toContain("APP_URL");
  vi.stubEnv("APP_ENV", "production");
  expect(() => new MockPaymentProvider()).toThrow("mock");
});
test("public Supabase env cannot contain service-role keys", () => {
  expect(
    validateEnvironment({
      APP_ENV: "development",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_private",
    }).valid,
  ).toBe(false);
});
test("mock cancellation preserves paid period and downgrade never resets period", async () => {
  vi.stubEnv("APP_ENV", "test");
  const p = new MockPaymentProvider(),
    s = {
      id: "mock_1",
      userId: "alice",
      plan: "PRO" as const,
      status: "active" as const,
      periodEnd: "2026-12-01T00:00:00Z",
      cancelAtPeriodEnd: false,
    };
  expect((await p.cancelSubscription(s)).cancelAtPeriodEnd).toBe(true);
  const downgraded = await p.changePlan(s, "STARTER");
  expect(downgraded.plan).toBe("STARTER");
  expect(downgraded.periodEnd).toBe(s.periodEnd);
});
test("Stripe subscription canonical status verifies amount/currency/interval and paid invoice", async () => {
  vi.stubEnv("PAYMENT_SECRET_KEY", "sk_test_private");
  vi.stubEnv("PAYMENT_PRICE_PRO", "price_pro");
  const raw = {
    id: "sub_123",
    metadata: { user_id: "11111111-1111-4111-8111-111111111111" },
    status: "active",
    cancel_at_period_end: false,
    current_period_end: 1900000000,
    items: {
      data: [
        {
          id: "si_1",
          quantity: 1,
          price: {
            id: "price_pro",
            unit_amount: 59000,
            currency: "krw",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
    latest_invoice: { status: "paid" },
  };
  const f = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify(raw)));
  vi.stubGlobal("fetch", f);
  expect(
    (await new StripePaymentProvider().getSubscription("sub_123")).status,
  ).toBe("active");
  raw.items.data[0].price.unit_amount = 29000;
  await expect(
    new StripePaymentProvider().getSubscription("sub_123"),
  ).rejects.toThrow("가격");
  raw.items.data[0].price.unit_amount = 59000;
  raw.latest_invoice.status = "open";
  expect(
    (await new StripePaymentProvider().getSubscription("sub_123")).status,
  ).toBe("incomplete");
});
test("Threads mock HTTP creates, checks and publishes using server headers; never retries ambiguous publish", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(new Response('{"id":"100"}'))
    .mockResolvedValueOnce(new Response('{"status":"FINISHED"}'))
    .mockResolvedValueOnce(new Response('{"id":"200"}'));
  vi.stubGlobal("fetch", f);
  const p = new MetaThreadsProvider();
  expect(await p.createContainer("private", "42", "우리 가게 소식")).toBe(
    "100",
  );
  expect(await p.containerStatus("private", "100")).toBe("FINISHED");
  expect(await p.publishContainer("private", "42", "100")).toBe("200");
  expect(f.mock.calls[0][0]).not.toContain("private");
  f.mockReset().mockRejectedValue(new Error("network private"));
  await expect(
    p.publishContainer("private", "42", "100"),
  ).rejects.toMatchObject({ uncertain: true });
  expect(f).toHaveBeenCalledTimes(1);
});

test("Vercel production cannot be downgraded by APP_ENV=development", () => {
  expect(
    validateEnvironment({
      VERCEL_ENV: "production",
      APP_ENV: "development",
      PAYMENT_PROVIDER: "mock",
    }).valid,
  ).toBe(false);
});

test("core Vercel deployment validates auth and AI without requiring unconnected services", () => {
  const core = {
    VERCEL_ENV: "production",
    DEPLOYMENT_PROFILE: "core",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-value",
    SUPABASE_SERVICE_ROLE_KEY: "server-test-value",
    CRON_SECRET: "x".repeat(32),
    APP_URL: "https://app.example.com",
    OPENAI_API_KEY: "test-value",
  };
  expect(validateEnvironment(core)).toEqual({
    stage: "production",
    valid: true,
    errors: [],
  });
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "APP_URL",
    "OPENAI_API_KEY",
  ])
    expect(validateEnvironment({ ...core, [name]: "" }).valid).toBe(false);
  expect(
    validateEnvironment({ ...core, APP_URL: "http://localhost:3000" }).valid,
  ).toBe(false);
  expect(
    validateEnvironment({
      ...core,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_not_public",
    }).valid,
  ).toBe(false);
  expect(
    validateEnvironment({ ...core, DEPLOYMENT_PROFILE: "full" }).valid,
  ).toBe(false);
  expect(
    validateEnvironment({ ...core, DEPLOYMENT_PROFILE: "typo" }).valid,
  ).toBe(false);
  expect(validateEnvironment({ ...core, PAYMENT_PROVIDER: "mock" }).valid).toBe(
    false,
  );
  expect(
    validateEnvironment({ ...core, THREADS_APP_ID: "partial" }).valid,
  ).toBe(false);
  expect(
    validateEnvironment({ ...core, NAVER_CLIENT_ID: "partial" }).valid,
  ).toBe(false);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DEPLOYMENT_PROFILE", "core");
  expect(() => new MockPaymentProvider()).toThrow("mock");
});

test("unknown server errors never expose raw secrets or stacks; response has correlation ID", async () => {
  const { route } = await import("../src/lib/server/api");
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await route(async () => {
      throw new Error("TOP_SECRET_RAW_TOKEN");
    });
    const body = await response.json();
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("TOP_SECRET");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("TOP_SECRET");
    expect(JSON.stringify(body)).not.toContain("stack");
  } finally {
    spy.mockRestore();
  }
});

test("production cannot use a test Stripe key or expose an authenticated JWT as a public key", () => {
  const result = validateEnvironment({
    APP_ENV: "production",
    PAYMENT_PROVIDER: "stripe",
    PAYMENT_SECRET_KEY: "sk_test_not_live",
  });
  expect(result.errors.join()).toContain("live secret");
  const jwt =
    "header." +
    Buffer.from(JSON.stringify({ role: "authenticated" })).toString(
      "base64url",
    ) +
    ".signature";
  expect(
    validateEnvironment({
      APP_ENV: "development",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt,
    }).valid,
  ).toBe(false);
});
