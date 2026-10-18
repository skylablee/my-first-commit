"use client";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Sparkles } from "lucide-react";
export function AuthForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (new URLSearchParams(location.search).has("error"))
      setMessage(
        "이메일 인증에 실패했습니다. 인증 메일을 다시 확인하거나 로그인해 주세요.",
      );
  }, []);
  return (
    <section className="auth-card panel">
      <a className="logo" href="/login">
        <span className="logo-mark">
          <Sparkles size={20} />
        </span>
        BizContent AI
      </a>
      <h1>{signup ? "우리 가게의 이야기, 시작해요" : "다시 만나 반가워요"}</h1>
      <p className="muted">
        {signup
          ? "이메일로 가입하고 브랜드를 관리하세요."
          : "로그인하고 워크스페이스를 이어가세요."}
      </p>
      {!configured && (
        <div role="status" className="info-banner">
          Supabase 연결 설정이 없습니다. NEXT_PUBLIC_SUPABASE_URL과
          NEXT_PUBLIC_SUPABASE_ANON_KEY를 서버 환경에 설정해 주세요.{" "}
          <a href="/setup">환경 설정 상태 확인</a>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const data = new FormData(e.currentTarget);
          try {
            const response = await fetch("/api/auth", {
              method: "POST",
              signal: AbortSignal.timeout(30000),
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: signup ? "signup" : "login",
                email: data.get("email"),
                password: data.get("password"),
                ...(signup ? { name: data.get("name") } : {}),
              }),
            });
            const result = await response.json().catch(() => {
              throw new Error("인증 서버 응답을 확인하지 못했습니다.");
            });
            if (!response.ok)
              throw new Error(result.error?.message || "인증에 실패했습니다.");
            if (!signup || result.confirmed) {
              router.push("/");
              router.refresh();
            } else setMessage(result.message);
          } catch (error) {
            setMessage(
              error instanceof TypeError
                ? "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
                : error instanceof Error
                  ? error.message
                  : "연결에 실패했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {signup && (
          <label>
            이름
            <input name="name" autoComplete="name" maxLength={80} required />
          </label>
        )}
        <label>
          이메일
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            minLength={8}
            maxLength={128}
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
        </label>
        <Button disabled={busy || !configured} type="submit">
          {busy ? "처리 중…" : signup ? "회원가입" : "로그인"}
        </Button>
      </form>
      {message && (
        <p role="alert" className="auth-message">
          {message}
        </p>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          setSignup(!signup);
          setMessage("");
        }}
      >
        {signup ? "이미 계정이 있나요? 로그인" : "처음이신가요? 회원가입"}
      </Button>
    </section>
  );
}
