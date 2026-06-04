"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityTab } from "@/components/activity/ActivityTab";
import { ChatButton } from "@/components/chat/ChatButton";
import { AppleGame } from "@/components/game/AppleGame";
import { MultiplayerGame } from "@/components/game/MultiplayerGame";
import { TetrisGame } from "@/components/game/TetrisGame";
import { LeaderboardTab } from "@/components/leaderboard/LeaderboardTab";
import { SheetShell, type SheetTab } from "./SheetShell";
import { WaitingRoomSheet } from "./WaitingRoomSheet";

const TABS: SheetTab[] = [
  { id: "waiting", label: "대기방" },
  { id: "match", label: "단어줍기" },
  { id: "tetris", label: "테트리스" },
  { id: "apple", label: "사과게임" },
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

  // 게임 로비에서 30초 무입력 → 대기방 탭으로 자동 이동.
  // 탭 전환으로 게임 컴포넌트가 언마운트되면 SSE 구독이 끊겨 로비에서도 빠진다.
  const goWaiting = useCallback(() => {
    setActiveTabId("waiting");
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
      {activeTabId === "match" && (
        <div className="px-6">
          <MultiplayerGame
            myMemberId={memberId}
            myNickname={nickname}
            isOwner={isOwner}
            onAway={goWaiting}
          />
        </div>
      )}
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
