import { beforeEach, afterEach, expect, test, vi } from "vitest";
const f = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  user: vi.fn(),
  rpc: vi.fn(),
  save: vi.fn(),
  exchange: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: f.get, set: f.set }),
}));
vi.mock("@/lib/server/auth", () => ({ requireUser: f.user }));
vi.mock("@/lib/server/admin", () => ({
  adminClient: () => ({ rpc: f.rpc, from: () => ({ upsert: f.save }) }),
}));
vi.mock("@/lib/operations/guards", () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/operations/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/threads/provider", () => ({
  MetaThreadsProvider: class {
    exchangeCode = f.exchange;
    profile = f.profile;
  },
}));
import { GET } from "../src/app/api/threads/callback/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "https://app.test");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "33".repeat(32));
  f.user.mockResolvedValue({ user: { id: "alice" } });
  f.get.mockReturnValue({ value: "state" });
  f.rpc.mockResolvedValue({ data: true, error: null });
  f.save.mockResolvedValue({ error: null });
  f.exchange.mockResolvedValue({
    accessToken: "private-token",
    expiresIn: 3600,
  });
  f.profile.mockResolvedValue({ id: "42", username: "myshop" });
});
afterEach(() => vi.unstubAllEnvs());
test("missing or mismatched OAuth state never exchanges a code", async () => {
  const r = await GET(
    new Request("https://app.test/api/threads/callback?state=attacker&code=c"),
  );
  expect(r.headers.get("location")).toContain("threads=failed");
  expect(f.exchange).not.toHaveBeenCalled();
});
test("replayed or other-user state fails before calling Meta", async () => {
  f.rpc.mockResolvedValue({ data: false, error: null });
  await GET(
    new Request("https://app.test/api/threads/callback?state=state&code=c"),
  );
  expect(f.exchange).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith(
    "consume_oauth_state",
    expect.objectContaining({ p_user_id: "alice" }),
  );
});
test("valid callback stores only encrypted token and safe account metadata", async () => {
  const r = await GET(
    new Request("https://app.test/api/threads/callback?state=state&code=c"),
  );
  expect(r.headers.get("location")).toContain("threads=connected");
  const row = f.save.mock.calls[0][0];
  expect(row.access_token_encrypted).not.toContain("private-token");
  expect(row.username).toBe("myshop");
  expect(row.user_id).toBe("alice");
  expect(row.refresh_token_encrypted).toBeNull();
});
