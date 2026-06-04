"use client";

// 게임 시작 전 대기실 카드 — 단어줍기/테트리스 공용.
// 참가자(현재 그 게임 탭에 있는 사람) 목록과 준비 상태를 보여주고,
// 방장에겐 시작 버튼(전원 준비 시 활성), 참가자에겐 준비 토글을 제공한다.

export type LobbyMember = {
  memberId: string;
  nickname: string;
  ready: boolean;
  isOwner: boolean;
  away: boolean; // 자리비움(대기방) — 시작 조건에서 제외
};

type Props = {
  title: string;
  description?: string;
  notice?: string | null; // 진행 중 대결 안내 등 강조 배너
  members: LobbyMember[];
  myMemberId: string;
  isOwner: boolean;
  onStart: () => void;
  onReady: (ready: boolean) => void;
  startError?: string | null;
  canStart?: boolean; // false면 시작 버튼 비활성(예: 다른 대결 진행 중)
  busy?: boolean;
};

export function LobbyCard({
  title,
  description,
  notice,
  members,
  myMemberId,
  isOwner,
  onStart,
  onReady,
  startError,
  canStart = true,
  busy,
}: Props) {
  // 자리비움(대기방) 멤버는 목록/시작 조건에서 분리한다
  const active = members.filter((m) => !m.away);
  const awayMembers = members.filter((m) => m.away);
  const me = active.find((m) => m.memberId === myMemberId);
  const myReady = me?.ready ?? false;
  const others = active.filter((m) => !m.isOwner);
  // 방장 제외 전원 준비(상대가 없으면 솔로 시작 허용)
  const allReady = others.every((m) => m.ready);
  // 방장이 아니어도 대기실에 혼자면 솔로 시작 가능
  const alone = active.length === 1 && !!me;
  const solo = (isOwner && others.length === 0) || (!isOwner && alone);
  const showStart = isOwner || alone;

  return (
    <div className="flex flex-col items-center gap-4 p-6 border border-[var(--sheet-cell-border)] bg-white w-full max-w-md mx-auto">
      <div className="text-[16px] font-medium text-[var(--sheet-fg)]">{title}</div>
      {description && (
        <p className="text-[13px] text-[var(--sheet-muted)] text-center whitespace-pre-line">
          {description}
        </p>
      )}
      {notice && (
        <div className="w-full text-center text-[12px] text-[var(--sheet-fg)] bg-[var(--sheet-header-bg)] border border-[var(--sheet-cell-border)] rounded px-3 py-2">
          {notice}
        </div>
      )}

      <div className="w-full flex flex-col gap-1">
        <div className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
          참가자 {active.length}
        </div>
        {active.length === 0 ? (
          <div className="text-[12px] text-[var(--sheet-muted)] py-2 text-center">
            아직 참가자가 없어요
          </div>
        ) : (
          active.map((m) => {
            const isMe = m.memberId === myMemberId;
            return (
              <div
                key={m.memberId}
                className={
                  "flex items-center justify-between px-3 py-1.5 border text-[13px] " +
                  (isMe
                    ? "border-[var(--sheet-active)] bg-[var(--sheet-active-bg)]"
                    : "border-[var(--sheet-cell-border)] bg-white")
                }
              >
                <span className="truncate">
                  {m.isOwner ? "👑 " : ""}
                  {m.nickname}
                  {isMe ? " (나)" : ""}
                </span>
                <span
                  className={
                    "text-[12px] shrink-0 ml-2 " +
                    (m.isOwner
                      ? "text-[var(--sheet-muted)]"
                      : m.ready
                        ? "text-[var(--sheet-green)] font-medium"
                        : "text-[var(--sheet-muted)]")
                  }
                >
                  {m.isOwner ? "방장" : m.ready ? "✓ 준비완료" : "대기 중"}
                </span>
              </div>
            );
          })
        )}
        {awayMembers.length > 0 && (
          <div className="text-[11px] text-[var(--sheet-muted)] mt-1">
            💤 대기방 {awayMembers.length} —{" "}
            {awayMembers.map((m) => m.nickname).join(", ")}
          </div>
        )}
      </div>

      {startError && (
        <div className="text-[13px] text-[#d93025]">{startError}</div>
      )}

      {showStart ? (
        <div className="flex flex-col items-center gap-2 w-full">
          <button
            type="button"
            onClick={onStart}
            disabled={(!allReady && !solo) || !canStart || busy}
            className="w-full px-5 py-2.5 rounded bg-[var(--sheet-active)] text-white text-[15px] font-medium hover:brightness-95 disabled:opacity-50"
          >
            {solo ? "혼자 시작" : "시작"}
          </button>
          {canStart && !allReady && !solo && (
            <div className="text-[12px] text-[var(--sheet-muted)]">
              모든 참가자가 준비하면 시작할 수 있어요
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onReady(!myReady)}
          disabled={busy}
          className={
            "w-full max-w-[260px] px-5 py-2.5 rounded text-[15px] font-medium disabled:opacity-50 " +
            (myReady
              ? "border border-[var(--sheet-cell-border)] text-[var(--sheet-fg)] hover:bg-black/5"
              : "bg-[var(--sheet-green)] text-white hover:brightness-95")
          }
        >
          {myReady ? "준비 취소" : "준비"}
        </button>
      )}

      {!showStart && (
        <div className="text-[12px] text-[var(--sheet-muted)] text-center">
          방장이 시작하면 자동으로 참여돼요.
        </div>
      )}
    </div>
  );
}
