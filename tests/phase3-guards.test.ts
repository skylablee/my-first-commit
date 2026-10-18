import { afterEach, beforeEach, expect, test, vi } from "vitest";
const f = vi.hoisted(() => ({ rpc: vi.fn(), role: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({
  adminClient: () => ({
    rpc: f.rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: f.role }) }) }),
  }),
}));
vi.mock("@/lib/server/auth", () => ({ requireUser: f.user }));
import {
  cronAuth,
  rateLimit,
  guardFeature,
  guardBrand,
} from "../src/lib/operations/guards";
import { requireAdmin } from "../src/lib/operations/admin";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "x".repeat(32));
  f.rpc.mockResolvedValue({ data: true, error: null });
  f.user.mockResolvedValue({
    user: { id: "alice", user_metadata: { role: "admin" } },
  });
});
afterEach(() => vi.unstubAllEnvs());
test("cron rejects absent/wrong bearer token", () => {
  expect(() =>
    cronAuth(new Request("https://app.test/api/cron/publish")),
  ).toThrow();
  expect(() =>
    cronAuth(
      new Request("https://app.test/api/cron/publish", {
        headers: { authorization: `Bearer ${"x".repeat(32)}` },
      }),
    ),
  ).not.toThrow();
});
test("self-assigned admin metadata is ignored; only DB role grants admin", async () => {
  f.role.mockResolvedValue({ data: null, error: null });
  await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  f.role.mockResolvedValue({ data: { role: "admin" }, error: null });
  expect((await requireAdmin()).user.id).toBe("alice");
});
test("server plan guard blocks free scheduling/repurposing and inactive brands", async () => {
  f.rpc.mockResolvedValue({ data: "FREE", error: null });
  await expect(guardFeature("alice", "schedule")).rejects.toMatchObject({
    status: 403,
  });
  await expect(guardFeature("alice", "repurpose")).rejects.toMatchObject({
    status: 403,
  });
  f.rpc.mockResolvedValue({ data: false, error: null });
  await expect(guardBrand("alice", "archived")).rejects.toMatchObject({
    status: 403,
  });
});
test("forwarded IP spoofing outside Vercel cannot evade a shared persistent bucket", async () => {
  vi.stubEnv("VERCEL", "");
  await rateLimit(
    new Request("https://app.test", {
      headers: { "x-forwarded-for": "1.1.1.1" },
    }),
    "billing",
    "alice",
  );
  const first = f.rpc.mock.calls[0][1].p_subjects;
  await rateLimit(
    new Request("https://app.test", {
      headers: { "x-forwarded-for": "2.2.2.2" },
    }),
    "billing",
    "alice",
  );
  expect(f.rpc.mock.calls[1][1].p_subjects).toEqual(first);
  f.rpc.mockResolvedValue({ data: false, error: null });
  await expect(
    rateLimit(new Request("https://app.test"), "billing", "alice"),
  ).rejects.toMatchObject({ status: 429 });
});
