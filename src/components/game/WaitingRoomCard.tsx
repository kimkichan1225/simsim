"use client";

// 자리비움 대기방 — 로비에서 30초간 준비 입력이 없으면 이동되는 독립 화면.
// 대기방에 있는 동안에는 게임 시작 조건에서 제외되어 다른 사람들의 시작을 막지 않는다.
// 버튼을 누르면 즉시 로비로 복귀한다(서버 ready API가 자리비움을 해제).

type Props = {
  gameTitle: string; // "단어줍기" | "테트리스"
  onReturn: () => void;
};

export function WaitingRoomCard({ gameTitle, onReturn }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 p-8 border border-[var(--sheet-cell-border)] bg-white w-full max-w-md mx-auto">
      <div className="text-[32px]">💤</div>
      <div className="text-[16px] font-medium text-[var(--sheet-fg)]">대기방</div>
      <p className="text-[13px] text-[var(--sheet-muted)] text-center leading-relaxed">
        30초 동안 준비하지 않아 대기방으로 이동했어요.
        <br />
        대기방에 있는 동안에는 {gameTitle} 시작을 막지 않아요.
      </p>
      <button
        type="button"
        onClick={onReturn}
        className="w-full max-w-[260px] px-5 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[15px] font-medium hover:brightness-95"
      >
        로비로 돌아가기
      </button>
    </div>
  );
}
