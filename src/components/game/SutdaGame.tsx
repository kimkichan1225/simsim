"use client";

// 섯다(세장, 2~6인) — 2장 받고 베팅 → 1장 더 받고 베팅 → 3장 중 2장 선택 → 오픈.
// 정통 베팅(삥/따당/하프/콜/다이), 특수패·재경기, 38광땡 최고.
// 패는 서버가 본인에게만 보낸다. 골드/손익은 DB 기준, 방장이 충전 가능(빚 없음).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { notifyTab } from "@/lib/tab-alert";
import { useGameStream } from "@/lib/use-game-stream";
import {
  bestTwoOf,
  evaluate2,
  type HandCategory,
  type HwatuCard,
} from "@/lib/sutda-rules";

const ANTE = 100;

const MONTH_COLOR = [
  "#202124", "#d50000", "#e8710a", "#f9a825", "#2e7d32", "#00897b",
  "#1a73e8", "#3949ab", "#8e24aa", "#c2185b", "#5d4037",
];

type PlayerView = {
  memberId: string;
  nickname: string;
  gold: number;
  bet: number;
  folded: boolean;
  selected: boolean;
  cardCount: number;
  cards: HwatuCard[] | null;
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
  myCards: HwatuCard[];
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
  const [round, setRound] = useState<1 | 2>(1);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(ANTE);
  const [myCards, setMyCards] = useState<HwatuCard[]>([]);
  const [myChosen, setMyChosen] = useState<[number, number] | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(true);
  // 선택 단계 로컬 선택(확정 전)
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
          setRound(ev.round);
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
          setNotice("구사/멍구사 — 재경기! 카드를 다시 돌려요.");
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

  // 내 패 미리보기 족보 — 선택 단계는 고른 2장, 베팅 단계는 최고 2장
  const myHand = useMemo(() => {
    if (myCards.length < 2) return null;
    if (phase === "selecting" && pick.length === 2) {
      return evaluate2(myCards[pick[0]], myCards[pick[1]]);
    }
    if (myChosen) {
      return evaluate2(myCards[myChosen[0]], myCards[myChosen[1]]);
    }
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
      if (prev.length >= 2) return [prev[1], idx]; // 오래된 것 밀어내기
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
    <div className="flex flex-col gap-3 w-full pt-4 pb-8">
      <WalletBar gold={myGold} netProfit={wallet?.netProfit ?? 0} inGame={inGame} />

      <HandGuide
        open={showGuide}
        onToggle={() => setShowGuide((v) => !v)}
        myCat={inGame || phase === "result" ? (myHand?.cat ?? null) : null}
      />

      {(phase === "betting" || phase === "selecting" || phase === "result") && (
        <PotBar pot={pot} currentBet={currentBet} round={round} status={status} />
      )}

      {phase === "joining" && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
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

      {/* 내 패 */}
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

      {/* 베팅 컨트롤 */}
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

      {/* 선택 컨트롤 */}
      {phase === "selecting" && amPlaying && (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {myChosen ? (
            <span className="text-[13px] text-[var(--sheet-muted)]">
              선택 완료 — 다른 사람을 기다리는 중...
            </span>
          ) : (
            <>
              <span className="text-[13px] text-[var(--sheet-muted)]">
                쓸 2장을 고르세요 (번복 불가)
              </span>
              <button
                type="button"
                onClick={confirmSelect}
                disabled={pick.length !== 2}
                className="px-4 py-1.5 rounded bg-[var(--sheet-active)] text-white text-[13px] font-medium hover:brightness-95 disabled:opacity-40"
              >
                선택 확정
              </button>
            </>
          )}
        </div>
      )}

      {(phase === "betting" || phase === "selecting") && !amPlaying && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
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
          title={phase === "result" ? "다시 하기" : "섯다(세장)"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "2장 받고 베팅 → 1장 더 받고 베팅 → 3장 중 2장을 골라 승부!\n앤티 100골드, 38광땡이 최고. 방장이 시작하면 2~6명이 함께해요."
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

// 카테고리 → 족보표 행 키
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
  { key: "g38", label: "38광땡", desc: "3·8 둘 다 광 (최고)" },
  { key: "gwang", label: "광땡", desc: "13광땡 · 18광땡" },
  { key: "ddaeng", label: "땡", desc: "장땡(10) > 9 > … > 1" },
  { key: "amhaeng", label: "암행어사", desc: "4열+7열 — 13·18광땡 잡음" },
  { key: "ddangjabi", label: "땡잡이", desc: "3광+7열 — 1~9땡 잡음" },
  {
    key: "special",
    label: "특수",
    desc: "알리·독사·구삥·장삥·장사·세륙",
  },
  { key: "gusa", label: "구사/멍구사", desc: "4·9 — 재경기" },
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
    <div className="border border-[var(--sheet-cell-border)] bg-white">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] font-medium text-[var(--sheet-fg)] hover:bg-black/5"
      >
        <span>족보 (높은 순){mine ? " · 내 패 표시" : ""}</span>
        <span className="text-[var(--sheet-muted)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="flex flex-col px-2 pb-2">
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
                    "shrink-0 w-16 " +
                    (hit
                      ? "text-[var(--sheet-active)]"
                      : "text-[var(--sheet-fg)]")
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
  round,
  status,
}: {
  pot: number;
  currentBet: number;
  round: 1 | 2;
  status: Snapshot["status"];
}) {
  return (
    <div className="flex items-center justify-center gap-4 px-3 py-2 border border-[var(--sheet-cell-border)] bg-white text-[13px]">
      <span>
        판돈{" "}
        <span className="font-medium tabular-nums text-[var(--sheet-active)]">
          {fmt(pot)}
        </span>
      </span>
      <span className="text-[var(--sheet-muted)]">·</span>
      {status === "select" ? (
        <span className="text-[var(--sheet-muted)]">2장 선택 중</span>
      ) : status === "ended" ? (
        <span className="text-[var(--sheet-muted)]">오픈</span>
      ) : (
        <span className="text-[var(--sheet-muted)]">
          {round}라운드 · 콜 기준{" "}
          <span className="tabular-nums">{fmt(currentBet)}</span>
        </span>
      )}
    </div>
  );
}

function HwatuCardView({
  card,
  hidden,
  selected,
  selectable,
  onClick,
}: {
  card?: HwatuCard;
  hidden?: boolean;
  selected?: boolean;
  selectable?: boolean;
  onClick?: () => void;
}) {
  if (hidden || !card) {
    return (
      <div className="w-9 h-12 rounded border border-[var(--sheet-cell-border)] bg-[#dadce0] grid place-items-center text-[10px] text-[#5f6368] select-none">
        ?
      </div>
    );
  }
  const color = MONTH_COLOR[card.month] ?? "#202124";
  const kindLabel =
    card.kind === "gwang" ? "광" : card.kind === "yeol" ? "열" : "띠";
  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={onClick}
      className={
        "w-9 h-12 rounded border-2 bg-white grid place-items-center shadow-sm select-none relative " +
        (selectable ? "cursor-pointer " : "cursor-default ") +
        (selected ? "ring-2 ring-[var(--sheet-active)] -translate-y-1 " : "")
      }
      style={{ color, borderColor: color }}
    >
      <span className="text-[18px] font-bold leading-none">{card.month}</span>
      <span className="absolute bottom-0.5 right-0.5 text-[8px] text-[var(--sheet-muted)]">
        {kindLabel}
      </span>
      {card.kind === "gwang" && (
        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#e8710a] text-white text-[9px] font-bold grid place-items-center">
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
  cards: HwatuCard[];
  phase: Phase;
  pick: number[];
  chosen: [number, number] | null;
  handName: string | null;
  onToggle: (idx: number) => void;
}) {
  const selecting = phase === "selecting" && !chosen;
  return (
    <div className="flex flex-col gap-1.5 p-3 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--sheet-muted)] uppercase tracking-wide">
          내 패
        </span>
        {handName && (
          <span className="text-[13px] font-medium text-[var(--sheet-active)]">
            {selecting && pick.length < 2 ? "" : handName}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {cards.map((c, i) => {
          const isChosen = chosen
            ? i === chosen[0] || i === chosen[1]
            : pick.includes(i);
          return (
            <HwatuCardView
              key={c.id}
              card={c}
              selected={isChosen}
              selectable={selecting}
              onClick={selecting ? () => onToggle(i) : undefined}
            />
          );
        })}
      </div>
      {selecting && (
        <span className="text-[11px] text-[var(--sheet-muted)]">
          {pick.length < 2
            ? "카드를 눌러 2장을 고르세요"
            : `선택: ${handName ?? "-"}`}
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
              {p.selected && !p.folded && (
                <span className="text-[10px] text-[var(--sheet-green)]">✓</span>
              )}
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
                p.cards.map((c) => <HwatuCardView key={c.id} card={c} />)
              ) : (
                Array.from({ length: Math.max(1, p.cardCount) }).map((_, i) => (
                  <HwatuCardView key={i} hidden />
                ))
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
      <div className="text-center text-[13px] text-[var(--sheet-muted)]">
        {waitingFor}의 베팅을 기다리는 중...
      </div>
    );
  }
  const canCall = callDiff <= myGold;
  const canBbing = currentBet === roundBase && currentBet + ANTE - callDiff <= myGold;
  const ttadangNeed = Math.max(currentBet * 2, ANTE) - (currentBet - callDiff);
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
      {currentBet === roundBase && (
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
