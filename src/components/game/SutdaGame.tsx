"use client";

// LA섯다(2~6인) — 트럼프 ♠♦ A~10(20장), 광=♠A·3·8.
// 2장 받고 베팅 → 1장 더 받고 베팅 → 3장 중 2장 선택 → 오픈.
// 정통 베팅(삥/따당/하프/콜/다이), 특수패·재경기(구사/무승부). 38광땡 최고.
// 골드/손익은 DB 기준, 방장이 충전 가능(빚 없음).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { notifyTab } from "@/lib/tab-alert";
import { useGameStream } from "@/lib/use-game-stream";
import {
  bestTwoOf,
  evaluate2,
  isGwang,
  type HandCategory,
  type SutdaCard,
} from "@/lib/sutda-rules";

const ANTE = 100;

type PlayerView = {
  memberId: string;
  nickname: string;
  gold: number;
  bet: number;
  folded: boolean;
  selected: boolean;
  cardCount: number;
  openCard: SutdaCard | null;
  cards: SutdaCard[] | null;
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
  status: "joining" | "bet1" | "bet2" | "select" | "ended";
  round: 1 | 2;
  players: PlayerView[];
  turnMemberId: string | null;
  pot: number;
  currentBet: number;
  myCards: SutdaCard[];
  myChosen: [number, number] | null;
  results?: Result[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string }
  | { type: "match_cancelled" }
  | { type: "match_ended"; results: Result[] }
  | { type: "replay" }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type WalletMember = {
  memberId: string;
  nickname: string;
  gold: number;
  netProfit: number;
};
type Wallet = { gold: number; netProfit: number; members: WalletMember[] };

type Phase = "lobby" | "joining" | "betting" | "selecting" | "result";

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
  const [status, setStatus] = useState<Snapshot["status"]>("joining");
  const [roundNo, setRoundNo] = useState<1 | 2>(1);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(ANTE);
  const [myCards, setMyCards] = useState<SutdaCard[]>([]);
  const [myChosen, setMyChosen] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [pick, setPick] = useState<number[]>([]);

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
          setStatus(ev.status);
          setRoundNo(ev.round);
          setPlayers(ev.players);
          setTurnMemberId(ev.turnMemberId);
          setPot(ev.pot);
          setCurrentBet(ev.currentBet);
          setMyCards(ev.myCards);
          setMyChosen(ev.myChosen);
          setActError(null);
          if (ev.status === "joining") {
            setResults(null);
            setPhase("joining");
          } else if (ev.status === "bet1" || ev.status === "bet2") {
            setResults(null);
            setPick([]);
            setPhase("betting");
          } else if (ev.status === "select") {
            setResults(null);
            setPhase("selecting");
          } else {
            const res = ev.results ?? null;
            setResults(res);
            setPhase(res ? "result" : "lobby");
            if (res) refreshWallet();
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
        case "replay": {
          setNotice("재경기! 카드를 다시 돌려요.");
          setPick([]);
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
  const amPlaying = me != null && !me.folded;
  const isMyTurn =
    (status === "bet1" || status === "bet2") &&
    amPlaying &&
    turnMemberId === myMemberId;

  useEffect(() => {
    if (isMyTurn) notifyTab();
  }, [isMyTurn]);

  const myHand = useMemo(() => {
    if (myCards.length < 2) return null;
    if (phase === "selecting" && pick.length === 2) {
      return evaluate2(myCards[pick[0]], myCards[pick[1]]);
    }
    if (myChosen) return evaluate2(myCards[myChosen[0]], myCards[myChosen[1]]);
    const best = bestTwoOf(myCards);
    return evaluate2(myCards[best.pick[0]], myCards[best.pick[1]]);
  }, [myCards, phase, pick, myChosen]);

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

  const togglePick = useCallback((idx: number) => {
    setPick((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length >= 2) return [prev[1], idx];
      return [...prev, idx];
    });
  }, []);

  const confirmSelect = useCallback(async () => {
    if (pick.length !== 2) return;
    const sorted = [...pick].sort((a, b) => a - b);
    await fetch("/api/sutda/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: [sorted[0], sorted[1]] }),
    }).catch(() => undefined);
  }, [pick]);

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

  const inGame =
    phase === "betting" || phase === "joining" || phase === "selecting";

  return (
    <div className="flex flex-col gap-3 w-full max-w-2xl mx-auto pt-4 pb-8">
      <WalletBar gold={myGold} netProfit={wallet?.netProfit ?? 0} inGame={inGame} />

      <HandGuide
        open={showGuide}
        onToggle={() => setShowGuide((v) => !v)}
        myCat={inGame || phase === "result" ? (myHand?.cat ?? null) : null}
      />

      {notice && (phase === "betting" || phase === "selecting") && (
        <div className="text-center text-[12px] text-[var(--sheet-active)] bg-[var(--sheet-active-bg)] rounded py-1.5">
          {notice}
        </div>
      )}

      {(phase === "betting" || phase === "selecting" || phase === "result") && (
        <PotBar pot={pot} currentBet={currentBet} round={roundNo} status={status} />
      )}

      {phase === "joining" && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)] py-4">
          참가자를 모으는 중... (2~6명, 잠시 후 패가 분배돼요)
        </div>
      )}

      {(phase === "betting" || phase === "selecting" || phase === "result") && (
        <PlayersTable
          players={players}
          turnMemberId={turnMemberId}
          myMemberId={myMemberId}
        />
      )}

      {(phase === "betting" || phase === "selecting") && amPlaying && (
        <MyHand
          cards={myCards}
          phase={phase}
          pick={pick}
          chosen={myChosen}
          handName={myHand?.name ?? null}
          onToggle={togglePick}
        />
      )}

      {phase === "betting" && amPlaying && (
        <>
          <BettingControls
            isMyTurn={isMyTurn}
            currentBet={currentBet}
            callDiff={callDiff}
            myGold={myGold}
            pot={pot}
            roundBase={status === "bet1" ? ANTE : 0}
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

      {phase === "selecting" && amPlaying && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {myChosen ? (
            <span className="text-[13px] text-[var(--sheet-muted)]">
              선택 완료 — 다른 사람을 기다리는 중...
            </span>
          ) : (
            <button
              type="button"
              onClick={confirmSelect}
              disabled={pick.length !== 2}
              className="px-6 py-2.5 rounded-lg bg-[var(--sheet-active)] text-white text-[14px] font-medium hover:brightness-95 disabled:opacity-40"
            >
              {pick.length === 2
                ? `이 2장으로 확정 (${myHand?.name ?? "-"})`
                : "쓸 2장을 고르세요"}
            </button>
          )}
        </div>
      )}

      {(phase === "betting" || phase === "selecting") && !amPlaying && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)] py-2">
          {me?.folded ? "다이했어요 — " : ""}관전 중이에요. 판이 끝나면 다음 판에
          참여할 수 있어요.
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
          title={phase === "result" ? "다시 하기" : "LA섯다"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "♠♦ 트럼프 2장 받고 베팅 → 1장 더 받고 베팅 → 3장 중 2장을 골라 승부!\n앤티 100골드, 삼팔광땡이 최고. 방장이 시작하면 2~6명이 함께해요."
          }
          notice={phase === "lobby" ? notice : null}
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
      return "삥은 이번 라운드 첫 베팅에서만 할 수 있어요.";
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

function catRow(cat: HandCategory | null): string | null {
  if (!cat) return null;
  if (cat.t === "g38") return "g38";
  if (cat.t === "gwang") return "gwang";
  if (cat.t === "ddaeng") return "ddaeng";
  if (cat.t === "amhaeng") return "amhaeng";
  if (cat.t === "ddangjabi") return "ddangjabi";
  if (cat.t === "special") return "special";
  if (cat.t === "gusa" || cat.t === "menggusa") return "gusa";
  return "kkut";
}

const GUIDE_ROWS: { key: string; label: string; desc: string }[] = [
  { key: "g38", label: "삼팔광땡", desc: "♠3·♠8 (최고, 모든 패 승)" },
  { key: "gwang", label: "광땡", desc: "일팔(♠A·♠8) · 일삼(♠A·♠3)" },
  { key: "ddaeng", label: "땡", desc: "장땡(10) > 9 > … > 1" },
  { key: "amhaeng", label: "암행어사", desc: "♠4·♠7 — 일팔·일삼광땡 잡음" },
  { key: "ddangjabi", label: "땡잡이", desc: "♠3·♠7 — 1~9땡 잡음" },
  { key: "special", label: "특수", desc: "알리·독사·구삥·장삥·장사·세륙" },
  { key: "gusa", label: "구사/멍구사", desc: "9·4 — 재경기" },
  { key: "kkut", label: "끗", desc: "갑오(9끗) > … > 망통(0끗)" },
];

function HandGuide({
  open,
  onToggle,
  myCat,
}: {
  open: boolean;
  onToggle: () => void;
  myCat: HandCategory | null;
}) {
  const mine = catRow(myCat);
  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white rounded">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-2 text-[12px] font-medium text-[var(--sheet-fg)] hover:bg-black/5"
      >
        <span>
          족보 보기
          {mine && open ? " · 내 패 ▶ 표시" : ""}
        </span>
        <span className="text-[var(--sheet-muted)]">{open ? "▲ 접기" : "▼ 펼치기"}</span>
      </button>
      {open && (
        <div className="flex flex-col px-2 pb-2 border-t border-[var(--sheet-cell-border)] pt-1">
          {GUIDE_ROWS.map((r) => {
            const hit = r.key === mine;
            return (
              <div
                key={r.key}
                className={
                  "flex items-start gap-2 text-[12px] px-1.5 py-0.5 rounded " +
                  (hit ? "bg-[var(--sheet-active-bg)] font-medium" : "")
                }
              >
                <span
                  className={
                    "shrink-0 w-20 " +
                    (hit ? "text-[var(--sheet-active)]" : "text-[var(--sheet-fg)]")
                  }
                >
                  {hit ? "▶ " : ""}
                  {r.label}
                </span>
                <span className="text-[var(--sheet-muted)]">{r.desc}</span>
              </div>
            );
          })}
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
    <div className="flex items-center justify-between px-3 py-2 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)] rounded text-[13px]">
      <span className="text-[var(--sheet-fg)]">
        {inGame ? "이번 판 내 골드 " : "내 골드 "}
        <span className="font-semibold tabular-nums text-[15px]">{fmt(gold)}</span>
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
  round,
  status,
}: {
  pot: number;
  currentBet: number;
  round: 1 | 2;
  status: Snapshot["status"];
}) {
  return (
    <div className="flex items-center justify-center gap-4 px-3 py-2.5 border border-[var(--sheet-cell-border)] bg-white rounded">
      <span className="text-[13px]">
        판돈{" "}
        <span className="font-bold tabular-nums text-[16px] text-[var(--sheet-active)]">
          {fmt(pot)}
        </span>
      </span>
      <span className="text-[var(--sheet-muted)]">·</span>
      {status === "select" ? (
        <span className="text-[13px] text-[var(--sheet-muted)]">2장 선택 중</span>
      ) : status === "ended" ? (
        <span className="text-[13px] text-[var(--sheet-muted)]">오픈</span>
      ) : (
        <span className="text-[13px] text-[var(--sheet-muted)]">
          {round}라운드 · 콜 기준{" "}
          <span className="tabular-nums">{fmt(currentBet)}</span>
        </span>
      )}
    </div>
  );
}

function CardView({
  card,
  hidden,
  selected,
  selectable,
  onClick,
  big,
}: {
  card?: SutdaCard;
  hidden?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  big?: boolean;
}) {
  const size = big ? "w-12 h-16" : "w-10 h-14";
  if (hidden || !card) {
    return (
      <div
        className={
          size +
          " rounded-lg border border-[#80868b] bg-gradient-to-br from-[#5f6368] to-[#3c4043] grid place-items-center select-none"
        }
      >
        <span className="text-white/30 text-[16px]">♠</span>
      </div>
    );
  }
  const spade = card.suit === "spade";
  const color = spade ? "#202124" : "#d93025";
  const suit = spade ? "♠" : "♦";
  const label = card.num === 1 ? "A" : String(card.num);
  const gwang = isGwang(card);
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={onClick}
      className={
        size +
        " rounded-lg border-2 bg-white flex flex-col items-center justify-center shadow-sm select-none relative transition-transform " +
        (selectable ? "cursor-pointer hover:-translate-y-0.5 " : "cursor-default ") +
        (selected
          ? "ring-2 ring-[var(--sheet-active)] -translate-y-1 border-[var(--sheet-active)] "
          : "border-[#dadce0] ")
      }
    >
      <span
        className={(big ? "text-[20px] " : "text-[17px] ") + "font-bold leading-none"}
        style={{ color }}
      >
        {label}
      </span>
      <span
        className={(big ? "text-[15px] " : "text-[13px] ") + "leading-none mt-0.5"}
        style={{ color }}
      >
        {suit}
      </span>
      {gwang && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#f9a825] text-white text-[9px] font-bold grid place-items-center shadow">
          光
        </span>
      )}
    </button>
  );
}

function MyHand({
  cards,
  phase,
  pick,
  chosen,
  handName,
  onToggle,
}: {
  cards: SutdaCard[];
  phase: Phase;
  pick: number[];
  chosen: [number, number] | null;
  handName: string | null;
  onToggle: (idx: number) => void;
}) {
  const selecting = phase === "selecting" && !chosen;
  return (
    <div className="flex flex-col gap-2 p-3 border-2 border-[var(--sheet-active)] bg-[var(--sheet-active-bg)] rounded-lg">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--sheet-muted)] uppercase tracking-wide font-medium">
          내 패
        </span>
        {handName && (!selecting || pick.length === 2) && (
          <span className="text-[14px] font-bold text-[var(--sheet-active)]">
            {handName}
          </span>
        )}
      </div>
      <div className="flex gap-2 justify-center items-start">
        {cards.map((c, i) => {
          const isChosen = chosen
            ? i === chosen[0] || i === chosen[1]
            : pick.includes(i);
          return (
            <div key={c.id} className="flex flex-col items-center gap-0.5">
              <CardView
                card={c}
                big
                selected={isChosen}
                selectable={selecting}
                onClick={selecting ? () => onToggle(i) : undefined}
              />
              {i === 1 && (
                <span className="text-[9px] text-[#d93025]">공개됨</span>
              )}
            </div>
          );
        })}
      </div>
      {selecting && (
        <span className="text-[11px] text-[var(--sheet-muted)] text-center">
          {pick.length < 2 ? "카드를 눌러 2장을 고르세요 (번복 불가)" : ""}
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
    <div className="flex flex-wrap gap-2 justify-center">
      {players.map((p) => {
        const isTurn = p.memberId === turnMemberId;
        const isMe = p.memberId === myMemberId;
        return (
          <div
            key={p.memberId}
            className={
              "flex flex-col gap-1.5 p-2 border bg-white rounded-lg min-w-[116px] " +
              (isTurn
                ? "border-[var(--sheet-active)] ring-1 ring-[var(--sheet-active)] "
                : "border-[var(--sheet-cell-border)] ") +
              (p.folded ? "opacity-50" : "")
            }
          >
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className={isMe ? "font-semibold" : ""}>
                {p.nickname}
                {isMe ? " (나)" : ""}
              </span>
              <span className="flex items-center gap-1">
                {p.selected && !p.folded && (
                  <span className="text-[10px] text-[var(--sheet-green)]">✓</span>
                )}
                {isTurn && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--sheet-active)]" />
                )}
              </span>
            </div>
            <div className="flex gap-1 justify-center min-h-[56px] items-center">
              {p.folded ? (
                <span className="text-[12px] text-[var(--sheet-muted)]">다이</span>
              ) : p.cards ? (
                // 쇼다운 — 선택한 2장 공개
                p.cards.map((c) => <CardView key={c.id} card={c} />)
              ) : (
                // 베팅 중 — 둘째 장(openCard)만 공개, 나머지는 뒷면
                Array.from({ length: Math.max(1, p.cardCount) }).map((_, i) =>
                  i === 1 && p.openCard ? (
                    <CardView key={p.openCard.id} card={p.openCard} />
                  ) : (
                    <CardView key={i} hidden />
                  ),
                )
              )}
            </div>
            {p.hand && !p.folded ? (
              <div className="text-[12px] text-center font-bold text-[var(--sheet-active)]">
                {p.hand}
              </div>
            ) : (
              <div className="flex items-center justify-between text-[11px] text-[var(--sheet-muted)] tabular-nums">
                <span>벳 {fmt(p.bet)}</span>
                <span>{fmt(p.gold)}G</span>
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
  roundBase,
  waitingFor,
  onAct,
  onFold,
}: {
  isMyTurn: boolean;
  currentBet: number;
  callDiff: number;
  myGold: number;
  pot: number;
  roundBase: number;
  waitingFor: string;
  onAct: (a: "call" | "bbing" | "ttadang" | "half") => void;
  onFold: () => void;
}) {
  if (!isMyTurn) {
    return (
      <div className="text-center text-[13px] text-[var(--sheet-muted)] py-1">
        {waitingFor}의 베팅을 기다리는 중...
      </div>
    );
  }
  const canCall = callDiff <= myGold;
  const canBbing = currentBet === roundBase && currentBet + ANTE - callDiff <= myGold;
  const ttadangNeed = Math.max(currentBet * 2, ANTE) - (currentBet - callDiff);
  const halfRaise = Math.max(Math.floor(pot / 2), ANTE);
  const halfNeed = currentBet + halfRaise - (currentBet - callDiff);

  const base =
    "px-4 py-2.5 rounded-lg text-[14px] font-semibold disabled:opacity-40 ";
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={() => onAct("call")}
        disabled={!canCall}
        className={base + "bg-[var(--sheet-active)] text-white hover:brightness-95"}
      >
        {callDiff === 0 ? "체크" : `콜 ${fmt(callDiff)}`}
      </button>
      {currentBet === roundBase && (
        <button
          type="button"
          onClick={() => onAct("bbing")}
          disabled={!canBbing}
          className={base + "border-2 border-[var(--sheet-cell-border)] hover:bg-black/5"}
        >
          삥 {fmt(ANTE)}
        </button>
      )}
      <button
        type="button"
        onClick={() => onAct("ttadang")}
        disabled={ttadangNeed > myGold}
        className={base + "border-2 border-[var(--sheet-cell-border)] hover:bg-black/5"}
      >
        따당 {fmt(ttadangNeed)}
      </button>
      <button
        type="button"
        onClick={() => onAct("half")}
        disabled={halfNeed > myGold}
        className={base + "border-2 border-[var(--sheet-cell-border)] hover:bg-black/5"}
      >
        하프 {fmt(halfNeed)}
      </button>
      <button
        type="button"
        onClick={onFold}
        className={base + "border-2 border-[#d93025] text-[#d93025] hover:bg-[#d93025]/5"}
      >
        다이
      </button>
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
    <div className="flex flex-col items-center gap-3 p-5 border border-[var(--sheet-cell-border)] bg-white rounded-lg w-full">
      <h2 className="text-[16px] font-medium">결과</h2>
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="text-[var(--sheet-muted)]">
            <th className="px-3 py-1 text-left">닉네임</th>
            <th className="px-3 py-1 text-left">족보</th>
            <th className="px-3 py-1 text-right">손익</th>
            <th className="px-3 py-1 text-right">잔액</th>
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
                <td className="px-3 py-1">
                  {r.winner ? "🏆 " : ""}
                  {r.nickname}
                  {isMe ? " (나)" : ""}
                </td>
                <td className="px-3 py-1">{r.handName}</td>
                <td
                  className={
                    "px-3 py-1 tabular-nums text-right " +
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
                <td className="px-3 py-1 tabular-nums text-right">
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
    <div className="flex flex-col gap-2 p-3 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)] rounded">
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
