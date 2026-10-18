// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const f = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/client-api", () => ({ api: f.api }));
import { BillingPanel } from "../src/components/billing-panel";
import { ThreadsPanel } from "../src/components/threads-panel";
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("mock upgrade, downgrade and period-end cancel keep usage visible", async () => {
  const user = userEvent.setup();
  let plan = "FREE";
  let subscription: Record<string, unknown> | null = null;
  f.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/billing")
      return {
        plan,
        provider: "mock",
        environment: "development",
        usage: { month: 7, estimated_cost: 0.001 },
        subscription,
        events: [],
      };
    if (path === "/api/billing/checkout") return { url: "/", mock: true };
    if (path === "/api/billing/mock-confirm") {
      plan = "PRO";
      subscription = {
        plan_id: plan,
        status: "active",
        provider: "mock",
        current_period_end: "2099-01-01",
        cancel_at_period_end: false,
      };
      return { mock: true };
    }
    if (path === "/api/billing/change") {
      plan = JSON.parse(String(options?.body)).plan;
      subscription = { ...subscription, plan_id: plan };
      return {};
    }
    if (path === "/api/billing/cancel") {
      subscription = { ...subscription, cancel_at_period_end: true };
      return {};
    }
    return {};
  });
  render(<BillingPanel />);
  await screen.findByText("7 / 10회");
  const pro = screen.getByRole("heading", { name: "Pro" }).closest("article")!;
  await user.click(within(pro).getByRole("button", { name: "플랜 선택" }));
  await screen.findByText("7 / 500회");
  const starter = screen
    .getByRole("heading", { name: "Starter" })
    .closest("article")!;
  await user.click(within(starter).getByRole("button", { name: "플랜 선택" }));
  await screen.findByText("7 / 100회");
  await user.click(screen.getByRole("button", { name: "다음 결제 취소" }));
  await screen.findByText(/구독 취소 예약됨/);
  expect(f.api).toHaveBeenCalledWith(
    "/api/billing/cancel",
    expect.objectContaining({ method: "POST" }),
  );
});
test("uncertain publication disables retry and confirmed result has a permalink", async () => {
  f.api.mockImplementation(async (path) =>
    path === "/api/threads"
      ? { connection: { id: "c", username: "shop", expires_at: "2099-01-01" } }
      : {
          publications: [
            {
              id: "j1",
              status: "failed",
              uncertain: true,
              retry_count: 0,
              provider_post_id: null,
              error_message: "결과 확인 필요",
            },
            {
              id: "j2",
              status: "published",
              uncertain: false,
              retry_count: 0,
              provider_post_id: "123",
              provider_post_url: "https://www.threads.net/@shop/post/abc",
            },
          ],
        },
  );
  render(<ThreadsPanel />);
  await screen.findByText(/@shop/);
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /다시 시도/ })).toHaveLength(
      2,
    ),
  );
  expect(
    screen
      .getAllByRole("button", { name: /다시 시도/ })[0]
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen
      .getByRole("link", { name: "Threads 게시물 보기 ↗" })
      .getAttribute("href"),
  ).toContain("threads.net");
});
