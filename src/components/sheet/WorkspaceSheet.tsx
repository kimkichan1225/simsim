"use client";

import { useCallback, useState } from "react";
import { ActivityTab } from "@/components/activity/ActivityTab";
import {
  TypingGame,
  type FinalResult,
} from "@/components/game/TypingGame";
import { LeaderboardTab } from "@/components/leaderboard/LeaderboardTab";
import { SheetShell, type SheetTab } from "./SheetShell";

const TABS: SheetTab[] = [
  { id: "typing", label: "타이핑" },
  { id: "leaderboard", label: "점수판" },
  { id: "activity", label: "활동" },
];

type Props = {
  groupName: string;
  nickname: string;
};

export function WorkspaceSheet({ groupName, nickname }: Props) {
  const [activeTabId, setActiveTabId] = useState(TABS[0].id);
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitStatus, setSubmitStatus] = useState<
    null | "saved" | "rejected" | "error"
  >(null);

  const onSubmitResult = useCallback(async (r: FinalResult) => {
    setSubmitStatus(null);
    if (!r.runId) {
      setSubmitStatus("error");
      return;
    }
    try {
      const res = await fetch("/api/game/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: r.runId,
          mode: r.mode,
          language: r.language,
          charsCorrect: r.charsCorrect,
          charsIncorrect: r.charsIncorrect,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setSubmitStatus(
          data?.error === "rejected" ? "rejected" : "error",
        );
        return;
      }
      setSubmitStatus("saved");
      setRefreshKey((k) => k + 1);
    } catch {
      setSubmitStatus("error");
    }
  }, []);

  return (
    <SheetShell
      title={groupName || "제목 없는 스프레드시트"}
      tabs={TABS}
      activeTabId={activeTabId}
      onTabChange={setActiveTabId}
      rightUser={
        <div
          className="w-8 h-8 rounded-full bg-[var(--sheet-active)] text-white grid place-items-center text-[13px] font-medium ml-1"
          title={nickname}
        >
          {nickname.slice(0, 1).toUpperCase()}
        </div>
      }
    >
      {activeTabId === "typing" && (
        <div className="px-6">
          <TypingGame onSubmitResult={onSubmitResult} />
          {submitStatus && (
            <div className="text-center pb-6 -mt-2 text-[12px]">
              {submitStatus === "saved" && (
                <span className="text-[var(--sheet-green)]">
                  점수가 저장됐어요.
                </span>
              )}
              {submitStatus === "rejected" && (
                <span className="text-[#d93025]">
                  점수가 비정상이라 저장되지 않았어요.
                </span>
              )}
              {submitStatus === "error" && (
                <span className="text-[#d93025]">
                  서버 오류로 저장 실패했어요.
                </span>
              )}
            </div>
          )}
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
