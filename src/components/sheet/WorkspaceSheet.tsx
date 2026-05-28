"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ActivityTab } from "@/components/activity/ActivityTab";
import { MultiplayerGame } from "@/components/game/MultiplayerGame";
import { LeaderboardTab } from "@/components/leaderboard/LeaderboardTab";
import { SheetShell, type SheetTab } from "./SheetShell";

const TABS: SheetTab[] = [
  { id: "match", label: "단어줍기" },
  { id: "leaderboard", label: "점수판" },
  { id: "activity", label: "활동" },
];

type Props = {
  groupName: string;
  nickname: string;
  memberId: string;
};

export function WorkspaceSheet({ groupName, nickname, memberId }: Props) {
  const router = useRouter();
  const [activeTabId, setActiveTabId] = useState(TABS[0].id);
  const [refreshKey] = useState(0);

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
          <MultiplayerGame myMemberId={memberId} myNickname={nickname} />
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
