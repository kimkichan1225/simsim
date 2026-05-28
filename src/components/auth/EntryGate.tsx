"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "create" | "join";

export function EntryGate() {
  const router = useRouter();
  const search = useSearchParams();
  const inviteFromUrl = search.get("invite") ?? "";

  const [mode, setMode] = useState<Mode>(inviteFromUrl ? "join" : "create");
  const [groupName, setGroupName] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState(inviteFromUrl);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url =
        mode === "create" ? "/api/group/create" : "/api/group/join";
      const body =
        mode === "create"
          ? { groupName, nickname }
          : { inviteCode, nickname };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(translateError(data?.error));
        return;
      }
      router.refresh();
    } catch {
      setError("연결에 실패했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 bg-black/30 grid place-items-center">
      <div className="w-[440px] bg-white rounded-lg shadow-xl border border-[var(--sheet-border)] overflow-hidden">
        <div className="px-6 pt-5 pb-3 border-b border-[var(--sheet-border)]">
          <h1 className="text-[18px] font-medium text-[var(--sheet-fg)]">
            스프레드시트 시작
          </h1>
          <p className="text-[13px] text-[var(--sheet-muted)] mt-1">
            새 시트를 만들거나 기존 시트 코드로 입장하세요.
          </p>
        </div>

        <div className="flex border-b border-[var(--sheet-border)]">
          <button
            type="button"
            onClick={() => setMode("create")}
            className={
              mode === "create"
                ? "flex-1 py-2 text-[13px] font-medium border-b-2 border-[var(--sheet-active)] text-[var(--sheet-active)]"
                : "flex-1 py-2 text-[13px] text-[var(--sheet-muted)] hover:bg-black/5"
            }
          >
            새로 만들기
          </button>
          <button
            type="button"
            onClick={() => setMode("join")}
            className={
              mode === "join"
                ? "flex-1 py-2 text-[13px] font-medium border-b-2 border-[var(--sheet-active)] text-[var(--sheet-active)]"
                : "flex-1 py-2 text-[13px] text-[var(--sheet-muted)] hover:bg-black/5"
            }
          >
            코드로 입장
          </button>
        </div>

        <form onSubmit={onSubmit} className="px-6 py-5 flex flex-col gap-3">
          {mode === "create" ? (
            <Field
              label="시트 이름"
              value={groupName}
              onChange={setGroupName}
              placeholder="예: 회의록 2026"
              maxLength={40}
              required
            />
          ) : (
            <Field
              label="시트 코드"
              value={inviteCode}
              onChange={(v) => setInviteCode(v.toUpperCase())}
              placeholder="ABCDE12345"
              maxLength={20}
              required
              mono
            />
          )}
          <Field
            label="표시 이름"
            value={nickname}
            onChange={setNickname}
            placeholder="예: 김민수"
            maxLength={20}
            required
          />

          {error && (
            <div className="text-[13px] text-[#d93025] -mt-1">{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium disabled:opacity-60"
          >
            {submitting
              ? "처리 중..."
              : mode === "create"
                ? "만들기"
                : "입장"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  required,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--sheet-muted)]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        className={
          (mono
            ? "font-mono tracking-widest "
            : "") +
          "border border-[var(--sheet-border)] rounded px-3 py-2 text-[14px] focus:outline-none focus:border-[var(--sheet-active)]"
        }
      />
    </label>
  );
}

function translateError(code: string | undefined): string {
  switch (code) {
    case "invalid_input":
      return "입력값을 확인해주세요.";
    case "invalid_nickname":
      return "표시 이름에 사용할 수 없는 문자가 포함됐어요. 한글/영문/숫자 위주로 입력해주세요.";
    case "invalid_code":
      return "시트 코드가 올바르지 않아요.";
    case "nickname_taken":
      return "그 표시 이름은 이미 사용 중이에요. 다른 이름을 시도해주세요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    case "server_misconfigured":
      return "서버가 일시적으로 동작하지 않아요. 잠시 후 다시 시도해주세요.";
    default:
      return "문제가 생겼어요. 잠시 후 다시 시도해주세요.";
  }
}
