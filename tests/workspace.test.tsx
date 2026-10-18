// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("@/lib/client-api", () => ({ api: mocks.api }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    refresh: mocks.refresh,
    replace: mocks.replace,
  }),
}));
import { Workspace } from "../src/components/workspace";
import { AuthForm } from "../src/components/auth-form";
const id = "11111111-1111-4111-8111-111111111111";
const brand = {
  id,
  name: "테스트 카페",
  industry: "카페",
  audience: "동네 주민",
  voice: "따뜻한",
  description: "동네 카페",
  keywords: [],
  forbidden_words: [],
};
beforeEach(() => {
  location.hash = "";
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          variables: [],
          supabaseReady: true,
          aiReady: false,
        }),
      ),
    ),
  );
  mocks.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/brands" && !options) return { brands: [brand] };
    if (path === "/api/brands" && options)
      return { brand: { ...brand, ...JSON.parse(String(options.body)) } };
    if (path === "/api/contents" && !options)
      return { contents: [], nextCursor: null };
    if (path === "/api/usage")
      return {
        usage: {
          today: 0,
          month: 0,
          estimated_cost: 0,
          reserved: 0,
          input_tokens: 0,
          output_tokens: 0,
        },
      };
    if (path === "/api/generate")
      return {
        result: {
          title: "새 메뉴 소개",
          body: "오늘의 빵을 만나보세요",
          hashtags: ["#카페"],
        },
        bundle: false,
      };
    if (path === "/api/contents" && options)
      return {
        content: {
          id: "22222222-2222-4222-8222-222222222222",
          ...JSON.parse(String(options.body)),
          date: "2026-10-17",
          status: "초안",
        },
      };
    if (path.startsWith("/api/news"))
      return {
        items: [
          {
            title: "동네 카페 성장 소식",
            description: "주민과 함께하는 카페",
            link: "https://news.example/1",
            originallink: "https://publisher.example/1",
            source: "지역신문",
            publishedAt: "today",
            pubDate: "today",
          },
        ],
      };
    return { ok: true };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("authenticated workspace edits brand, generates editable content, saves to DB and searches", async () => {
  const user = userEvent.setup();
  render(<Workspace userId={id} userLabel="테스트 사장님" />);
  await screen.findByText("DB 초안 · 추가 목록은 라이브러리에서");
  await waitFor(() =>
    expect(screen.queryByText("DB에서 데이터를 불러오는 중…")).toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "브랜드 브레인" }));
  await user.clear(screen.getByLabelText("브랜드 이름"));
  await user.type(screen.getByLabelText("브랜드 이름"), "새 이름");
  await user.click(screen.getByRole("button", { name: "브랜드 정보 저장" }));
  await screen.findByText("브랜드 정보를 DB에 저장했어요.");
  await user.click(screen.getByRole("button", { name: "AI 스튜디오" }));
  await user.type(
    screen.getByLabelText("어떤 이야기를 전하고 싶으세요?"),
    "신메뉴 빵 소개",
  );
  await user.click(screen.getByRole("button", { name: "AI 초안 생성" }));
  const output = await screen.findByLabelText("생성된 콘텐츠 편집 1");
  expect((output as HTMLTextAreaElement).value).toContain("오늘의 빵");
  await user.type(output, " 수정했어요");
  await user.click(screen.getByRole("button", { name: "초안 저장" }));
  await screen.findByRole("button", { name: "저장 완료" });
  await user.click(screen.getByRole("button", { name: "콘텐츠 라이브러리" }));
  await user.type(screen.getByLabelText("콘텐츠 검색"), "새 메뉴");
  await screen.findByRole("button", { name: "새 메뉴 소개" });
  expect(mocks.api).toHaveBeenCalledWith(
    "/api/contents",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("수정했어요"),
    }),
  );
});
test("news transfers title, source text and URL to studio", async () => {
  const user = userEvent.setup();
  render(<Workspace userId={id} />);
  await waitFor(() =>
    expect(screen.queryByText("DB에서 데이터를 불러오는 중…")).toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "트렌드 레이더" }));
  await user.click(screen.getByRole("button", { name: "뉴스 검색" }));
  await user.click(
    await screen.findByRole("button", { name: "이 뉴스로 글 작성" }),
  );
  expect(
    (
      screen.getByLabelText(
        "어떤 이야기를 전하고 싶으세요?",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("동네 카페 성장 소식");
  expect(
    (
      screen.getByLabelText(
        "참고 원문 / 재가공할 콘텐츠",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("주민과 함께하는 카페");
  expect(
    screen.getByRole("link", { name: "원문 보기 ↗" }).getAttribute("href"),
  ).toBe("https://publisher.example/1");
});
test("AI failure shows safe message and restores generate button", async () => {
  const user = userEvent.setup();
  mocks.api.mockImplementation(async (path) => {
    if (path === "/api/brands") return { brands: [brand] };
    if (path === "/api/contents") return { contents: [], nextCursor: null };
    if (path === "/api/usage")
      return { usage: { today: 0, month: 0, estimated_cost: 0, reserved: 0 } };
    throw new Error("OpenAI API 키를 확인해주세요.");
  });
  render(<Workspace userId={id} />);
  await waitFor(() =>
    expect(screen.queryByText("DB에서 데이터를 불러오는 중…")).toBeNull(),
  );
  await user.click(screen.getByRole("button", { name: "AI 스튜디오" }));
  await user.type(
    screen.getByLabelText("어떤 이야기를 전하고 싶으세요?"),
    "신메뉴",
  );
  await user.click(screen.getByRole("button", { name: "AI 초안 생성" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "OpenAI API 키",
  );
  expect(
    screen
      .getByRole("button", { name: "AI 초안 생성" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
test("login and signup forms submit actual route contracts; missing config disables submit", async () => {
  const user = userEvent.setup();
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetcher);
  const { unmount } = render(<AuthForm configured />);
  await user.type(screen.getByLabelText("이메일"), "a@example.test");
  await user.type(screen.getByLabelText("비밀번호"), "long-password");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
  unmount();
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        confirmed: false,
        message: "인증 메일을 확인해 주세요.",
      }),
    ),
  );
  render(<AuthForm configured />);
  await user.click(
    screen.getByRole("button", { name: "처음이신가요? 회원가입" }),
  );
  await user.type(screen.getByLabelText("이름"), "사장님");
  await user.type(screen.getByLabelText("이메일"), "b@example.test");
  await user.type(screen.getByLabelText("비밀번호"), "long-password");
  await user.click(screen.getByRole("button", { name: "회원가입" }));
  await screen.findByRole("alert");
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body).action).toBe("signup");
  cleanup();
  render(<AuthForm configured={false} />);
  expect(
    screen.getByRole("button", { name: "로그인" }).hasAttribute("disabled"),
  ).toBe(true);
});

test("repurpose all returns seven editable formats and saves each format separately", async () => {
  const { AIStudio } = await import("../src/components/ai-studio");
  const user = userEvent.setup();
  const saved = vi.fn();
  mocks.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/generate") {
      expect(JSON.parse(String(options?.body)).mode).toBe("all");
      return {
        bundle: true,
        result: {
          threads: ["하나", "둘", "셋"],
          instagram: "인스타 본문",
          carousel: Array.from({ length: 8 }, (_, i) => ({
            title: `장 ${i + 1}`,
            body: "슬라이드 본문",
          })),
          blog: "블로그 본문",
          shorts: "숏폼 대본",
          hooks: Array.from({ length: 5 }, (_, i) => `후킹 ${i + 1}`),
          hashtags: Array.from({ length: 10 }, (_, i) => `#태그${i + 1}`),
        },
      };
    }
    return {
      content: {
        id: "new-content",
        ...JSON.parse(String(options?.body)),
        date: "2026-10-17",
        status: "초안",
      },
    };
  });
  render(
    <AIStudio
      brand={brand}
      provider="gemini"
      source={{
        title: "신메뉴",
        body: "기존에 작성한 소개글입니다.",
        url: null,
        type: "repurpose",
      }}
      onSaved={saved}
      onDeleted={vi.fn()}
      notify={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "모두 생성" }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "초안 저장" })).toHaveLength(
      7,
    ),
  );
  expect(
    screen.getAllByRole("textbox", { name: /생성된 콘텐츠 편집/ }),
  ).toHaveLength(7);
  await user.click(screen.getAllByRole("button", { name: "초안 저장" })[0]);
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(saved.mock.calls[0][0].channel).toBe("Threads");
});
