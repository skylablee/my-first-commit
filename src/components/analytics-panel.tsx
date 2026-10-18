"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
export function AnalyticsPanel() {
  const [data, setData] = useState<Record<string, number> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ metrics: Record<string, number> }>("/api/analytics")
      .then((d) => setData(d.metrics))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "성과 조회 실패"),
      );
  }, []);
  return (
    <section className="panel">
      <h2>내 서비스 운영 지표</h2>
      <p className="muted">
        Pro 이상 플랜 · 내부 DB 기반입니다. Threads 노출·클릭 지표는 수집하지
        않습니다.
      </p>
      {error && (
        <p role="alert" className="info-banner">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">조회 중…</p>}
      {data && (
        <div className="billing-summary">
          {Object.entries({
            contents_created: "생성 콘텐츠",
            ai_generations: "AI 요청",
            publications: "게시 작업",
            published: "게시 성공",
            failed: "게시 실패",
            publication_success_rate: "성공률 (%)",
          }).map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>{data[key] ?? 0}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
