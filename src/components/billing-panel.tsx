"use client";
import { useEffect, useState, useCallback } from "react";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
import { plans, type PlanId } from "@/lib/plans";
type Billing = {
  plan: PlanId;
  provider: string;
  environment: string;
  usage: { month: number; estimated_cost: number };
  subscription: {
    plan_id: PlanId;
    status: string;
    provider: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
  } | null;
  events: {
    id: string;
    provider: string;
    event_type: string;
    status: string;
    plan_id: string;
    amount_krw: number | null;
    created_at: string;
  }[];
};
export function BillingPanel() {
  const [data, setData] = useState<Billing | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [subscriptionId, setSubscriptionId] = useState("");
  const load = useCallback(async () => {
    try {
      const b = await api<Billing>("/api/billing");
      setData(b);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "청구 정보를 불러오지 못했습니다.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function change(plan: PlanId) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (
        data?.subscription?.status === "active" &&
        new Date(data.subscription.current_period_end) > new Date()
      ) {
        if (
          !confirm(
            "플랜을 변경할까요? 업그레이드는 차액이 즉시 청구될 수 있고, 다운그레이드는 즉시 적용되며 환불·크레딧이 없습니다. 기존 데이터와 이번 달 사용량은 유지됩니다.",
          )
        )
          return;
        await api("/api/billing/change", {
          method: "POST",
          body: JSON.stringify({ plan }),
        });
        setMessage(
          "제공자에서 확인된 플랜을 반영했습니다. 추가 결제가 완료되지 않았다면 기존 플랜이 유지됩니다.",
        );
      } else {
        const checkout = await api<{ url: string; mock: boolean }>(
          "/api/billing/checkout",
          { method: "POST", body: JSON.stringify({ plan }) },
        );
        if (checkout.mock) {
          if (
            !confirm(
              "개발용 mock 구독입니다. 실제 결제나 청구가 발생하지 않습니다. 테스트 플랜을 적용할까요?",
            )
          )
            return;
          await api("/api/billing/mock-confirm", {
            method: "POST",
            body: JSON.stringify({ plan }),
          });
          setMessage(
            "개발용 mock 플랜을 적용했습니다. 실제 매출에 포함하지 않습니다.",
          );
        } else {
          window.location.assign(checkout.url);
          return;
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "플랜 변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>현재 구독</h2>
        {!data && !error && (
          <p role="status" className="muted">
            청구 정보 조회 중…
          </p>
        )}
        {data && (
          <>
            <p className="muted">
              {data.environment} ·{" "}
              {data.provider === "mock"
                ? "개발용 mock · 실제 과금 없음"
                : data.provider}{" "}
              · 현재 플랜 <strong>{data.plan}</strong>
            </p>
            <div className="billing-summary">
              <div>
                <span>이번 달 생성</span>
                <strong>
                  {data.usage.month} / {plans[data.plan].limit}회
                </strong>
              </div>
              <div>
                <span>남은 횟수</span>
                <strong>
                  {Math.max(0, plans[data.plan].limit - data.usage.month)}회
                </strong>
              </div>
              <div>
                <span>
                  {data.subscription?.cancel_at_period_end
                    ? "이용 종료일"
                    : "다음 결제일"}
                </span>
                <strong>
                  {data.subscription
                    ? new Date(
                        data.subscription.current_period_end,
                      ).toLocaleDateString("ko-KR")
                    : "없음"}
                </strong>
              </div>
            </div>
            {data.subscription?.cancel_at_period_end && (
              <p className="info-banner">
                구독 취소 예약됨: 현재 기간이 끝나면 Free로 전환됩니다.
              </p>
            )}
            {data.subscription && !data.subscription.cancel_at_period_end && (
              <Button
                disabled={busy}
                variant="outline"
                onClick={async () => {
                  if (
                    !confirm(
                      "다음 결제를 취소할까요? 현재 결제 기간까지 이용할 수 있습니다.",
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api("/api/billing/cancel", { method: "POST" });
                    setMessage("구독 취소를 예약했습니다.");
                    await load();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "취소하지 못했습니다.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                다음 결제 취소
              </Button>
            )}
          </>
        )}
        {message && (
          <p role="status" className="info-banner">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="info-banner">
            {error}
          </p>
        )}
        <p className="small-note">
          성공 화면으로 돌아오는 것만으로 유료 권한을 부여하지 않습니다. 서명된
          웹훅과 제공자 조회 후 반영됩니다. 청구 정보가 늦으면 아래에서
          동기화하세요.
        </p>
        <label>
          내 Stripe 구독 ID
          <input
            placeholder="sub_…"
            maxLength={100}
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={busy || !subscriptionId.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await api("/api/billing/sync", {
                method: "POST",
                body: JSON.stringify({ subscription_id: subscriptionId }),
              });
              setMessage("내 구독을 조회해 동기화했습니다.");
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : "동기화 실패");
            } finally {
              setBusy(false);
            }
          }}
        >
          결제 내역 동기화
        </Button>
      </section>
      <div className="plan-comparison">
        {(Object.keys(plans) as PlanId[]).map((id) => (
          <article className="panel pricing-card" key={id}>
            <span className="badge">
              {data?.plan === id ? "현재 플랜" : id}
            </span>
            <h2>{plans[id].name}</h2>
            <strong className="price">
              ₩{plans[id].price.toLocaleString()}
              <small>/ 월</small>
            </strong>
            <ul>
              <li>월 AI 생성 {plans[id].limit.toLocaleString()}회</li>
              <li>브랜드 {plans[id].brands}개</li>
              <li>{plans[id].schedule ? "예약 발행 지원" : "직접 발행"}</li>
              <li>
                {plans[id].repurpose
                  ? "콘텐츠 재가공·고급 분석"
                  : "기본 콘텐츠 생성"}
              </li>
              {id === "AGENCY" && (
                <li>팀 확장을 위한 소유권 구조 (멤버 초대 미지원)</li>
              )}
            </ul>
            {id !== "FREE" && (
              <Button
                disabled={busy || data?.plan === id || !data}
                onClick={() => void change(id)}
              >
                {data?.plan === id ? "이용 중" : "플랜 선택"}
              </Button>
            )}
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>청구·구독 이벤트 내역</h2>
        <p className="muted">
          제공자 이벤트 기록입니다. 실제 영수증·세금계산서는 결제 제공자에서
          확인하세요.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>유형</th>
                <th>플랜</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {data?.events.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString("ko-KR")}</td>
                  <td>
                    {e.provider === "mock" ? "[개발용] " : ""}
                    {e.event_type}
                  </td>
                  <td>{e.plan_id ?? "—"}</td>
                  <td>{e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.events.length && (
            <p className="empty">아직 청구 기록이 없습니다.</p>
          )}
        </div>
      </section>
    </>
  );
}
