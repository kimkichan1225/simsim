"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityTab } from "@/components/activity/ActivityTab";
import { ChatButton } from "@/components/chat/ChatButton";
import { AppleGame } from "@/components/game/AppleGame";
import { OmokGame } from "@/components/game/OmokGame";
import { RummyGame } from "@/components/game/RummyGame";
import { SutdaGame } from "@/components/game/SutdaGame";
import { TetrisGame } from "@/components/game/TetrisGame";
import { LeaderboardTab } from "@/components/leaderboard/LeaderboardTab";
import { applySavedTabName } from "@/lib/tab-alert";
import { SheetShell, type SheetTab } from "./SheetShell";
import { WaitingRoomSheet } from "./WaitingRoomSheet";

const TABS: SheetTab[] = [
  { id: "waiting", label: "대기방" },
  { id: "tetris", label: "테트리스" },
  { id: "apple", label: "사과게임" },
  { id: "omok", label: "오목" },
  { id: "rummy", label: "루미큐브" },
  { id: "sutda", label: "섯다" },
  { id: "leaderboard", label: "점수판" },
  { id: "activity", label: "활동" },
];

type Props = {
  groupName: string;
  nickname: string;
  memberId: string;
  isOwner: boolean;
};

export function WorkspaceSheet({
  groupName,
  nickname,
  memberId,
  isOwner,
}: Props) {
  const router = useRouter();
  const [activeTabId, setActiveTabId] = useState(TABS[0].id);
  const [refreshKey] = useState(0);

  // 저장해둔 사용자 지정 탭 이름(브라우저별)을 적용
  useEffect(() => {
    applySavedTabName();
  }, []);

  // 게임 로비에서 30초 무입력 → 대기방 탭으로 자동 이동.
  // 탭 전환으로 게임 컴포넌트가 언마운트되면 SSE 구독이 끊겨 로비에서도 빠진다.
  const goWaiting = useCallback(() => {
    setActiveTabId("waiting");
  }, []);

  // 현재 시트(탭) 위치 보고 — 대기방 명단에 "누가 어디 있는지" 표시용.
  // 탭 전환 시 즉시 + 25초 하트비트(끊기면 서버 TTL로 명단에서 내려간다).
  useEffect(() => {
    const report = () => {
      void fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: activeTabId }),
      }).catch(() => undefined);
    };
    report();
    const id = setInterval(report, 25_000);
    return () => clearInterval(id);
  }, [activeTabId]);

  const onLeave = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  return (
    <SheetShell
      title={groupName || "제목 없는 스프레드시트"}
      tabs={TABS}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      onLeave={onLeave}
      chat={<ChatButton myMemberId={memberId} myNickname={nickname} />}
      rightUser={
        <div
          className="w-8 h-8 rounded-full bg-[var(--sheet-active)] text-white grid place-items-center text-[13px] font-medium ml-1"
          title={nickname}
        >
          {nickname.slice(0, 1).toUpperCase()}
        </div>
      }
    >
      {activeTabId === "waiting" && <WaitingRoomSheet />}
      {activeTabId === "tetris" && (
        <div className="px-6">
          <TetrisGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
      {activeTabId === "apple" && (
        <div className="px-6">
          <AppleGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
      {activeTabId === "omok" && (
        <div className="px-6">
          <OmokGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
      {activeTabId === "rummy" && (
        <div className="px-6">
          <RummyGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
      {activeTabId === "sutda" && (
        <div className="px-6">
          <SutdaGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
      {activeTabId === "leaderboard" && (
        <div className="p-6">
          <LeaderboardTab refreshKey={refreshKey} />
        </div>
      )}
      {activeTabId === "activity" && (
        <div className="p-6">
          <ActivityTab refreshKey={refreshKey} />
        </div>
      )}
    </SheetShell>
  );
}
