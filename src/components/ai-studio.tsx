"use client";
import { useState } from "react";
import { Sparkles, Check, Plus, WandSparkles, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { api } from "@/lib/client-api";
import {
  platforms,
  platformCodes,
  type Generated,
  type RepurposeBundle,
} from "@/lib/contracts";
import type { Brand, Content } from "@/lib/content";
type Draft = {
  title: string;
  body: string;
  channel: (typeof platforms)[number];
  id?: string;
  saved: boolean;
};
export type StudioSource = {
  title: string;
  body: string;
  url: string | null;
  type: "manual" | "news" | "repurpose";
};
export function AIStudio({
  brand,
  provider,
  allowRepurpose = true,
  source,
  onSaved,
  onDeleted,
  notify,
}: {
  brand: Brand;
  provider: "openai" | "gemini";
  allowRepurpose?: boolean;
  source: StudioSource;
  onSaved: (content: Content) => void;
  onDeleted: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [topic, setTopic] = useState(source.title);
  const [channel, setChannel] =
    useState<(typeof platforms)[number]>("인스타그램");
  const [tone, setTone] = useState(brand.voice || "따뜻하고 친근한");
  const [length, setLength] = useState("보통");
  const [original, setOriginal] = useState(source.body.slice(0, 10000));
  const [mode, setMode] = useState("single");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");
  async function generate(all = false) {
    if (busy) return;
    if (!brand.id) {
      setError("먼저 브랜드 브레인에서 브랜드를 저장하고 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{
        result: Generated | RepurposeBundle;
        bundle: boolean;
      }>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          provider,
          brand_id: brand.id,
          topic,
          platform: channel,
          tone,
          length,
          mode: all ? "all" : mode,
          source: original,
          source_url: source.url,
        }),
      });
      if (data.bundle) {
        const b = data.result as RepurposeBundle;
        setDrafts([
          {
            title: `${topic.slice(0, 270)} · Threads 3개`,
            body: b.threads.map((v, i) => `${i + 1}. ${v}`).join("\n\n"),
            channel: "Threads",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · Instagram`,
            body: b.instagram,
            channel: "인스타그램",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · 캐러셀 8장`,
            body: b.carousel
              .map((v, i) => `${i + 1}. ${v.title}\n${v.body}`)
              .join("\n\n"),
            channel: "인스타그램 캐러셀",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · 블로그`,
            body: b.blog,
            channel: "네이버 블로그",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · 숏폼`,
            body: b.shorts,
            channel: "숏폼 스크립트",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · 후킹 문구 5개`,
            body: b.hooks.map((v, i) => `${i + 1}. ${v}`).join("\n"),
            channel: "후킹 문구",
            saved: false,
          },
          {
            title: `${topic.slice(0, 270)} · 해시태그 10개`,
            body: b.hashtags.join(" "),
            channel: "해시태그",
            saved: false,
          },
        ]);
      } else {
        const g = data.result as Generated;
        setDrafts([
          {
            title: g.title,
            body: `${g.body}\n\n${g.hashtags.join(" ")}`.trim(),
            channel:
              mode === "single"
                ? channel
                : (platforms[
                    platformCodes.indexOf(
                      mode as (typeof platformCodes)[number],
                    )
                  ] ?? channel),
            saved: false,
          },
        ]);
      }
      notify("AI 콘텐츠를 생성했습니다. 사실관계를 확인한 후 저장해 주세요.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }
  async function save(index: number) {
    const draft = drafts[index];
    if (saving !== null || !brand.id) return;
    setSaving(index);
    try {
      const data = await api<{ content: Content }>("/api/contents", {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...(draft.id ? { id: draft.id } : {}),
          brand_id: brand.id,
          title: draft.title,
          body: draft.body,
          channel: draft.channel,
          source_type:
            mode !== "single" || source.type === "repurpose"
              ? "repurpose"
              : source.type,
          source_url: source.url,
        }),
      });
      setDrafts((prev) =>
        prev.map((d, i) =>
          i === index ? { ...d, id: data.content.id, saved: true } : d,
        ),
      );
      onSaved(data.content);
      notify("콘텐츠 초안을 DB에 저장했습니다.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(null);
    }
  }
  function edit(index: number, field: "title" | "body", value: string) {
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index ? { ...d, [field]: value, saved: false } : d,
      ),
    );
  }
  async function remove(index: number) {
    const draft = drafts[index];
    if (
      !window.confirm(
        draft.id
          ? "저장된 콘텐츠도 DB에서 삭제할까요?"
          : "생성된 초안을 삭제할까요?",
      )
    )
      return;
    setSaving(index);
    try {
      if (draft.id) {
        await api(`/api/contents?id=${draft.id}`, { method: "DELETE" });
        onDeleted(draft.id);
      }
      setDrafts((prev) => prev.filter((_, i) => i !== index));
      notify("콘텐츠를 삭제했습니다.");
    } catch (err) {
      notify(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setSaving(null);
    }
  }
  return (
    <div className="studio-grid">
      <section className="panel">
        <h2>
          <Sparkles size={19} />
          콘텐츠 설정
        </h2>
        <p className="muted">
          제공자: {provider === "openai" ? "OpenAI" : "Gemini"} · 설정에서
          변경할 수 있어요.
        </p>
        {!brand.id && (
          <div className="info-banner">
            먼저 브랜드 브레인에서 브랜드를 저장해 주세요.
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              drafts.some((d) => !d.saved) &&
              !window.confirm("저장하지 않은 초안을 새 결과로 바꿀까요?")
            )
              return;
            void generate();
          }}
        >
          <label>
            게시할 채널
            <select
              value={channel}
              onChange={(e) =>
                setChannel(e.target.value as (typeof platforms)[number])
              }
            >
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            어떤 이야기를 전하고 싶으세요?
            <textarea
              required
              maxLength={300}
              rows={4}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              말투
              <input
                required
                maxLength={150}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              />
            </label>
            <label>
              분량
              <select
                value={length}
                onChange={(e) => setLength(e.target.value)}
              >
                {["짧게", "보통", "길게"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            참고 원문 / 재가공할 콘텐츠
            <textarea
              rows={4}
              maxLength={10000}
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
            />
          </label>
          {source.url && (
            <p className="small-note">
              출처:{" "}
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                원문 보기 ↗
              </a>
            </p>
          )}
          <label>
            생성 형식
            <select
              disabled={!allowRepurpose}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="single">일반 콘텐츠</option>
              <option value="threads">Threads 3개</option>
              <option value="instagram">Instagram caption</option>
              <option value="carousel">Instagram carousel 8 slides</option>
              <option value="naver_blog">Blog article</option>
              <option value="shorts">Short-form script</option>
              <option value="hooks">5 hooks</option>
              <option value="hashtags">10 hashtags</option>
            </select>
          </label>
          <div className="generation-actions">
            <Button
              disabled={busy || saving !== null || !brand.id || !topic.trim()}
              type="submit"
            >
              <WandSparkles size={16} />
              {busy
                ? "AI 생성 중…"
                : drafts.length
                  ? "다시 생성"
                  : "AI 초안 생성"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                busy ||
                saving !== null ||
                !brand.id ||
                !topic.trim() ||
                !original.trim() ||
                !allowRepurpose
              }
              onClick={() => {
                if (
                  drafts.some((d) => !d.saved) &&
                  !window.confirm("저장하지 않은 초안을 새 결과로 바꿀까요?")
                )
                  return;
                void generate(true);
              }}
            >
              {allowRepurpose ? "모두 생성" : "모두 생성 · Pro 이상"}
            </Button>
          </div>
        </form>
        <p className="small-note">
          모두 생성은 7가지 형식을 한 번의 API 요청으로 생성합니다. 실패·시간
          초과에도 제공자 요금이 발생할 수 있습니다. 자동 재시도는 하지
          않습니다. 플랜별 월 생성 한도와 10초 요청 간격 제한이 적용됩니다.
          브랜드와 참고 원문은 선택한 AI 제공자에게 전송됩니다.
        </p>
        {error && (
          <p role="alert" className="info-banner">
            {error}
          </p>
        )}
      </section>
      <section className="panel result-panel">
        <h2>콘텐츠 미리보기</h2>
        {busy && (
          <p role="status" className="muted">
            콘텐츠를 생성하고 있습니다. 최대 45초 정도 걸릴 수 있어요.
          </p>
        )}
        {!drafts.length && !busy && (
          <div className="output-empty">
            <Sparkles size={30} />
            <h3>우리 가게의 다음 이야기가 시작되는 곳</h3>
            <p>
              주제를 입력해 실제 AI 초안을 만들어 보세요.
              <br />
              키가 없으면 설정 안내를 표시합니다.
            </p>
          </div>
        )}
        {drafts.map((draft, i) => (
          <article className="generated-draft" key={i}>
            <span className="badge">{draft.channel}</span>
            <label>
              콘텐츠 제목
              <input
                aria-label={`콘텐츠 제목 ${i + 1}`}
                value={draft.title}
                maxLength={300}
                onChange={(e) => edit(i, "title", e.target.value)}
              />
            </label>
            <label>
              생성된 콘텐츠 편집
              <textarea
                aria-label={`생성된 콘텐츠 편집 ${i + 1}`}
                className="output"
                value={draft.body}
                maxLength={20000}
                onChange={(e) => edit(i, "body", e.target.value)}
              />
            </label>
            <div className="result-actions">
              <Button
                variant="outline"
                disabled={saving !== null || busy}
                onClick={() => void remove(i)}
              >
                <Trash2 size={15} />
                삭제
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(draft.body);
                    notify("복사했습니다.");
                  } catch {
                    notify(
                      "복사하지 못했습니다. 텍스트를 선택해 복사해 주세요.",
                    );
                  }
                }}
              >
                복사
              </Button>
              <Button
                disabled={
                  draft.saved ||
                  saving !== null ||
                  busy ||
                  !draft.body.trim() ||
                  !draft.title.trim()
                }
                onClick={() => void save(i)}
              >
                {draft.saved ? <Check size={16} /> : <Plus size={16} />}
                {saving === i
                  ? "저장 중…"
                  : draft.saved
                    ? "저장 완료"
                    : "초안 저장"}
              </Button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
