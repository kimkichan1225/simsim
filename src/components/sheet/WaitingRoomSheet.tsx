"use client";

// 대기방 시트 — 그룹 접속자 전원과 각자 현재 어느 시트(탭)에 있는지 보여준다.
// 위장이 목적이므로 다른 어떤 탭보다 구글 시트처럼 보여야 한다:
// 열 머리글(A~)·행 번호·빈 셀 그리드 위에 닉네임·위치만 데이터처럼 올린다.
// 위치는 각 클라이언트가 /api/presence로 보고하고 /api/waiting/stream SSE로 받는다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type WaitingMember = {
  memberId: string;
  nickname: string;
  location: string;
};

// 탭 ID → 표시 라벨. 모르는 값(새 게임 등)은 "이동 중"으로 둔다.
const LOCATION_LABEL: Record<string, string> = {
  waiting: "대기방",
  match: "단어줍기",
  tetris: "테트리스",
  apple: "사과게임",
  suika: "수박게임",
  leaderboard: "점수판",
  activity: "활동",
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
        // A열 닉네임, B열 현재 시트 위치 (그 외 셀은 빈칸)
        const member = members[r - 1];
        const nickname = member?.nickname ?? "";
        const location = member
          ? (LOCATION_LABEL[member.location] ?? "이동 중")
          : "";
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
                  "w-24 h-[22px] border-b border-r border-[var(--sheet-cell-border)] bg-white flex items-center px-1 text-[12px] " +
                  (c === 1
                    ? "text-[var(--sheet-muted)] "
                    : "text-[var(--sheet-fg)] ") +
                  (isSelected && c === 0
                    ? "outline outline-2 -outline-offset-1 outline-[var(--sheet-active)]"
                    : "")
                }
              >
                {c === 0 ? (
                  <span className="truncate">{nickname}</span>
                ) : c === 1 ? (
                  <span className="truncate">{location}</span>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
