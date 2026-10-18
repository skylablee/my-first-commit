"use client";
import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
import type { Checklist, StagingService } from "@/lib/staging/types";
export function StagingCheckPanel() {
  const [data, setData] = useState<Checklist | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [brand, setBrand] = useState(""),
    [account, setAccount] = useState(""),
    [provider, setProvider] = useState("openai"),
    [eventId, setEventId] = useState(""),
    [connected, setConnected] = useState(false),
    [cooldown, setCooldown] = useState(0);
  const load = useCallback(async () => {
    try {
      const d = await api<Checklist>("/api/admin/staging-check");
      setData(d);
      setBrand((prev) => prev || d.brands[0]?.id || "");
      setAccount((prev) => prev || d.accounts[0]?.user_id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "점검 상태 조회 실패");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((c) => Math.max(0, c - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function run(input: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const out = await api<{
        result?: { status: string; safe_message: string };
        pending?: boolean;
        message?: string;
        url?: string;
        mock?: boolean;
      }>("/api/admin/staging-check", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (out.url) {
        if (out.mock)
          throw new Error(
            "mock 결과를 실제 sandbox 성공으로 인정하지 않습니다.",
          );
        const link = new URL(out.url);
        if (
          link.protocol !== "https:" ||
          link.hostname !== "checkout.stripe.com"
        )
          throw new Error("검증되지 않은 결제 주소입니다.");
        window.location.assign(out.url);
        return;
      }
      setMessage(
        out.result
          ? `${out.result.status}: ${out.result.safe_message}`
          : (out.message ?? "요청 완료"),
      );
      await load();
      if (input.action === "quota-generate") setCooldown(11);
    } catch (e) {
      setError(e instanceof Error ? e.message : "테스트 실패");
    } finally {
      setBusy(false);
    }
  }
  async function connectThreads() {
    if (
      !confirm(
        "Meta OAuth로 Threads 계정을 연결합니다. 아직 게시하지 않습니다.",
      )
    )
      return;
    setBusy(true);
    try {
      const out = await api<{ url: string }>("/api/threads/connect", {
        method: "POST",
      });
      window.location.assign(out.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OAuth 연결 실패");
      setBusy(false);
    }
  }
  const disabled = busy || !data?.enabled;
  return (
    <main className="admin-page staging-page">
      <div className="section-title">
        <h1>Staging 연결 검증</h1>
        <Button asChild variant="outline">
          <Link href="/admin">운영 관리</Link>
        </Button>
      </div>
      <p className="muted">
        관리자 전용 · {data?.environment ?? "조회 중"} · Secret
        값·토큰·비밀번호·외부 응답 body는 결과에 저장하거나 표시하지 않습니다.
      </p>
      <div className="info-banner">
        실제 호출 증거가 있는 항목만 PASS입니다. Configured는 연결 성공이
        아닙니다. Threads는 공개 테스트 문구만 게시하며, 결제는 Stripe test
        모드만 허용합니다. production에서는 모든 테스트 실행을 차단합니다.
      </div>
      {error && (
        <p role="alert" className="info-banner">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="info-banner">
          {message}
        </p>
      )}
      {!data && !error && <p role="status">상태 확인 중…</p>}
      {data && (
        <>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            상태·최근 결과 새로고침
          </Button>
          {!data.enabled && (
            <p className="info-banner">
              staging 환경이 아니거나 테스트 실행이 활성화되지 않았습니다. 운영
              상태 조회만 가능합니다.
            </p>
          )}
          <div className="staging-services">
            {data.services.map((service) => (
              <article className="panel" key={service.name}>
                <h2>{service.name}</h2>
                <span
                  className={`badge ${service.state === "Connection success" ? "green" : ""}`}
                >
                  {service.state}
                </span>
                {service.missing.length > 0 && (
                  <p className="small-note">
                    미설정: {service.missing.join(", ")}
                  </p>
                )}
                <p className="small-note">
                  {service.name === "OpenAI" || service.name === "Gemini"
                    ? "최소 토큰의 실제 유료 API 요청입니다. 작은 사용 요금과 생성 횟수가 발생할 수 있습니다."
                    : service.name === "Cron"
                      ? "인증 probe만 실행합니다. 큐를 발행하지 않으며 scheduler 실행 성공과 구분합니다."
                      : "실제 읽기 요청을 실행하며 구성 여부와 구분합니다."}
                </p>
                <Button
                  disabled={disabled || service.missing.length > 0}
                  variant="outline"
                  onClick={() => {
                    if (
                      (service.name === "OpenAI" ||
                        service.name === "Gemini") &&
                      !confirm(
                        "최소 토큰의 실제 AI 요청과 사용량 기록을 실행할까요?",
                      )
                    )
                      return;
                    void run({
                      action: "connect",
                      service: service.name as StagingService,
                    });
                  }}
                >
                  {service.name} 실제 연결 테스트
                </Button>
                {service.last && (
                  <>
                    <p className="small-note">
                      최근: {service.last.status} · {service.last.safe_message}
                    </p>
                    <p className="small-note">
                      지연 {service.last.latency_ms ?? "—"}ms · 요청 ID{" "}
                      {service.last.request_id}
                    </p>
                    <pre className="staging-details">
                      {JSON.stringify(service.last.details, null, 2)}
                    </pre>
                  </>
                )}
              </article>
            ))}
          </div>
          <section className="panel">
            <h2>1. 전용 계정 · 실제 Auth / CRUD / RLS / 재로그인</h2>
            <p className="muted">
              본인 소유의 새 테스트 이메일 두 개를 사용하세요. 일반 계정·현재
              관리자 계정은 fixture로 쓰지 않습니다. 이메일 확인이나 CAPTCHA가
              필요하면 직접 가입/확인 단계를 완료한 뒤 재실행하세요. 관리자
              로그인 쿠키는 바꾸지 않습니다. 비밀번호는 저장하지 않습니다.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  !confirm(
                    "전용 테스트 계정 생성과 fixture CRUD·로그아웃/재로그인을 실행할까요?",
                  )
                )
                  return;
                const form = new FormData(e.currentTarget);
                await run({
                  action: "accounts",
                  confirm: true,
                  email_a: form.get("email_a"),
                  email_b: form.get("email_b"),
                  password_a: form.get("password_a"),
                  password_b: form.get("password_b"),
                });
                (e.target as HTMLFormElement).reset();
              }}
            >
              <div className="form-grid">
                {(["a", "b"] as const).map((label) => (
                  <div key={label}>
                    <label>
                      테스트 계정 {label.toUpperCase()} 이메일
                      <input
                        required
                        name={`email_${label}`}
                        type="email"
                        autoComplete="off"
                        maxLength={254}
                      />
                    </label>
                    <label>
                      테스트 계정 {label.toUpperCase()} 비밀번호
                      <input
                        required
                        name={`password_${label}`}
                        type="password"
                        autoComplete="new-password"
                        minLength={12}
                        maxLength={128}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <Button type="submit" disabled={disabled}>
                실제 가입·로그인·CRUD·RLS 검증
              </Button>
            </form>
            <p className="small-note">
              등록된 전용 계정:{" "}
              {data.accounts
                .map((a) => `${a.label}: ${a.user_id}`)
                .join(" / ") || "없음"}
              . 테스트 계정과 마지막 보존용 fixture는 자동 삭제하지 않습니다.
            </p>
          </section>
          <section className="panel">
            <h2>2. Threads OAuth → 암호화 → 공개 테스트 게시</h2>
            <p className="muted">
              게시문: “BizContent AI staging connection test”. 공식 삭제 API
              지원을 확인하지 못해 자동 삭제 옵션을 제공하지 않습니다.
            </p>
            <Button disabled={disabled} onClick={() => void connectThreads()}>
              Connect Threads · Meta OAuth
            </Button>
            <label className="confirmation-check">
              <input
                type="checkbox"
                checked={connected}
                onChange={(e) => setConnected(e.target.checked)}
              />
              선택한 Threads 계정에 테스트 문구를 공개 게시하는 것을
              확인했습니다.
            </label>
            <label>
              관리자 테스트 브랜드
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">브랜드 선택</option>
                {data.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.brand_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="generation-actions">
              <Button
                disabled={disabled || !brand || !connected}
                onClick={() => {
                  if (confirm("Threads에 테스트 문구를 지금 실제 게시할까요?"))
                    void run({
                      action: "threads",
                      brand_id: brand,
                      scheduled: false,
                      confirmation: "PUBLISH_STAGING_TEST",
                    });
                }}
              >
                테스트 문구 지금 게시
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !brand || !connected}
                onClick={() => {
                  if (
                    confirm(
                      "현재 시각 +5분에 테스트 문구를 실제 예약 발행할까요? 테스트 계정은 Starter 이상이어야 합니다.",
                    )
                  )
                    void run({
                      action: "threads",
                      brand_id: brand,
                      scheduled: true,
                      confirmation: "PUBLISH_STAGING_TEST",
                    });
                }}
              >
                +5분 예약 테스트
              </Button>
            </div>
            <p className="small-note">
              예약 등록은 PASS가 아닙니다. 5분 후 Cron 실행을 기다린 뒤 결과를
              관찰하세요. 상태 전이·게시 ID·username·시간·재시도 횟수를
              검사합니다.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>작업</th>
                    <th>상태</th>
                    <th>계정·게시 ID</th>
                    <th>예약/게시 시간</th>
                    <th>검증</th>
                  </tr>
                </thead>
                <tbody>
                  {data.publications.map((p) => (
                    <tr key={p.id}>
                      <td>{p.id.slice(0, 8)}</td>
                      <td>
                        {p.status}
                        {p.uncertain ? " 결과 불명" : ""} · 재시도{" "}
                        {p.retry_count}
                      </td>
                      <td>
                        {p.username ?? "—"} / {p.provider_post_id ?? "—"}
                      </td>
                      <td>{p.published_at ?? p.scheduled_at ?? "즉시"}</td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            void run({
                              action: "threads-observe",
                              publication_id: p.id,
                            })
                          }
                        >
                          실제 결과 관찰
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>3. FREE 임시 3회 → 4회 차단 → 테스트 업그레이드</h2>
            <p className="muted">
              사용량이 0인 전용 FREE 계정만 가능합니다. 전역 plans 테이블과 기존
              카운터는 초기화하지 않습니다. 임시 한도는 20분 후 자동 무효화되며
              직접 복원할 수 있습니다.
            </p>
            <label>
              전용 계정
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">선택</option>
                {data.accounts.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.label} · {a.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              실제 AI 제공자
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
            <div className="generation-actions">
              <Button
                variant="outline"
                disabled={disabled || !account}
                onClick={() =>
                  void run({
                    action: "limit-enable",
                    user_id: account,
                    provider,
                  })
                }
              >
                임시 한도 3회 설정
              </Button>
              <Button
                disabled={disabled || !account || cooldown > 0}
                onClick={() => {
                  if (
                    confirm(
                      "전용 계정으로 최소 AI 생성을 한 번 실행할까요? 실제 호출 비용이 발생할 수 있습니다.",
                    )
                  )
                    void run({
                      action: "quota-generate",
                      user_id: account,
                      provider,
                    });
                }}
              >
                {cooldown
                  ? `${cooldown}초 후 가능`
                  : "한 번 생성 / 4번째 차단 확인"}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !account}
                onClick={() =>
                  void run({
                    action: "limit-restore",
                    user_id: account,
                    provider,
                  })
                }
              >
                원래 한도 복원
              </Button>
            </div>
            <p className="small-note">
              3회 성공·4번째 차단 기록을 확인한 후 아래에서 같은 전용 계정의
              Stripe 테스트 플랜을 업그레이드하고 다시 생성하세요. 복원 전 임시
              한도:{" "}
              {data.overrides
                .map((o) => `${o.user_id.slice(0, 8)} (${o.expires_at}까지)`)
                .join(", ") || "없음"}
            </p>
          </section>
          <section className="panel">
            <h2>4. Stripe sandbox 결제 시나리오</h2>
            <p className="muted">
              실제 금액을 청구하지 않습니다. sk_test_ 키만 허용합니다. 테스트
              카드 입력은 Stripe Checkout에서만 진행하세요. 성공/실패 이벤트는
              실제 웹훅 수신 후 검증합니다. mock 성공을 실제 PASS로 바꾸지
              않습니다.
            </p>
            <label>
              결제 테스트 대상
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">현재 관리자 테스트 계정</option>
                {data.accounts.map((a) => (
                  <option key={a.user_id} value={a.user_id}>
                    {a.label} · {a.user_id}
                  </option>
                ))}
              </select>
            </label>
            <div className="generation-actions">
              {[
                {
                  a: "billing-checkout",
                  label: "FREE → STARTER 테스트 Checkout",
                },
                { a: "billing-sync", label: "실제 결제·DB·한도 확인" },
                { a: "billing-failure", label: "실패 결제 웹훅 확인" },
                { a: "billing-upgrade-pro", label: "PRO 테스트 업그레이드" },
                { a: "billing-downgrade", label: "STARTER 다운그레이드 검사" },
                { a: "billing-cancel", label: "테스트 구독 취소 예약" },
              ].map((item) => (
                <Button
                  key={item.a}
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    if (
                      confirm(
                        "Stripe test 모드의 전용 테스트 계정에 실행합니다. 실제 결제 키는 차단합니다. 계속할까요?",
                      )
                    )
                      void run({
                        action: item.a,
                        confirmation: "SANDBOX_ONLY",
                        ...(account ? { user_id: account } : {}),
                      });
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <label>
              동일 이벤트 재전송 검증용 Stripe event ID
              <input
                value={eventId}
                maxLength={200}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="evt_… (Stripe Dashboard에서 재전송 후 입력)"
              />
            </label>
            <Button
              variant="outline"
              disabled={disabled || !eventId.trim()}
              onClick={() =>
                void run({
                  action: "billing-duplicate",
                  confirmation: "SANDBOX_ONLY",
                  event_id: eventId,
                  ...(account ? { user_id: account } : {}),
                })
              }
            >
              실제 중복 웹훅 증거 확인
            </Button>
          </section>
          <section className="panel">
            <h2>검증 결과 · PASS / FAIL / NOT CONFIGURED</h2>
            <p className="muted">
              실행하지 않은 시나리오는 PASS로 간주하지 않습니다. 읽기 연결
              성공과 전체 E2E 성공은 별개입니다.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>서비스·시나리오</th>
                    <th>판정</th>
                    <th>안전한 결과</th>
                    <th>요청 ID</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((r, i) => (
                    <tr key={r.id ?? i}>
                      <td>
                        {r.service} / {r.test_name}
                      </td>
                      <td>
                        <span
                          className={`badge ${r.status === "PASS" ? "green" : ""}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td>{r.safe_message}</td>
                      <td>{r.request_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.results.length && (
                <p className="empty">
                  실제 실행 기록이 없습니다. 전체 E2E는 미검증입니다.
                </p>
              )}
            </div>
          </section>
          <section className="panel">
            <h2>최근 50개 오류</h2>
            <div className="admin-events">
              {data.errors.map((e, i) => (
                <pre key={i}>{JSON.stringify(e, null, 2)}</pre>
              ))}
            </div>
            {!data.errors.length && <p className="empty">기록 없음</p>}
          </section>
        </>
      )}
    </main>
  );
}
