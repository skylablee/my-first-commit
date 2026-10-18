"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="setup-page">
      <section className="panel">
        <h1>잠시 문제가 생겼어요</h1>
        <p className="muted">
          연결 상태와 환경 설정을 확인한 후 다시 시도해 주세요.
        </p>
        {error.digest && <p className="small-note">오류 ID: {error.digest}</p>}
        <Button onClick={reset}>다시 시도</Button>{" "}
        <a href="/setup">환경 설정 확인</a>
      </section>
    </main>
  );
}
