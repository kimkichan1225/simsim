"use client";

// 대기방 시트 콘텐츠 — 게임 로비에서 30초간 준비 입력이 없으면 이 탭으로 자동 이동된다.
// 탭이 바뀌면 게임 SSE 구독이 끊겨 로비에서도 빠지므로 다른 사람들의 시작을 막지 않는다.
// 버튼을 누르면 원래 게임 탭으로 복귀(재구독 = 로비 재입장)한다.

type Props = {
  // 어느 게임에서 이동됐는지 (직접 탭을 누른 경우 null)
  fromGameTitle: string | null;
  onReturn: (tabId: "match" | "tetris") => void;
  fromTabId: "match" | "tetris" | null;
};

export function WaitingRoomCard({ fromGameTitle, fromTabId, onReturn }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 p-8 border border-[var(--sheet-cell-border)] bg-white w-full max-w-md mx-auto">
      <div className="text-[32px]">💤</div>
      <div className="text-[16px] font-medium text-[var(--sheet-fg)]">대기방</div>
      {fromGameTitle && fromTabId ? (
        <>
          <p className="text-[13px] text-[var(--sheet-muted)] text-center leading-relaxed">
            30초 동안 준비하지 않아 대기방으로 이동했어요.
            <br />
            대기방에 있는 동안에는 {fromGameTitle} 시작을 막지 않아요.
          </p>
          <button
            type="button"
            onClick={() => onReturn(fromTabId)}
            className="w-full max-w-[260px] px-5 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[15px] font-medium hover:brightness-95"
          >
            {fromGameTitle} 로비로 돌아가기
          </button>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--sheet-muted)] text-center leading-relaxed">
            게임 로비에서 30초 동안 준비하지 않으면 이곳으로 이동돼요.
            <br />
            대기방에 있는 동안에는 게임 시작을 막지 않아요.
          </p>
          <div className="flex gap-2 w-full max-w-[260px]">
            <button
              type="button"
              onClick={() => onReturn("match")}
              className="flex-1 px-4 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium hover:brightness-95"
            >
              단어줍기
            </button>
            <button
              type="button"
              onClick={() => onReturn("tetris")}
              className="flex-1 px-4 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium hover:brightness-95"
            >
              테트리스
            </button>
          </div>
        </>
      )}
    </div>
  );
}
