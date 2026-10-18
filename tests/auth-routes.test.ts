vi.mock("@/lib/operations/guards", () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
  guardFeature: vi.fn().mockResolvedValue("PRO"),
  guardBrand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/operations/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signup: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.create }));
import { POST } from "../src/app/api/auth/route";
import { requireUser } from "../src/lib/server/auth";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({
    auth: {
      signUp: mocks.signup,
      signInWithPassword: mocks.login,
      signOut: mocks.logout,
      getUser: mocks.getUser,
    },
  });
});
const request = (data: unknown, origin = "https://app.test") =>
  new Request("https://app.test/api/auth", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
test("signup returns confirmation state and PKCE callback URL without returning tokens", async () => {
  mocks.signup.mockResolvedValue({ data: { session: null }, error: null });
  const response = await POST(
    request({
      action: "signup",
      email: "a@example.test",
      password: "long-password",
      name: "사장님",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ confirmed: false });
  expect(mocks.signup.mock.calls[0][0].options.emailRedirectTo).toBe(
    "https://app.test/auth/callback",
  );
});
test("login/logout succeed with cookies delegated to SSR client", async () => {
  mocks.login.mockResolvedValue({
    error: null,
    data: { user: { id: "alice" } },
  });
  mocks.logout.mockResolvedValue({ error: null });
  expect(
    (
      await POST(
        request({
          action: "login",
          email: "a@example.test",
          password: "long-password",
        }),
      )
    ).status,
  ).toBe(200);
  expect((await POST(request({ action: "logout" }))).status).toBe(200);
});
test("wrong credentials, missing config and cross-site requests fail safely", async () => {
  mocks.login.mockResolvedValue({
    error: { status: 400, message: "private detail" },
  });
  const response = await POST(
    request({
      action: "login",
      email: "a@example.test",
      password: "long-password",
    }),
  );
  expect(response.status).toBe(401);
  expect(JSON.stringify(await response.json())).not.toContain("private detail");
  mocks.create.mockResolvedValue(null);
  expect((await POST(request({ action: "logout" }))).status).toBe(503);
  expect(
    (await POST(request({ action: "logout" }, "https://evil.test"))).status,
  ).toBe(403);
});
test("authorization validates getUser rather than trusting a session object", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "alice" } },
    error: null,
  });
  expect((await requireUser()).user.id).toBe("alice");
});
