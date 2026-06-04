"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityTab } from "@/components/activity/ActivityTab";
import { ChatButton } from "@/components/chat/ChatButton";
import { MultiplayerGame } from "@/components/game/MultiplayerGame";
import { TetrisGame } from "@/components/game/TetrisGame";
import { WaitingRoomCard } from "@/components/game/WaitingRoomCard";
import { LeaderboardTab } from "@/components/leaderboard/LeaderboardTab";
import { SheetShell, type SheetTab } from "./SheetShell";

const TABS: SheetTab[] = [
  { id: "match", label: "단어줍기" },
  { id: "tetris", label: "테트리스" },
  { id: "waiting", label: "대기방" },
  { id: "leaderboard", label: "점수판" },
  { id: "activity", label: "활동" },
];

const GAME_TITLES = { match: "단어줍기", tetris: "테트리스" } as const;

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
  // 자리비움으로 대기방에 이동된 경우, 어느 게임에서 왔는지 기억(복귀 버튼용)
  const [waitingFrom, setWaitingFrom] = useState<"match" | "tetris" | null>(
    null,
  );

  // 게임 로비에서 30초 무입력 → 대기방 탭으로 자동 이동.
  // 탭 전환으로 게임 컴포넌트가 언마운트되면 SSE 구독이 끊겨 로비에서도 빠진다.
  const goWaitingFromMatch = useCallback(() => {
    setWaitingFrom("match");
    setActiveTabId("waiting");
  }, []);
  const goWaitingFromTetris = useCallback(() => {
    setWaitingFrom("tetris");
    setActiveTabId("waiting");
  }, []);

  // 대기방에서 게임 탭으로 복귀(재구독 = 로비 재입장)
  const returnFromWaiting = useCallback((tabId: "match" | "tetris") => {
    setWaitingFrom(null);
    setActiveTabId(tabId);
  }, []);

  // 대기방이 아닌 탭으로 직접 이동하면 자리비움 기록을 비운다(다음 직접 방문 시 일반 안내 표시).
  const handleTabChange = useCallback((tabId: string) => {
    if (tabId !== "waiting") setWaitingFrom(null);
    setActiveTabId(tabId);
  }, []);

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
      onTabChange={handleTabChange}
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
      {activeTabId === "match" && (
        <div className="px-6">
          <MultiplayerGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaitingFromMatch}
          />
        </div>
      )}
      {activeTabId === "tetris" && (
        <div className="px-6">
          <TetrisGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaitingFromTetris}
          />
        </div>
      )}
      {activeTabId === "waiting" && (
        <div className="p-6">
          <WaitingRoomCard
            fromGameTitle={waitingFrom ? GAME_TITLES[waitingFrom] : null}
            fromTabId={waitingFrom}
            onReturn={returnFromWaiting}
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
