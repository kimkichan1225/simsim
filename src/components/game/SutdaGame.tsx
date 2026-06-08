"use client";

// 섯다(2~6인) — 정통 베팅(삥/따당/하프/콜/다이), 38광땡 최고.
// 패는 서버가 본인에게만 개인화 스냅샷으로 보낸다(쇼다운 때 안 죽은 패만 공개).
// 골드/누적 손익은 DB 기준이며, 방장이 멤버에게 충전할 수 있다(빚 없음).

import { useCallback, useEffect, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { notifyTab } from "@/lib/tab-alert";
import { useGameStream } from "@/lib/use-game-stream";

const ANTE = 100;

// 화투 월별 색 — 1~10월이 서로 확실히 구별되도록 무지개 계열로 배치
// (index 0은 미사용, 3·8월은 광이 있는 월)
const MONTH_COLOR = [
  "#202124", // 0 (미사용)
  "#d50000", // 1 빨강
  "#e8710a", // 2 주황
  "#f9a825", // 3 황금(광)
  "#2e7d32", // 4 초록
  "#00897b", // 5 청록
  "#1a73e8", // 6 파랑
  "#3949ab", // 7 남색
  "#8e24aa", // 8 보라(광)
  "#c2185b", // 9 자홍
  "#5d4037", // 10 갈색
];

type Card = { id: string; month: number; gwang: boolean };

type PlayerView = {
  memberId: string;
  nickname: string;
  gold: number;
  bet: number;
  folded: boolean;
  cards: Card[] | null;
  hand: string | null;
};

type Result = {
  memberId: string;
  nickname: string;
  handName: string;
  delta: number;
  finalGold: number;
  winner: boolean;
};

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "joining" | "betting" | "ended";
  players: PlayerView[];
  turnMemberId: string | null;
  pot: number;
  currentBet: number;
  myCards: Card[];
  results?: Result[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string }
  | { type: "match_cancelled" }
  | { type: "match_ended"; results: Result[] }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type WalletMember = {
  memberId: string;
  nickname: string;
  gold: number;
  netProfit: number;
};
type Wallet = { gold: number; netProfit: number; members: WalletMember[] };

type Phase = "lobby" | "joining" | "betting" | "result";

export function SutdaGame({
  myMemberId,
  myNickname,
  isOwner,
  onAway,
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
  onAway: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(ANTE);
  const [results, setResults] = useState<Result[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(true);

  const amAwayRef = useRef(false);
  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    amAwayRef.current = amAway;
    if (amAway) onAway();
  }, [amAway, onAway]);

  const refreshWallet = useCallback(() => {
    void fetch("/api/sutda/wallet")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Wallet | null) => {
        if (d) setWallet(d);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  const applyEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setPlayers(ev.players);
          setTurnMemberId(ev.turnMemberId);
          setPot(ev.pot);
          setCurrentBet(ev.currentBet);
          setActError(null);
          if (ev.status === "joining") {
            setResults(null);
            setPhase("joining");
          } else if (ev.status === "betting") {
            setResults(null);
            setPhase("betting");
          } else {
            const res = ev.results ?? null;
            setResults(res);
            setPhase(res ? "result" : "lobby");
            if (res) refreshWallet(); // 정산 반영
          }
          break;
        }
        case "no_match":
          break;
        case "match_started": {
          setNotice(null);
          if (amAwayRef.current) break;
          setPhase("joining");
          void fetch("/api/sutda/join", { method: "POST" }).catch(
            () => undefined,
          );
          break;
        }
        case "match_cancelled": {
          setNotice("인원이 모이지 않아 판이 취소됐어요. (2명 이상 필요)");
          setPhase("lobby");
          break;
        }
        case "match_ended": {
          setResults(ev.results);
          setPhase("result");
          refreshWallet();
          break;
        }
        case "lobby": {
          setLobbyMembers(ev.members);
          break;
        }
        default:
          break;
      }
    },
    [refreshWallet],
  );

  useGameStream<ServerEvent>("/api/sutda/stream", applyEvent);

  const me = players.find((p) => p.memberId === myMemberId) ?? null;
  const isMyTurn =
    phase === "betting" && me != null && !me.folded && turnMemberId === myMemberId;

  // 내 차례가 되면 탭이 백그라운드일 때 알림
  useEffect(() => {
    if (isMyTurn) notifyTab();
  }, [isMyTurn]);

  const callDiff = me ? Math.max(0, currentBet - me.bet) : 0;
  const myGold = me?.gold ?? wallet?.gold ?? 0;

  const doAct = useCallback(
    async (action: "call" | "bbing" | "ttadang" | "half") => {
      setActError(null);
      const res = await fetch("/api/sutda/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(() => null);
      if (res && !res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setActError(translateActError(data?.error));
      }
    },
    [],
  );

  const doFold = useCallback(() => {
    void fetch("/api/sutda/fold", { method: "POST" }).catch(() => undefined);
  }, []);

  const startMatch = useCallback(async () => {
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/sutda/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStartError(translateStartError(data?.error));
      }
    } catch {
      setStartError("연결 실패");
    }
  }, []);

  const toggleReady = useCallback((ready: boolean) => {
    void fetch("/api/sutda/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const grant = useCallback(
    async (targetMemberId: string, amount: number) => {
      const res = await fetch("/api/sutda/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberId, amount }),
      }).catch(() => null);
      if (res && res.ok) refreshWallet();
    },
    [refreshWallet],
  );

  return (
    <div className="flex flex-col gap-3 w-full pt-4 pb-8">
      <WalletBar
        gold={myGold}
        netProfit={wallet?.netProfit ?? 0}
        inGame={phase === "betting" || phase === "joining"}
      />

      <HandGuide open={showGuide} onToggle={() => setShowGuide((v) => !v)} />

      {(phase === "betting" || phase === "joining" || phase === "result") && (
        <PotBar
          pot={pot}
          currentBet={currentBet}
          joining={phase === "joining"}
        />
      )}

      {(phase === "betting" || phase === "result") && (
        <PlayersTable
          players={players}
          turnMemberId={turnMemberId}
          myMemberId={myMemberId}
        />
      )}

      {phase === "betting" && me && !me.folded && (
        <>
          <BettingControls
            isMyTurn={isMyTurn}
            currentBet={currentBet}
            callDiff={callDiff}
            myGold={myGold}
            pot={pot}
            waitingFor={
              players.find((p) => p.memberId === turnMemberId)?.nickname ?? "?"
            }
            onAct={doAct}
            onFold={doFold}
          />
          {actError && (
            <div className="text-center text-[13px] text-[#d93025]">
              {actError}
            </div>
          )}
        </>
      )}

      {phase === "betting" && (!me || me.folded) && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
          {me?.folded ? "다이했어요 — " : ""}관전 중이에요. 판이 끝나면 다음 판에
          참여할 수 있어요.
        </div>
      )}

      {phase === "joining" && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
          참가자를 모으는 중... (2~6명, 잠시 후 패가 분배돼요)
        </div>
      )}

      {phase === "result" && results && (
        <ResultCard results={results} myMemberId={myMemberId} />
      )}

      {isOwner && (phase === "lobby" || phase === "result") && wallet && (
        <GrantPanel
          members={wallet.members}
          myMemberId={myMemberId}
          onGrant={grant}
        />
      )}

      {(phase === "lobby" || phase === "result") && (
        <LobbyCard
          title={phase === "result" ? "다시 하기" : "섯다"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "화투 2장으로 족보를 만들어 겨루는 섯다예요.\n앤티 100골드, 38광땡이 최고패. 방장이 시작하면 2~6명이 함께해요."
          }
          notice={notice}
          members={lobbyMembers}
          myMemberId={myMemberId}
          isOwner={isOwner}
          onStart={startMatch}
          onReady={toggleReady}
          startError={startError}
          requiresOpponent
        />
      )}
      <span className="sr-only">{myNickname}</span>
    </div>
  );
}

function translateStartError(code: string | undefined): string {
  switch (code) {
    case "forbidden":
      return "게임 시작은 방장만 할 수 있어요.";
    case "need_opponent":
      return "섯다는 2명 이상이어야 시작할 수 있어요.";
    case "not_ready":
      return "모든 참가자가 준비해야 시작할 수 있어요.";
    case "broke":
      return "골드가 앤티(100)보다 적어요. 충전이 필요해요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    default:
      return "시작에 실패했어요.";
  }
}

function translateActError(code: string | undefined): string {
  switch (code) {
    case "insufficient":
      return "골드가 부족해요. 콜할 수 없으면 다이하세요.";
    case "cannot_bbing":
      return "삥은 첫 베팅에서만 할 수 있어요.";
    case "not_your_turn":
      return "내 차례가 아니에요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    default:
      return "베팅에 실패했어요.";
  }
}

function fmt(n: number): string {
  return n.toLocaleString("ko-KR");
}

// 족보 안내(접기 가능). 높은 순으로 한눈에 보여준다.
const HAND_GUIDE_ROWS: { tag: string; desc: string }[] = [
  { tag: "최고", desc: "38광땡 (3·8월 둘 다 광)" },
  { tag: "땡", desc: "같은 월 — 장땡(10) > 9 > … > 1" },
  {
    tag: "특수",
    desc: "알리(1·2) · 독사(1·4) · 구삥(1·9) · 장삥(1·10) · 장사(4·10) · 세륙(4·6)",
  },
  { tag: "끗수", desc: "두 월 합의 끝자리 — 갑오(9끗) > … > 1끗 > 망통(0끗)" },
];

function HandGuide({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] font-medium text-[var(--sheet-fg)] hover:bg-black/5"
      >
        <span>족보 (높은 순)</span>
        <span className="text-[var(--sheet-muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 px-3 pb-2">
          {HAND_GUIDE_ROWS.map((r) => (
            <div key={r.tag} className="flex items-start gap-2 text-[12px]">
              <span className="shrink-0 w-9 text-[var(--sheet-active)] font-medium">
                {r.tag}
              </span>
              <span className="text-[var(--sheet-muted)]">{r.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WalletBar({
  gold,
  netProfit,
  inGame,
}: {
  gold: number;
  netProfit: number;
  inGame: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)] text-[13px]">
      <span className="text-[var(--sheet-fg)]">
        {inGame ? "이번 판 내 골드" : "내 골드"}{" "}
        <span className="font-medium tabular-nums">{fmt(gold)}</span>
      </span>
      <span
        className={
          "tabular-nums " +
          (netProfit > 0
            ? "text-[var(--sheet-green)]"
            : netProfit < 0
              ? "text-[#d93025]"
              : "text-[var(--sheet-muted)]")
        }
      >
        누적 손익 {netProfit > 0 ? "+" : ""}
        {fmt(netProfit)}
      </span>
    </div>
  );
}

function PotBar({
  pot,
  currentBet,
  joining,
}: {
  pot: number;
  currentBet: number;
  joining: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-4 px-3 py-2 border border-[var(--sheet-cell-border)] bg-white text-[13px]">
      {joining ? (
        <span className="text-[var(--sheet-muted)]">모집 중...</span>
      ) : (
        <>
          <span>
            판돈{" "}
            <span className="font-medium tabular-nums text-[var(--sheet-active)]">
              {fmt(pot)}
            </span>
          </span>
          <span className="text-[var(--sheet-muted)]">·</span>
          <span className="text-[var(--sheet-muted)]">
            콜 기준 <span className="tabular-nums">{fmt(currentBet)}</span>
          </span>
        </>
      )}
    </div>
  );
}

function HwatuCard({ card, hidden }: { card?: Card; hidden?: boolean }) {
  if (hidden || !card) {
    return (
      <div className="w-9 h-12 rounded border border-[var(--sheet-cell-border)] bg-[#dadce0] grid place-items-center text-[10px] text-[#5f6368] select-none">
        ?
      </div>
    );
  }
  const color = MONTH_COLOR[card.month] ?? "#202124";
  return (
    <div
      className="w-9 h-12 rounded border-2 bg-white grid place-items-center shadow-sm select-none relative"
      style={{ color, borderColor: color }}
    >
      <span className="text-[18px] font-bold leading-none">{card.month}</span>
      {card.gwang && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#e8710a] text-white text-[9px] font-bold grid place-items-center">
          光
        </span>
      )}
    </div>
  );
}

function PlayersTable({
  players,
  turnMemberId,
  myMemberId,
}: {
  players: PlayerView[];
  turnMemberId: string | null;
  myMemberId: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {players.map((p) => {
        const isTurn = p.memberId === turnMemberId;
        const isMe = p.memberId === myMemberId;
        return (
          <div
            key={p.memberId}
            className={
              "flex flex-col gap-1.5 p-2 border bg-white min-w-[120px] " +
              (isTurn
                ? "border-[var(--sheet-active)] ring-1 ring-[var(--sheet-active)] "
                : "border-[var(--sheet-cell-border)] ") +
              (p.folded ? "opacity-50" : "")
            }
          >
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className={isMe ? "font-medium" : ""}>
                {p.nickname}
                {isMe ? " (나)" : ""}
              </span>
              {isTurn && (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--sheet-active)]" />
              )}
            </div>
            <div className="flex gap-1">
              {p.folded ? (
                <span className="text-[12px] text-[var(--sheet-muted)] py-3">
                  다이
                </span>
              ) : p.cards ? (
                p.cards.map((c) => <HwatuCard key={c.id} card={c} />)
              ) : (
                <>
                  <HwatuCard hidden />
                  <HwatuCard hidden />
                </>
              )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--sheet-muted)] tabular-nums">
              <span>벳 {fmt(p.bet)}</span>
              <span>{fmt(p.gold)}G</span>
            </div>
            {p.hand && !p.folded && (
              <div className="text-[12px] text-center font-medium text-[var(--sheet-active)]">
                {p.hand}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BettingControls({
  isMyTurn,
  currentBet,
  callDiff,
  myGold,
  pot,
  waitingFor,
  onAct,
  onFold,
}: {
  isMyTurn: boolean;
  currentBet: number;
  callDiff: number;
  myGold: number;
  pot: number;
  waitingFor: string;
  onAct: (a: "call" | "bbing" | "ttadang" | "half") => void;
  onFold: () => void;
}) {
  if (!isMyTurn) {
    return (
      <div className="text-center text-[13px] text-[var(--sheet-muted)]">
        {waitingFor}의 베팅을 기다리는 중...
      </div>
    );
  }
  const canCall = callDiff <= myGold;
  const canBbing = currentBet === ANTE && currentBet + ANTE - callDiff <= myGold;
  // 따당: currentBet*2 까지, 하프: currentBet + max(pot/2, ANTE)
  const ttadangNeed = currentBet * 2 - (currentBet - callDiff);
  const halfRaise = Math.max(Math.floor(pot / 2), ANTE);
  const halfNeed = currentBet + halfRaise - (currentBet - callDiff);

  const Btn = ({
    label,
    onClick,
    disabled,
    primary,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    primary?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1.5 rounded text-[13px] font-medium disabled:opacity-40 " +
        (primary
          ? "bg-[var(--sheet-active)] text-white hover:brightness-95"
          : "border border-[var(--sheet-cell-border)] hover:bg-black/5")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <Btn
        label={callDiff === 0 ? "체크" : `콜 (${fmt(callDiff)})`}
        onClick={() => onAct("call")}
        disabled={!canCall}
        primary
      />
      {currentBet === ANTE && (
        <Btn
          label={`삥 (${fmt(ANTE)})`}
          onClick={() => onAct("bbing")}
          disabled={!canBbing}
        />
      )}
      <Btn
        label={`따당 (${fmt(ttadangNeed)})`}
        onClick={() => onAct("ttadang")}
        disabled={ttadangNeed > myGold}
      />
      <Btn
        label={`하프 (${fmt(halfNeed)})`}
        onClick={() => onAct("half")}
        disabled={halfNeed > myGold}
      />
      <Btn label="다이" onClick={onFold} />
    </div>
  );
}

function ResultCard({
  results,
  myMemberId,
}: {
  results: Result[];
  myMemberId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-5 border border-[var(--sheet-cell-border)] bg-white w-full">
      <h2 className="text-[16px] font-medium">결과</h2>
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="text-[var(--sheet-muted)]">
            <th className="px-2 py-1 text-left">닉네임</th>
            <th className="px-2 py-1 text-left">족보</th>
            <th className="px-2 py-1 text-right">손익</th>
            <th className="px-2 py-1 text-right">잔액</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const isMe = r.memberId === myMemberId;
            return (
              <tr
                key={r.memberId}
                className={isMe ? "text-[var(--sheet-active)] font-medium" : ""}
              >
                <td className="px-2 py-1">
                  {r.winner ? "🏆 " : ""}
                  {r.nickname}
                  {isMe ? " (나)" : ""}
                </td>
                <td className="px-2 py-1">{r.handName}</td>
                <td
                  className={
                    "px-2 py-1 tabular-nums text-right " +
                    (r.delta > 0
                      ? "text-[var(--sheet-green)]"
                      : r.delta < 0
                        ? "text-[#d93025]"
                        : "")
                  }
                >
                  {r.delta > 0 ? "+" : ""}
                  {fmt(r.delta)}
                </td>
                <td className="px-2 py-1 tabular-nums text-right">
                  {fmt(r.finalGold)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GrantPanel({
  members,
  myMemberId,
  onGrant,
}: {
  members: WalletMember[];
  myMemberId: string;
  onGrant: (targetMemberId: string, amount: number) => void;
}) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("10000");

  const effectiveTarget = target || members[0]?.memberId || "";

  return (
    <div className="flex flex-col gap-2 p-3 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]">
      <div className="text-[12px] font-medium text-[var(--sheet-fg)]">
        방장 — 골드 충전
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={effectiveTarget}
          onChange={(e) => setTarget(e.target.value)}
          className="border border-[var(--sheet-cell-border)] rounded px-2 py-1 text-[13px] bg-white"
        >
          {members.map((m) => (
            <option key={m.memberId} value={m.memberId}>
              {m.nickname}
              {m.memberId === myMemberId ? " (나)" : ""} · {fmt(m.gold)}G
            </option>
          ))}
        </select>
        <input
          type="number"
          value={amount}
          min={1}
          step={1000}
          onChange={(e) => setAmount(e.target.value)}
          className="w-28 border border-[var(--sheet-cell-border)] rounded px-2 py-1 text-[13px] bg-white tabular-nums"
        />
        <button
          type="button"
          onClick={() => {
            const n = parseInt(amount, 10);
            if (effectiveTarget && Number.isFinite(n) && n > 0) {
              onGrant(effectiveTarget, n);
            }
          }}
          className="px-3 py-1 rounded bg-[var(--sheet-active)] text-white text-[13px] font-medium hover:brightness-95"
        >
          충전
        </button>
      </div>
      <span className="text-[11px] text-[var(--sheet-muted)]">
        충전한 골드는 손익에 잡히지 않아요. 진행 중인 판에는 다음 판부터 반영돼요.
      </span>
    </div>
  );
}
