"use client";
import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
type Connection = { id: string; username: string; expires_at: string };
type Publication = {
  id: string;
  content_id: string;
  status: string;
  provider_post_id: string | null;
  provider_post_url?: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  error_message: string | null;
  retry_count: number;
  uncertain: boolean;
};
export function ThreadsPanel() {
  const [connection, setConnection] = useState<Connection | null>(null),
    [jobs, setJobs] = useState<Publication[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        api<{ connection: Connection | null }>("/api/threads"),
        api<{ publications: Publication[] }>("/api/publications"),
      ]);
      setConnection(c.connection);
      setJobs(p.publications);
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결을 불러오지 못했습니다.");
    }
  }, []);
  useEffect(() => {
    void load();
    const params = new URLSearchParams(location.search);
    if (params.get("threads") === "failed")
      setError(
        `Threads 연결을 완료하지 못했습니다. 요청 ID: ${params.get("request_id") ?? "없음"}`,
      );
  }, [load]);
  return (
    <section className="panel">
      <h2>Threads 연결 및 게시 결과</h2>
      <p className="muted">
        {connection
          ? `@${connection.username} · 만료 ${new Date(connection.expires_at).toLocaleDateString("ko-KR")}`
          : "아직 연결된 계정이 없습니다."}
      </p>
      <div className="generation-actions">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const data = await api<{ url: string }>("/api/threads/connect", {
                method: "POST",
              });
              window.location.assign(data.url);
            } catch (e) {
              setError(e instanceof Error ? e.message : "연결 실패");
              setBusy(false);
            }
          }}
        >
          {connection ? "Threads 다시 연결" : "Threads 연결"}
        </Button>
        {connection && (
          <Button
            disabled={busy}
            variant="outline"
            onClick={async () => {
              if (
                !confirm(
                  "Threads 연결을 해제할까요? 대기 중인 발행은 실패할 수 있습니다. Meta 앱 권한 철회는 Threads 설정에서도 확인하세요.",
                )
              )
                return;
              setBusy(true);
              try {
                await api("/api/threads", { method: "DELETE" });
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "연결 해제 실패");
              } finally {
                setBusy(false);
              }
            }}
          >
            연결 해제
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          게시 상태 새로고침
        </Button>
      </div>
      {error && (
        <p role="alert" className="info-banner">
          {error}
        </p>
      )}
      <p className="small-note">
        콘텐츠 라이브러리에서 Threads 형식 초안을 열어 지금 게시 또는 예약할 수
        있습니다. Threads 본문은 500자 이하여야 합니다. 예약 시간은 Cron 실행
        시각·제공자 상태에 따라 지연될 수 있습니다.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>상태</th>
              <th>예약·발행일</th>
              <th>결과</th>
              <th>재시도</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>
                  {j.status}
                  {j.uncertain ? " · 결과 불명" : ""}
                </td>
                <td>
                  {j.published_at || j.scheduled_at
                    ? new Date(
                        j.published_at ?? j.scheduled_at!,
                      ).toLocaleString("ko-KR")
                    : "즉시"}
                </td>
                <td>
                  {j.provider_post_id ? (
                    j.provider_post_url ? (
                      <a
                        href={j.provider_post_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Threads 게시물 보기 ↗
                      </a>
                    ) : (
                      `게시 ID ${j.provider_post_id}`
                    )
                  ) : (
                    (j.error_message ?? "—")
                  )}
                </td>
                <td>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      busy ||
                      j.status !== "failed" ||
                      j.uncertain ||
                      j.retry_count >= 3
                    }
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api("/api/publications", {
                          method: "PATCH",
                          body: JSON.stringify({ id: j.id }),
                        });
                        await load();
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "재시도 실패",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    다시 시도 ({j.retry_count}/3)
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!jobs.length && <p className="empty">등록한 게시 작업이 없습니다.</p>}
      </div>
    </section>
  );
}
