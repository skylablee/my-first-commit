"use client";
import { useState } from "react";
import { Dialog } from "radix-ui";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
import type { Content } from "@/lib/content";
export function ContentDetail({
  content,
  allowRepurpose = true,
  onClose,
  onSaved,
  onDeleted,
  onRepurpose,
  notify,
}: {
  content: Content;
  allowRepurpose?: boolean;
  onClose: () => void;
  onSaved: (content: Content) => void;
  onDeleted: (id: string) => void;
  onRepurpose: (content: Content) => void;
  notify: (message: string) => void;
}) {
  const [title, setTitle] = useState(content.title);
  const [body, setBody] = useState(content.body);
  const [busy, setBusy] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content
          className="modal panel dialog-content"
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <div className="section-title">
            <span className="badge">
              {content.status} · {content.channel}
            </span>
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={busy} aria-label="상세 닫기">
                닫기
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Title asChild>
            <h2>콘텐츠 상세</h2>
          </Dialog.Title>
          <Dialog.Description className="muted">
            저장한 초안을 편집하거나 다른 형식으로 재가공하세요.
          </Dialog.Description>
          <label>
            제목
            <input
              maxLength={300}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              readOnly={content.status !== "초안"}
            />
          </label>
          <label>
            본문
            <textarea
              rows={10}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={content.status !== "초안"}
            />
          </label>
          <p className="muted">{content.date}</p>
          {content.channel === "Threads" && content.status !== "발행됨" && (
            <section className="publish-controls">
              <p className="small-note">
                서버에 저장된 본문으로 게시합니다. 수정했다면 먼저 수정 저장을
                누르세요. 최대 500자. 예약 시간은 현재 기기 시간대 기준입니다.
              </p>
              <label>
                예약 시간
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </label>
              <div className="generation-actions">
                {[false, true].map((schedule) => (
                  <Button
                    key={String(schedule)}
                    variant="outline"
                    disabled={
                      busy ||
                      body !== content.body ||
                      title !== content.title ||
                      (schedule && !scheduledAt)
                    }
                    onClick={async () => {
                      if (
                        !confirm(
                          schedule
                            ? "Threads에 예약 발행할까요?"
                            : "Threads에 지금 실제로 게시할까요?",
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        const data = await api<{
                          outcomes: { status: string }[];
                        }>("/api/publications", {
                          method: "POST",
                          body: JSON.stringify({
                            content_id: content.id,
                            scheduled_at: schedule
                              ? new Date(scheduledAt).toISOString()
                              : null,
                          }),
                        });
                        notify(
                          schedule
                            ? "예약을 등록했습니다. 연동 관리에서 상태를 확인하세요."
                            : data.outcomes.some(
                                  (o) => o.status === "published",
                                )
                              ? "Threads 게시를 완료했습니다."
                              : "게시 결과를 연동 관리에서 확인해 주세요.",
                        );
                        onClose();
                      } catch (e) {
                        notify(
                          e instanceof Error ? e.message : "게시 요청 실패",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {schedule ? "예약 발행" : "지금 게시"}
                  </Button>
                ))}
              </div>
            </section>
          )}
          <div className="result-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("이 콘텐츠를 영구 삭제할까요?")) return;
                setBusy(true);
                try {
                  await api(`/api/contents?id=${content.id}`, {
                    method: "DELETE",
                  });
                  onDeleted(content.id);
                  onClose();
                  notify("삭제했습니다.");
                } catch (err) {
                  notify(err instanceof Error ? err.message : "삭제 실패");
                } finally {
                  setBusy(false);
                }
              }}
            >
              삭제
            </Button>
            <Button
              variant="outline"
              disabled={busy || !allowRepurpose}
              onClick={() => onRepurpose({ ...content, title, body })}
            >
              이 콘텐츠 재가공
            </Button>
            {content.status === "초안" && (
              <Button
                disabled={busy || !title.trim() || !body.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const data = await api<{ content: Content }>(
                      "/api/contents",
                      {
                        method: "PATCH",
                        body: JSON.stringify({
                          id: content.id,
                          brand_id: content.brand_id,
                          title,
                          body,
                          channel: content.channel,
                          source_type: content.source_type ?? "manual",
                          source_url: content.source_url ?? null,
                        }),
                      },
                    );
                    onSaved(data.content);
                    onClose();
                    notify("수정 사항을 저장했습니다.");
                  } catch (err) {
                    notify(err instanceof Error ? err.message : "저장 실패");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "처리 중…" : "수정 저장"}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
