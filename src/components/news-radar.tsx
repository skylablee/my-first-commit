"use client";
import { useState } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
import type { NewsItem } from "@/lib/providers/news";
import type { Trend } from "@/lib/providers/trends";
export function NewsRadar({ onWrite }: { onWrite: (news: NewsItem) => void }) {
  const [provider, setProvider] = useState("google");
  const [q, setQ] = useState("소상공인");
  const [sort, setSort] = useState("date");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [busy, setBusy] = useState(false);
  const [trendBusy, setTrendBusy] = useState(false);
  const [error, setError] = useState("");
  const [trendError, setTrendError] = useState("");
  const [searched, setSearched] = useState(false);
  const [trendSearched, setTrendSearched] = useState(false);
  async function loadTrends(action: string) {
    setTrendBusy(true);
    setTrendError("");
    setTrends([]);
    setTrendSearched(true);
    try {
      const data = await api<{ items: Trend[] }>(
        `/api/trends?${new URLSearchParams({ action, q })}`,
      );
      setTrends(data.items);
    } catch (err) {
      setTrendError(
        err instanceof Error ? err.message : "트렌드를 불러오지 못했습니다.",
      );
    } finally {
      setTrendBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>뉴스 검색</h2>
        <p className="muted">
          실제 뉴스의 제목·요약을 참고하세요. 원문 저작권을 존중하고 게시 전
          내용을 확인해 주세요.
        </p>
        <form
          className="radar-search"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setItems([]);
            setSearched(true);
            try {
              const data = await api<{ items: NewsItem[] }>(
                `/api/news?${new URLSearchParams({ q, provider, sort })}`,
              );
              setItems(data.items);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "뉴스 검색에 실패했습니다.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            검색어
            <input
              required
              maxLength={100}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label>
            뉴스 제공자
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setItems([]);
                setSearched(false);
              }}
            >
              <option value="google">Google News RSS</option>
              <option value="naver">네이버 뉴스</option>
            </select>
          </label>
          {provider === "naver" && (
            <label>
              정렬
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="date">최신순</option>
                <option value="sim">관련도순</option>
              </select>
            </label>
          )}
          <Button disabled={busy || !q.trim()} type="submit">
            {busy ? "검색 중…" : "뉴스 검색"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="info-banner">
            {error}
          </p>
        )}
        {searched && !busy && !error && !items.length && (
          <p className="muted">검색 결과가 없습니다.</p>
        )}
        <div className="news-list">
          {items.map((n, i) => (
            <article className="news-item" key={`${n.link}-${i}`}>
              <span className="badge">{n.source}</span>
              <h3>
                <a
                  href={n.originallink || n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {n.title} ↗
                </a>
              </h3>
              <p>{n.description}</p>
              <small>{n.publishedAt}</small>
              <Button variant="outline" size="sm" onClick={() => onWrite(n)}>
                이 뉴스로 글 작성
              </Button>
            </article>
          ))}
        </div>
      </section>
      <section className="panel trends-panel">
        <h2>Google Trends</h2>
        <p className="muted">
          비공식 공개 RSS·웹 엔드포인트입니다. 차단 또는 응답 변경 시 데이터를
          제공하지 못할 수 있습니다. 0~100 관심도는 검색량이 아닌 상대
          지수입니다.
        </p>
        <div className="result-actions">
          <Button
            variant="outline"
            disabled={trendBusy}
            onClick={() => loadTrends("trending")}
          >
            인기 검색어
          </Button>
          <Button
            variant="outline"
            disabled={trendBusy || !q.trim()}
            onClick={() => loadTrends("search")}
          >
            입력 키워드 관심도
          </Button>
          <Button
            variant="outline"
            disabled={trendBusy || !q.trim()}
            onClick={() => loadTrends("related")}
          >
            연관 검색어
          </Button>
        </div>
        {trendBusy && (
          <p role="status" className="muted">
            트렌드 조회 중…
          </p>
        )}
        {trendError && (
          <p role="alert" className="info-banner">
            {trendError} 위 뉴스 검색은 계속 이용할 수 있습니다.
          </p>
        )}
        {trendSearched && !trendBusy && !trendError && !trends.length && (
          <p className="muted">제공된 트렌드 데이터가 없습니다.</p>
        )}
        <div className="news-list">
          {trends.map((t, i) => (
            <div className="news-item" key={i}>
              <a href={t.link} target="_blank" rel="noopener noreferrer">
                {t.title} ↗
              </a>
              {t.value !== undefined && (
                <span className="badge">관심도 {t.value}</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onWrite({
                    title: t.title,
                    description: "",
                    link: t.link,
                    originallink: t.link,
                    source: "Google Trends",
                    pubDate: "",
                    publishedAt: "",
                  })
                }
              >
                이 주제로 작성
              </Button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
