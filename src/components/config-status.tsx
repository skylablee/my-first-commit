"use client";
import { useEffect, useState } from "react";
type Status = {
  variables: { name: string; configured: boolean }[];
  supabaseReady: boolean;
  aiReady: boolean;
};
export function ConfigStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/config")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active) setError("설정 상태를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="panel">
      <h2>환경변수 설정 상태</h2>
      <p className="muted">
        값은 표시하지 않습니다. 서버 또는 Vercel 환경 설정에서 입력한 뒤
        재시작·재배포하세요.
      </p>
      {error && <p role="alert">{error}</p>}
      {!status && !error && <p role="status">설정 확인 중…</p>}
      {status && (
        <>
          <p className="muted">
            Supabase 구성:{" "}
            {status.supabaseReady
              ? "형식 확인됨 (연결 검증 별도)"
              : "설정 필요"}{" "}
            · AI 구성:{" "}
            {status.aiReady ? "설정됨 (실호출 검증 별도)" : "설정 필요"}
          </p>
          <ul className="env-list">
            {status.variables.map((v) => (
              <li key={v.name}>
                <code>{v.name}</code>
                <span className={`badge ${v.configured ? "green" : ""}`}>
                  {v.configured ? "설정됨" : "미설정"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="small-note">
        공개 Supabase 키 이외에는 서버 전용입니다. API 키를 입력하는 브라우저
        폼은 제공하지 않습니다.
      </p>
    </section>
  );
}
