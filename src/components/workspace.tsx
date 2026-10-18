"use client";
import { BillingPanel } from "./billing-panel";
import { ThreadsPanel } from "./threads-panel";
import { AnalyticsPanel } from "./analytics-panel";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  Home,
  Lightbulb,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  WandSparkles,
  X,
  Plug,
  Brain,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyBrand, type Brand, type Content } from "@/lib/content";
import { api } from "@/lib/client-api";
import { brandInput } from "@/lib/contracts";
import { AIStudio, type StudioSource } from "./ai-studio";
import { NewsRadar } from "./news-radar";
import { ConfigStatus } from "./config-status";
import { ContentDetail } from "./content-detail";
const navigation = [
  ["dashboard", "대시보드", Home],
  ["trends", "트렌드 레이더", TrendingUp],
  ["ideas", "콘텐츠 아이디어", Lightbulb],
  ["studio", "AI 스튜디오", WandSparkles],
  ["calendar", "콘텐츠 캘린더", CalendarDays],
  ["published", "발행한 콘텐츠", Send],
  ["analytics", "성과 분석", BarChart3],
  ["brand", "브랜드 브레인", Brain],
  ["integrations", "연동 관리", Plug],
  ["billing", "요금 및 결제", CreditCard],
  ["settings", "설정", Settings],
] as const;
type View = (typeof navigation)[number][0] | "library";
const trends = [
  {
    tag: "계절 트렌드",
    title: "가을 한 잔에 담긴 취향",
    desc: "밤, 고구마, 단풍. 가을의 맛을 찾는 고객이 늘고 있어요.",
    growth: "+32%",
    topic: "가을 한정 메뉴와 함께하는 따뜻한 오후",
    emoji: "🍂",
  },
  {
    tag: "로컬 라이프",
    title: "멀리 가지 않아도, 동네 여행",
    desc: "우리 동네 숨은 공간과 사장님의 이야기에 주목해요.",
    growth: "+24%",
    topic: "우리 동네에서 발견한 나만의 아지트",
    emoji: "🏡",
  },
  {
    tag: "소비 트렌드",
    title: "작지만 확실한 나의 행복",
    desc: "나를 위한 작은 선물, 일상의 특별한 순간을 전해보세요.",
    growth: "+18%",
    topic: "바쁜 일상 속 나를 위한 작은 선물",
    emoji: "☕",
  },
];
type Usage = {
  today: number;
  month: number;
  estimated_cost: number;
  reserved: number;
  input_tokens: number;
  output_tokens: number;
  plan?: string;
  limit?: number;
  remaining?: number;
};
export function Workspace({
  userLabel = "사장님",
  userId,
}: {
  userLabel?: string;
  userId: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("dashboard");
  const [mobile, setMobile] = useState(false);
  const [brand, setBrand] = useState<Brand>(emptyBrand);
  const [brandDraft, setBrandDraft] = useState<Brand>(emptyBrand);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [contents, setContents] = useState<Content[]>([]);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("전체");
  const [selected, setSelected] = useState<Content | null>(null);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());
  const [usage, setUsage] = useState<Usage>({
    today: 0,
    month: 0,
    estimated_cost: 0,
    reserved: 0,
    input_tokens: 0,
    output_tokens: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");
  const [studioSource, setStudioSource] = useState<StudioSource>({
    title: "",
    body: "",
    url: null,
    type: "manual",
  });
  const [studioKey, setStudioKey] = useState(0);
  const refreshUsage = useCallback(async () => {
    try {
      const data = await api<{ usage: Usage }>("/api/usage");
      setUsage(data.usage);
    } catch {
      setNotice(
        "AI 사용량을 불러오지 못했습니다. 환경 설정과 DB 스키마를 확인해 주세요.",
      );
    }
  }, []);
  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const results = await Promise.allSettled([
      api<{ brands: Brand[] }>("/api/brands"),
      api<{ contents: Content[]; nextCursor: string | null }>("/api/contents"),
      api<{ usage: Usage }>("/api/usage"),
    ]);
    const [b, c, u] = results;
    if (b.status === "fulfilled") {
      setBrands(b.value.brands);
      setBrand(b.value.brands[0] ?? emptyBrand);
      setBrandDraft(b.value.brands[0] ?? emptyBrand);
    }
    if (c.status === "fulfilled") {
      setContents(c.value.contents);
      setNextCursor(c.value.nextCursor);
    }
    if (u.status === "fulfilled") setUsage(u.value.usage);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length)
      setLoadError(
        failures
          .map((r) =>
            r.status === "rejected"
              ? r.reason instanceof Error
                ? r.reason.message
                : "연결 실패"
              : "",
          )
          .join(" / "),
      );
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
    try {
      const stored = localStorage.getItem(`bizcontent:provider:${userId}`);
      if (stored === "openai" || stored === "gemini") setProvider(stored);
    } catch {
      /* Nonessential preference. */
    }
    const handler = () => {
      const h = location.hash.slice(1);
      if (navigation.some((n) => n[0] === h) || h === "library")
        setView(h as View);
    };
    handler();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [reload, userId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (view === "dashboard" || view === "settings") void refreshUsage();
  }, [view, refreshUsage]);
  function go(v: View) {
    setView(v);
    location.hash = v;
    setMobile(false);
    setQuery("");
    setFilter("전체");
  }
  function create(t: string, source?: StudioSource) {
    setStudioSource(
      source ?? { title: t, body: "", url: null, type: "manual" },
    );
    setStudioKey((prev) => prev + 1);
    go("studio");
  }
  function upsertContent(content: Content) {
    setContents((prev) => [
      content,
      ...prev.filter((c) => c.id !== content.id),
    ]);
  }
  function deleteContent(id: string) {
    setContents((prev) => prev.filter((c) => c.id !== id));
  }
  async function saveBrand() {
    setBusy(true);
    try {
      const input = brandInput.safeParse({
        ...brandDraft,
        keywords: (brandDraft.keywords ?? [])
          .map((v) => v.trim())
          .filter(Boolean),
        forbidden_words: (brandDraft.forbidden_words ?? [])
          .map((v) => v.trim())
          .filter(Boolean),
      });
      if (!input.success) {
        const field = String(input.error.issues[0]?.path[0]);
        const labels: Record<string, string> = {
          website: "웹사이트",
          blog_url: "블로그 URL",
          instagram: "Instagram URL",
          threads: "Threads URL",
        };
        throw new Error(
          labels[field]
            ? `${labels[field]} 주소를 확인해 주세요. 비워 두거나 example.com 또는 https://로 시작하는 주소를 입력해 주세요.`
            : field === "name"
              ? "브랜드 이름을 1~150자로 입력해 주세요."
              : "입력 내용의 글자 수와 항목 수를 확인해 주세요.",
        );
      }
      const data = await api<{ brand: Brand }>("/api/brands", {
        method: brandDraft.id ? "PATCH" : "POST",
        body: JSON.stringify(input.data),
      });
      setBrand(data.brand);
      setBrandDraft(data.brand);
      setBrands((prev) =>
        prev.some((b) => b.id === data.brand.id)
          ? prev.map((b) => (b.id === data.brand.id ? data.brand : b))
          : [...prev, data.brand],
      );
      setNotice("브랜드 정보를 DB에 저장했어요.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function removeBrand() {
    if (
      !brand.id ||
      !window.confirm("브랜드와 연결된 모든 제품·콘텐츠를 영구 삭제할까요?")
    )
      return;
    setBusy(true);
    try {
      await api(`/api/brands?id=${brand.id}`, { method: "DELETE" });
      const remaining = brands.filter((b) => b.id !== brand.id);
      setBrands(remaining);
      setContents((prev) => prev.filter((c) => c.brand_id !== brand.id));
      setBrand(remaining[0] ?? emptyBrand);
      setBrandDraft(remaining[0] ?? emptyBrand);
      setNotice("브랜드를 삭제했습니다.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }
  const title =
    view === "library"
      ? "콘텐츠 라이브러리"
      : navigation.find((n) => n[0] === view)?.[1];
  const visible = contents.filter(
    (c) =>
      (view !== "published" || c.status === "발행됨") &&
      (filter === "전체" || c.status === filter) &&
      (c.title + c.body + c.channel)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function library() {
    return (
      <>
        <div className="section-top">
          <div className="tabs">
            {["전체", "초안", "예약됨", "발행됨"].map((f) => (
              <button
                key={f}
                className={filter === f ? "active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="콘텐츠 검색"
              placeholder="콘텐츠 검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>콘텐츠 제목</th>
                <th>채널</th>
                <th>상태</th>
                <th>날짜</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button
                      className="content-title"
                      onClick={() => setSelected(c)}
                    >
                      <span className="file-icon">
                        <FileText size={17} />
                      </span>
                      {c.title}
                    </button>
                  </td>
                  <td>{c.channel}</td>
                  <td>
                    <span
                      className={`badge ${c.status === "발행됨" ? "green" : c.status === "예약됨" ? "purple" : ""}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td>{c.date}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`${c.title} 자세히 보기`}
                      onClick={() => setSelected(c)}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="empty">
              조건에 맞는 콘텐츠가 없어요. 다른 검색어를 입력하거나 새 콘텐츠를
              만들어 보세요.
            </div>
          )}
        </div>
        {nextCursor && (
          <div className="load-more">
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const data = await api<{
                    contents: Content[];
                    nextCursor: string | null;
                  }>(`/api/contents?cursor=${encodeURIComponent(nextCursor)}`);
                  setContents((prev) => [
                    ...prev,
                    ...data.contents.filter(
                      (c) => !prev.some((p) => p.id === c.id),
                    ),
                  ]);
                  setNextCursor(data.nextCursor);
                } catch (err) {
                  setNotice(
                    err instanceof Error
                      ? err.message
                      : "목록을 불러오지 못했습니다.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "불러오는 중…" : "콘텐츠 더 불러오기"}
            </Button>
          </div>
        )}
      </>
    );
  }
  return (
    <div className="shell">
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>
      {mobile && (
        <button
          className="scrim"
          aria-label="메뉴 닫기"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="logo" href="#dashboard" onClick={() => go("dashboard")}>
          <span className="logo-mark">
            <Sparkles size={20} />
          </span>
          BizContent <span className="logo-ai">AI</span>
        </a>
        <button className="workspace-switch" onClick={() => go("brand")}>
          <span className="shop-avatar">오</span>
          <span>
            <strong>{brand.name || "새 브랜드"}</strong>
            <small>내 브랜드 워크스페이스</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">워크스페이스</div>
        <nav aria-label="주 메뉴">
          {navigation.slice(0, 7).map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              {label}
              {id === "studio" && (
                <span className="nav-new" aria-hidden="true">
                  AI
                </span>
              )}
            </button>
          ))}
          <button
            className={view === "library" ? "nav-item active" : "nav-item"}
            onClick={() => go("library")}
          >
            <BookOpen size={18} />
            콘텐츠 라이브러리
          </button>
          <div className="nav-divider" />
          {navigation.slice(7).map(([id, label, Icon]) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-box">
            <div>
              <Sparkles size={16} />
              <strong>아이디어를 더 크게</strong>
            </div>
            <p>브랜드의 다음 성장을 준비하세요.</p>
            <Button variant="outline" size="sm" onClick={() => go("billing")}>
              플랜 살펴보기 <ArrowRight size={14} />
            </Button>
          </div>
          <button className="profile" onClick={() => go("settings")}>
            <span className="user-avatar">김</span>
            <span>
              <strong>{userLabel}</strong>
              <small>개인 워크스페이스</small>
            </span>
            <Settings size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-toggle"
              aria-label="메뉴 열기"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              워크스페이스 <span>/</span> <strong>{title}</strong>
            </span>
          </div>
          <div className="top-actions">
            <span className="demo-pill">
              <span />
              연결 모드
            </span>
            <button
              className="icon-button"
              aria-label="도움말"
              onClick={() =>
                setNotice(
                  "브랜드를 저장한 후 뉴스 검색·AI 생성·초안 저장을 이용하세요. 플랜별 기능과 Threads 연결 상태는 요금 및 결제·연동 관리에서 확인하세요.",
                )
              }
            >
              <CircleHelp size={19} />
            </button>
            <button
              className="icon-button notification"
              aria-label="알림"
              onClick={() =>
                setNotice(
                  "새로운 알림이 없습니다. 대시보드 추천 주제는 편집 예시이며 실제 뉴스는 트렌드 레이더에서 검색하세요.",
                )
              }
            >
              <Bell size={19} />
              <i />
            </button>
            <span className="user-avatar small">김</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR BUSINESS, YOUR STORY</div>
              <h1>
                {view === "dashboard" ? "좋은 하루예요, 사장님 👋" : title}
              </h1>
              <p>
                {view === "dashboard"
                  ? "오늘도 우리 가게의 이야기를 더 많은 고객에게 전해볼까요?"
                  : view === "studio"
                    ? "브랜드의 목소리를 담아, 다음 콘텐츠를 시작해 보세요."
                    : "우리 가게의 마케팅을 한곳에서 관리하세요."}
              </p>
            </div>
            {view !== "studio" && (
              <Button onClick={() => create("")}>
                <Plus size={17} />
                콘텐츠 만들기
              </Button>
            )}
          </div>
          {loading && (
            <p role="status" className="info-banner">
              DB에서 데이터를 불러오는 중…
            </p>
          )}
          {loadError && (
            <div role="alert" className="info-banner">
              {loadError}{" "}
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void reload()}
              >
                다시 불러오기
              </Button>
            </div>
          )}
          {view === "dashboard" && (
            <>
              <section className="hero">
                <div>
                  <span className="hero-label">
                    <Sparkles size={14} /> 사장님을 위한 오늘의 제안
                  </span>
                  <h2>
                    무엇을 올릴지 고민될 때,
                    <br />
                    AI와 함께 시작해 보세요.
                  </h2>
                  <p>
                    우리 브랜드를 이해하는 AI가 아이디어부터 글쓰기까지
                    도와드려요.
                  </p>
                  <Button
                    onClick={() =>
                      create("가을 신메뉴를 소개하는 따뜻한 이야기")
                    }
                  >
                    첫 콘텐츠 만들어보기 <ArrowRight size={16} />
                  </Button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-card back">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="art-card front">
                    <span className="art-spark">✦</span>
                    <strong>
                      작은 가게의 이야기,
                      <br />더 큰 가능성으로.
                    </strong>
                    <div className="art-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="art-badge">✧ AI가 함께해요</span>
                  </div>
                  <span className="floating-star">✧</span>
                </div>
              </section>
              <section className="stats-grid">
                {[
                  {
                    label: "불러온 콘텐츠",
                    value: contents.length,
                    unit: "개",
                    hint: "DB 초안 · 추가 목록은 라이브러리에서",
                    icon: FileText,
                  },
                  {
                    label: "발행한 콘텐츠",
                    value: contents.filter((c) => c.status === "발행됨").length,
                    unit: "개",
                    hint: "불러온 목록의 발행 상태",
                    icon: Send,
                  },
                  {
                    label: "예약된 콘텐츠",
                    value: contents.filter((c) => c.status === "예약됨").length,
                    unit: "개",
                    hint: "Threads 게시 상태 기준",
                    icon: CalendarDays,
                  },
                  {
                    label: "오늘 AI 요청",
                    value: usage.today,
                    unit: "회",
                    hint: `이번 달 ${usage.month}/${usage.limit ?? 10}회 · 남음 ${usage.remaining ?? Math.max(0, 10 - usage.month)}회`,
                    icon: Sparkles,
                  },
                ].map((s) => (
                  <article className="stat-card" key={s.label}>
                    <div>
                      {s.label}
                      <s.icon size={17} />
                    </div>
                    <strong>
                      {s.value}
                      <small>{s.unit}</small>
                    </strong>
                    <p>{s.hint}</p>
                  </article>
                ))}
              </section>
              <section className="dashboard-columns">
                <div>
                  <div className="section-title">
                    <h2>
                      추천 콘텐츠 주제 <span className="badge">편집 예시</span>
                    </h2>
                    <button onClick={() => go("trends")}>
                      전체 보기 <ArrowRight size={14} />
                    </button>
                  </div>
                  <div className="trend-list">
                    {trends.slice(0, 2).map((t) => (
                      <button
                        className="trend-row"
                        key={t.title}
                        onClick={() => create(t.topic)}
                      >
                        <span className="trend-emoji">{t.emoji}</span>
                        <span>
                          <small>{t.tag}</small>
                          <strong>{t.title}</strong>
                          <p>{t.desc}</p>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <article className="brand-summary">
                  <div className="section-title">
                    <h2>
                      <Brain size={18} /> 브랜드 브레인
                    </h2>
                    <span className="badge green">
                      {brand.id ? "저장됨" : "설정 필요"}
                    </span>
                  </div>
                  <p>
                    우리 브랜드를 알수록,
                    <br />더 우리다운 콘텐츠가 만들어져요.
                  </p>
                  <div className="brand-chips">
                    <span>{brand.industry}</span>
                    <span>{brand.voice}</span>
                  </div>
                  <button onClick={() => go("brand")}>
                    브랜드 정보 관리 <ArrowRight size={15} />
                  </button>
                </article>
              </section>
              <section className="content-section">
                <div className="section-title">
                  <h2>최근 콘텐츠</h2>
                  <button onClick={() => go("library")}>
                    라이브러리 보기 <ArrowRight size={14} />
                  </button>
                </div>
                {library()}
              </section>
              <p className="footer-note">
                작은 가게의 큰 이야기를 응원합니다. <Sparkles size={13} />{" "}
                BizContent AI
              </p>
            </>
          )}
          {view === "brand" && (
            <section className="panel form-panel">
              <div className="section-title">
                <h2>우리 브랜드의 기준을 알려주세요</h2>
                {brand.active === false && (
                  <p className="info-banner">
                    현재 플랜의 활성 브랜드 수를 초과한 보관 브랜드입니다.
                    데이터는 유지됩니다. 업그레이드하거나 이전 브랜드를 삭제하면
                    다시 활성화됩니다.
                  </p>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBrand(emptyBrand);
                    setBrandDraft(emptyBrand);
                  }}
                >
                  새 브랜드
                </Button>
              </div>
              <label>
                관리할 브랜드
                <select
                  value={brand.id ?? ""}
                  disabled={busy}
                  onChange={(e) => {
                    const b =
                      brands.find((b) => b.id === e.target.value) ?? emptyBrand;
                    setBrand(b);
                    setBrandDraft(b);
                  }}
                >
                  <option value="">새 브랜드 작성</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.active === false ? " (보관됨)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                저장한 정보는 내 계정의 Supabase DB에 보관되며 AI 생성에
                반영됩니다.
              </p>
              <p className="muted">
                브랜드 이름만 필수입니다. 나머지는 비워 두고 나중에 추가해도
                됩니다. 주소가 없다면 숫자나 점 대신 빈칸으로 남겨 주세요.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveBrand();
                }}
              >
                <div className="form-grid">
                  {(
                    [
                      ["name", "브랜드 이름"],
                      ["industry", "업종"],
                      ["audience", "주요 고객"],
                      ["voice", "브랜드 말투"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        required={key === "name"}
                        maxLength={150}
                        value={brandDraft[key]}
                        onChange={(e) =>
                          setBrandDraft({
                            ...brandDraft,
                            [key]: e.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  브랜드 소개
                  <textarea
                    maxLength={1000}
                    rows={4}
                    value={brandDraft.description}
                    onChange={(e) =>
                      setBrandDraft({
                        ...brandDraft,
                        description: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="form-grid">
                  {(
                    [
                      ["website", "웹사이트"],
                      ["blog_url", "블로그 URL"],
                      ["instagram", "Instagram URL"],
                      ["threads", "Threads URL"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="text"
                        inputMode="url"
                        placeholder="선택 · example.com 또는 https://…"
                        maxLength={2048}
                        value={brandDraft[key] ?? ""}
                        onChange={(e) =>
                          setBrandDraft({
                            ...brandDraft,
                            [key]: e.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {(
                  [
                    ["keywords", "핵심 키워드"],
                    ["forbidden_words", "금칙어"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label} (쉼표로 구분, 최대 20개)
                    <input
                      maxLength={1000}
                      value={(brandDraft[key] ?? []).join(",")}
                      onChange={(e) =>
                        setBrandDraft({
                          ...brandDraft,
                          [key]: e.target.value.split(","),
                        })
                      }
                    />
                  </label>
                ))}
                <div className="result-actions">
                  {brand.id && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void removeBrand()}
                    >
                      브랜드 삭제
                    </Button>
                  )}
                  <Button
                    type="submit"
                    disabled={busy || loading || brand.active === false}
                  >
                    <Check size={16} />
                    {busy ? "처리 중…" : "브랜드 정보 저장"}
                  </Button>
                </div>
              </form>
            </section>
          )}
          {view === "trends" && (
            <NewsRadar
              onWrite={(news) =>
                create(news.title.slice(0, 300), {
                  title: news.title.slice(0, 300),
                  body: news.description,
                  url: news.originallink || news.link,
                  type: "news",
                })
              }
            />
          )}
          {view === "ideas" && (
            <div className="ideas-grid">
              {[
                "신메뉴에 숨은 사장님의 이야기",
                "단골 고객이 다시 찾아오는 이유",
                "우리 가게의 아침 준비 과정",
                "비 오는 날 어울리는 추천 메뉴",
                "이번 주말, 동네 산책 코스",
                "자주 묻는 질문에 답해드려요",
              ].map((t, i) => (
                <article className="panel idea-card" key={t}>
                  <span className="idea-number">0{i + 1}</span>
                  <span className="badge">
                    {["브랜드 스토리", "고객 소통", "비하인드"][i % 3]}
                  </span>
                  <h2>{t}</h2>
                  <p>
                    {brand.name}의 매력을 자연스럽게 전할 수 있는 아이디어예요.
                  </p>
                  <Button variant="outline" onClick={() => create(t)}>
                    초안 작성하기 <ArrowRight size={15} />
                  </Button>
                </article>
              ))}
            </div>
          )}
          {view === "studio" && (
            <AIStudio
              key={studioKey}
              brand={brand}
              provider={provider}
              allowRepurpose={usage.plan === "PRO" || usage.plan === "AGENCY"}
              source={studioSource}
              onSaved={upsertContent}
              onDeleted={deleteContent}
              notify={setNotice}
            />
          )}
          {(view === "library" || view === "published") && (
            <section className="panel content-section">
              {view === "published" && (
                <p className="muted">
                  DB에 발행 상태로 기록된 콘텐츠입니다. 실제 채널 자동 발행은
                  아직 지원하지 않습니다.
                </p>
              )}
              {library()}
            </section>
          )}
          {view === "calendar" && (
            <section className="panel">
              <div className="section-title">
                <h2>
                  {year}년 {month + 1}월
                </h2>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="이전 달"
                    onClick={() => {
                      if (month === 0) {
                        setMonth(11);
                        setYear(year - 1);
                      } else setMonth(month - 1);
                    }}
                  >
                    이전
                  </Button>{" "}
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="다음 달"
                    onClick={() => {
                      if (month === 11) {
                        setMonth(0);
                        setYear(year + 1);
                      } else setMonth(month + 1);
                    }}
                  >
                    다음
                  </Button>
                </div>
              </div>
              <p className="muted">
                불러온 콘텐츠의 생성일 또는 예약일입니다. 자동 발행은 실행되지
                않습니다.
              </p>
              <div className="calendar">
                {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
                  <div className="calendar-day" key={d}>
                    {d}
                  </div>
                ))}
                {Array.from(
                  { length: new Date(year, month, 1).getDay() },
                  (_, i) => (
                    <div className="calendar-cell blank" key={`blank${i}`} />
                  ),
                )}
                {Array.from(
                  { length: new Date(year, month + 1, 0).getDate() },
                  (_, i) => {
                    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                    return (
                      <div className="calendar-cell" key={date}>
                        <span>{i + 1}</span>
                        {contents
                          .filter((c) => c.date === date)
                          .map((c) => (
                            <button key={c.id} onClick={() => setSelected(c)}>
                              {c.title}
                            </button>
                          ))}
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          )}
          {view === "analytics" && <AnalyticsPanel />}
          {view === "integrations" && (
            <>
              <ThreadsPanel />
              <ConfigStatus />
              <div className="info-banner">
                뉴스와 AI는 서버 API를 통해 호출됩니다. 키 설정 여부는 실제 연결
                성공을 뜻하지 않습니다. Threads 연결과 게시를 지원합니다. 다른
                채널 발행은 미지원입니다.
              </div>
            </>
          )}
          {view === "billing" && <BillingPanel />}
          {view === "settings" && (
            <>
              <section className="panel form-panel">
                <h2>워크스페이스 설정</h2>
                <p className="small-note">
                  <a href="/admin">관리자 페이지 (관리자 권한 필요)</a>
                </p>
                <p className="muted">
                  로그인된 사용자: {userLabel}. 브랜드와 콘텐츠는 Supabase DB에
                  저장됩니다.
                </p>
                <label>
                  AI 제공자
                  <select
                    value={provider}
                    onChange={(e) => {
                      const p = e.target.value as "openai" | "gemini";
                      setProvider(p);
                      try {
                        localStorage.setItem(
                          `bizcontent:provider:${userId}`,
                          p,
                        );
                      } catch {
                        setNotice("설정을 브라우저에 저장하지 못했습니다.");
                      }
                    }}
                  >
                    <option value="openai">OpenAI · gpt-4o-mini</option>
                    <option value="gemini">Gemini · gemini-2.5-flash</option>
                  </select>
                </label>
                <p className="muted">
                  이번 달 {usage.month}회 · 입력 {usage.input_tokens} / 출력{" "}
                  {usage.output_tokens} tokens · 예상 USD $
                  {Number(usage.estimated_cost).toFixed(4)}. 불확실한 실패·대기
                  예약 {usage.reserved}건은 건당 $0.10을 보수적으로 포함합니다.
                  실제 청구액은 제공자 콘솔을 확인하세요.
                </p>
                <div className="settings-row">
                  <div>
                    <strong>데이터 내보내기</strong>
                    <p>현재 불러온 브랜드와 콘텐츠를 JSON 파일로 저장합니다.</p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const blob = new Blob(
                        [JSON.stringify({ brands, contents }, null, 2)],
                        { type: "application/json" },
                      );
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "bizcontent-backup.json";
                      a.click();
                      URL.revokeObjectURL(url);
                      setNotice(
                        "현재 불러온 데이터의 백업을 내보냈어요. 전체 백업은 Supabase에서 수행하세요.",
                      );
                    }}
                  >
                    내보내기
                  </Button>
                </div>
                <div className="settings-row">
                  <div>
                    <strong>로그아웃</strong>
                    <p>공유 기기에서는 이용 후 로그아웃하세요.</p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/auth", {
                          method: "POST",
                          body: JSON.stringify({ action: "logout" }),
                        });
                        router.replace("/login");
                        router.refresh();
                      } catch (err) {
                        setNotice(
                          err instanceof Error ? err.message : "로그아웃 실패",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    로그아웃
                  </Button>
                </div>
              </section>
              <ConfigStatus />
            </>
          )}
        </main>
      </div>
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {selected && (
        <ContentDetail
          key={selected.id}
          content={selected}
          allowRepurpose={usage.plan === "PRO" || usage.plan === "AGENCY"}
          onClose={() => setSelected(null)}
          onSaved={upsertContent}
          onDeleted={deleteContent}
          onRepurpose={(c) => {
            setSelected(null);
            const b = brands.find((b) => b.id === c.brand_id);
            if (b) {
              setBrand(b);
              setBrandDraft(b);
            }
            create(c.title, {
              title: c.title,
              body: c.body,
              url: c.source_url ?? null,
              type: "repurpose",
            });
          }}
          notify={setNotice}
        />
      )}
    </div>
  );
}
