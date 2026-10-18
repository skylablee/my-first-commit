"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Button } from "./ui/button";
type Row = Record<string, string | number | null | object>;
export function AdminPanel() {
  const [data, setData] = useState<{
      metrics: Record<string, number | Record<string, number>>;
      errors: Row[];
      failures: Row[];
      audit: Row[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<NonNullable<typeof data>>("/api/admin")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "조회 실패"));
  }, []);
  const labels = {
    users: "총 사용자",
    paid_users: "유료 사용자 (실결제)",
    mrr_krw: "MRR (KRW)",
    dau: "일 활성 사용자",
    mau: "월 활성 사용자",
    contents_created: "생성 콘텐츠",
    ai_generations: "AI 요청",
    estimated_ai_cost: "예상 AI 비용 (USD)",
    publications: "게시 작업",
    published: "게시 성공",
    failed: "게시 실패",
    publication_success_rate: "게시 성공률 (%)",
    publication_failure_rate: "게시 실패율 (%)",
  };
  return (
    <main className="admin-page">
      <div className="section-title">
        <h1>BizContent AI 운영 관리</h1><Button variant="outline"asChild><Link href="/admin/staging-check">Staging 연결 검증</Link></Button>
        <Button variant="outline" asChild>
          <Link href="/">워크스페이스</Link>
        </Button>
      </div>
      {error && (
        <p role="alert" className="info-banner">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">운영 지표 조회 중…</p>}
      {data && (
        <>
          <div className="stats-grid">
            {Object.entries(labels).map(([key, label]) => (
              <article className="stat-card" key={key}>
                <div>{label}</div>
                <strong>
                  {Number(data.metrics[key] ?? 0).toLocaleString()}
                </strong>
              </article>
            ))}
          </div>
          <section className="panel">
            <h2>플랜별 활성 유료 구독</h2>
            <p className="muted">
              mock 구독은 매출·유료 사용자·플랜별 집계에서 제외합니다. MRR은
              기간 종료 취소 예약을 제외한 월 반복 매출 기준입니다.
            </p>
            <pre>{JSON.stringify(data.metrics.plans, null, 2)}</pre>
          </section>
          {(["errors", "failures", "audit"] as const).map((key) => (
            <section className="panel" key={key}>
              <h2>
                {key === "errors"
                  ? "최근 API 오류"
                  : key === "failures"
                    ? "결제 실패"
                    : "감사 로그"}
              </h2>
              {!data[key].length ? (
                <p className="empty">기록 없음</p>
              ) : (
                <div className="admin-events">
                  {data[key].map((row, i) => (
                    <pre key={i}>{JSON.stringify(row, null, 2)}</pre>
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
