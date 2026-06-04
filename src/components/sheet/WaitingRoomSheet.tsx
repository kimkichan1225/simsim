"use client";

// 대기방 시트 — 대기방 탭에 있는 사람 명단만 스프레드시트 셀로 보여준다.
// 위장이 목적이므로 다른 어떤 탭보다 구글 시트처럼 보여야 한다:
// 열 머리글(A~)·행 번호·빈 셀 그리드 위에 닉네임만 데이터처럼 올린다.
// presence 는 /api/waiting/stream SSE 구독 = "지금 대기방 탭에 있는 사람".

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type WaitingMember = {
  memberId: string;
  nickname: string;
};

type WaitingEvent =
  | { type: "waiting"; members: WaitingMember[] }
  | { type: "group_destroyed" };

const COLS = 8;
const MIN_ROWS = 30;

export function WaitingRoomSheet() {
  const router = useRouter();
  const [members, setMembers] = useState<WaitingMember[]>([]);

  // 방 폭파 시: 세션 정리 후 입장 화면으로 돌아간다.
  const handleDestroyed = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  useEffect(() => {
    const es = new EventSource("/api/waiting/stream");
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const ev = JSON.parse(e.data) as WaitingEvent;
        if (ev.type === "group_destroyed") {
          es.close();
          void handleDestroyed();
          return;
        }
        if (ev.type === "waiting") setMembers(ev.members);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource 자동 재연결 */
    };
    return () => es.close();
  }, [handleDestroyed]);

  const colHeaders = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < COLS; i++) out.push(String.fromCharCode(65 + i));
    return out;
  }, []);
  const rowCount = Math.max(MIN_ROWS, members.length);
  const rowList = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => i + 1),
    [rowCount],
  );

  return (
    <div className="min-w-max">
      <div className="flex sticky top-0 z-10 bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div className="w-10 h-6 border-r border-[var(--sheet-cell-border)]" />
        {colHeaders.map((h) => (
          <div
            key={h}
            className="w-24 h-6 border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]"
          >
            {h}
          </div>
        ))}
      </div>
      {rowList.map((r) => {
        // A열에 명단을 1행부터 채운다 (그 외 셀은 빈칸)
        const value = members[r - 1]?.nickname ?? "";
        const isSelected = r === 1; // 구글 시트처럼 A1에 선택 테두리
        return (
          <div key={r} className="flex">
            <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-b border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
              {r}
            </div>
            {colHeaders.map((h, c) => (
              <div
                key={h + r}
                className={
                  "w-24 h-[22px] border-b border-r border-[var(--sheet-cell-border)] bg-white flex items-center px-1 text-[12px] text-[var(--sheet-fg)] " +
                  (isSelected && c === 0
                    ? "outline outline-2 -outline-offset-1 outline-[var(--sheet-active)]"
                    : "")
                }
              >
                {c === 0 ? <span className="truncate">{value}</span> : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
