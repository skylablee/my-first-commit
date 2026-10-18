import { ConfigStatus } from "@/components/config-status";
export default function Setup() {
  return (
    <main className="setup-page">
      <h1>BizContent AI 환경 설정</h1>
      <p className="muted">
        README의 Supabase·환경변수 안내를 따라 설정하세요.
      </p>
      <ConfigStatus />
      <p className="muted">
        <a href="/login">로그인으로 돌아가기 →</a>
      </p>
    </main>
  );
}
