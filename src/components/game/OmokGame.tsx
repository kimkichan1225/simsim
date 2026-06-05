"use client";

// 오목(15×15 표준 룰, 무금수, 턴 무제한) — 1:1 대결 + 나머지는 관전.
// 흑 = 시작한 방장, 백 = 첫 합류자. 위장: 시트 셀 그리드에 ●○ 데이터 찍는 모양.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LobbyCard, type LobbyMember } from "./LobbyCard";

const SIZE = 15;
const CELLS = SIZE * SIZE;
const COL_LETTERS = "ABCDEFGHIJKLMNO".split("");

type StoneColor = 1 | 2;

type OmokPlayer = {
  memberId: string;
  nickname: string;
  color: StoneColor;
};

type MatchResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "running" | "ended";
  startedAt: number;
  board: number[];
  black: OmokPlayer | null;
  white: OmokPlayer | null;
  turnMemberId: string | null;
  lastMove: number | null;
  results?: MatchResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | { type: "player_joined"; player: OmokPlayer; turnMemberId: string }
  | { type: "stone_placed"; idx: number; color: StoneColor; nextTurnMemberId: string }
  | { type: "match_ended"; results: MatchResult[] }
  | { type: "match_cancelled" }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "playing" | "result";

export function OmokGame({
  myMemberId,
  myNickname,
  isOwner,
  onAway,
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
  onAway: () => void; // 자리비움 판정 시 대기방 탭으로 이동
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("lobby");
  const [board, setBoard] = useState<number[]>(() =>
    new Array<number>(CELLS).fill(0),
  );
  const [black, setBlack] = useState<OmokPlayer | null>(null);
  const [white, setWhite] = useState<OmokPlayer | null>(null);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<number | null>(null);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const placePendingRef = useRef(false);
  const amAwayRef = useRef(false);

  // 자리비움 판정 → 대기방 탭으로 이동
  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    amAwayRef.current = amAway;
    if (amAway) onAway();
  }, [amAway, onAway]);

  // 방 폭파 시: 세션 정리 후 입장 화면으로 돌아간다.
  const handleDestroyed = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  const applyEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setBoard(ev.board);
          setBlack(ev.black);
          setWhite(ev.white);
          setTurnMemberId(ev.turnMemberId);
          setLastMove(ev.lastMove);
          if (ev.status === "running") {
            // 진행 중이면 모두 판을 본다(플레이어만 착수 가능, 나머지는 관전)
            setResults(null);
            setNotice(null);
            setPhase("playing");
          } else {
            const res = ev.results ?? null;
            setResults(res);
            setPhase(res ? "result" : "lobby");
          }
          break;
        }
        case "no_match":
          break;
        case "match_started": {
          setBoard(new Array<number>(CELLS).fill(0));
          setWhite(null);
          setTurnMemberId(null);
          setLastMove(null);
          setResults(null);
          setNotice(null);
          // 대기방(자리비움)이면 합류하지 않는다. 흑(시작자) 정보는 스냅샷으로 온다.
          if (amAwayRef.current) break;
          setPhase("playing");
          // 가장 먼저 응답한 사람이 백 — 이미 찼으면 관전(실패 무시)
          void fetch("/api/omok/join", { method: "POST" }).catch(
            () => undefined,
          );
          break;
        }
        case "player_joined": {
          setWhite(ev.player);
          setTurnMemberId(ev.turnMemberId);
          break;
        }
        case "stone_placed": {
          setBoard((prev) => {
            const next = [...prev];
            next[ev.idx] = ev.color;
            return next;
          });
          setLastMove(ev.idx);
          setTurnMemberId(ev.nextTurnMemberId);
          break;
        }
        case "match_ended": {
          setResults(ev.results);
          setPhase("result");
          break;
        }
        case "match_cancelled": {
          setNotice("상대가 합류하지 않아 판이 취소됐어요.");
          setPhase("lobby");
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
    [],
  );

  // SSE 연결
  useEffect(() => {
    const es = new EventSource("/api/omok/stream");
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const ev = JSON.parse(e.data) as ServerEvent;
        if (ev.type === "group_destroyed") {
          es.close();
          void handleDestroyed();
          return;
        }
        applyEvent(ev);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, [applyEvent, handleDestroyed]);

  const myPlayer =
    black?.memberId === myMemberId
      ? black
      : white?.memberId === myMemberId
        ? white
        : null;
  const isMyTurn =
    myPlayer != null && white != null && turnMemberId === myMemberId;

  const placeStone = useCallback(
    (idx: number) => {
      if (!isMyTurn || placePendingRef.current) return;
      placePendingRef.current = true;
      void fetch("/api/omok/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idx }),
      })
        .catch(() => undefined)
        .finally(() => {
          placePendingRef.current = false;
        });
    },
    [isMyTurn],
  );

  const startMatch = useCallback(async () => {
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/omok/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStartError(translateStartError(data?.error));
        return;
      }
    } catch {
      setStartError("연결 실패");
    }
  }, []);

  const toggleReady = useCallback((ready: boolean) => {
    void fetch("/api/omok/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const resignMatch = useCallback(() => {
    void fetch("/api/omok/resign", { method: "POST" }).catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full pt-4 pb-8 items-center">
      {phase !== "lobby" && (
        <StatusBar
          black={black}
          white={white}
          turnMemberId={turnMemberId}
          myMemberId={myMemberId}
          myPlayer={myPlayer}
          ended={phase === "result"}
          onResign={resignMatch}
        />
      )}

      {phase !== "lobby" && (
        <Board
          board={board}
          lastMove={lastMove}
          canPlace={phase === "playing" && isMyTurn}
          onPlace={placeStone}
        />
      )}

      {phase === "result" && results && (
        <ResultCard
          results={results}
          myMemberId={myMemberId}
          isDraw={results.length === 2 && results[0].rank === results[1].rank}
        />
      )}

      {(phase === "lobby" || phase === "result") && (
        <LobbyCard
          title={phase === "result" ? "다시 하기" : "오목"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "15×15 표준 오목 1:1 대결이에요.\n방장이 시작하면 가장 먼저 응한 사람이 백이 되고, 나머지는 관전해요."
          }
          notice={notice}
          members={lobbyMembers}
          myMemberId={myMemberId}
          isOwner={isOwner}
          onStart={startMatch}
          onReady={toggleReady}
          startError={startError}
        />
      )}
      <span className="sr-only">{myNickname}</span>
    </div>
  );
}

function translateStartError(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "그룹에 다시 입장해야 해요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    case "forbidden":
      return "게임 시작은 방장만 할 수 있어요.";
    case "need_opponent":
      return "오목은 상대가 있어야 시작할 수 있어요.";
    case "not_ready":
      return "모든 참가자가 준비해야 시작할 수 있어요.";
    default:
      return "시작에 실패했어요.";
  }
}

function StatusBar({
  black,
  white,
  turnMemberId,
  myMemberId,
  myPlayer,
  ended,
  onResign,
}: {
  black: OmokPlayer | null;
  white: OmokPlayer | null;
  turnMemberId: string | null;
  myMemberId: string;
  myPlayer: OmokPlayer | null;
  ended: boolean;
  onResign: () => void;
}) {
  const turnLabel = ended
    ? "대국 종료"
    : !white
      ? "상대를 기다리는 중... (15초 안에 합류 없으면 취소)"
      : turnMemberId === myMemberId
        ? "내 차례"
        : `${
            (turnMemberId === black?.memberId ? black : white)?.nickname ?? "?"
          } 차례${myPlayer ? "" : " — 관전 중"}`;

  return (
    <div className="flex items-stretch border border-[var(--sheet-cell-border)] bg-white w-full max-w-[560px]">
      <PlayerChip player={black} label="흑" isMe={black?.memberId === myMemberId} />
      <PlayerChip player={white} label="백" isMe={white?.memberId === myMemberId} />
      <div className="flex-1 flex items-center justify-center px-3 text-[13px] text-[var(--sheet-fg)]">
        {turnLabel}
      </div>
      {myPlayer && !ended && (
        <button
          type="button"
          onClick={onResign}
          className="px-3 my-1.5 mr-1.5 rounded border border-[var(--sheet-cell-border)] text-[12px] text-[var(--sheet-muted)] hover:bg-black/5"
        >
          {white ? "기권" : "판 취소"}
        </button>
      )}
    </div>
  );
}

function PlayerChip({
  player,
  label,
  isMe,
}: {
  player: OmokPlayer | null;
  label: string;
  isMe: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-1.5 px-3 py-2 border-r border-[var(--sheet-cell-border)] text-[13px] " +
        (isMe ? "bg-[var(--sheet-active-bg)]" : "")
      }
    >
      <Stone color={label === "흑" ? 1 : 2} size={14} />
      <span className="truncate max-w-[110px]">
        {player ? player.nickname : "대기 중"}
        {isMe ? " (나)" : ""}
      </span>
    </div>
  );
}

function Stone({ color, size }: { color: StoneColor; size: number }) {
  return (
    <span
      className={
        "inline-block rounded-full shrink-0 " +
        (color === 1
          ? "bg-[#3c4043]"
          : "bg-white border-[1.5px] border-[#5f6368]")
      }
      style={{ width: size, height: size }}
    />
  );
}

function Board({
  board,
  lastMove,
  canPlace,
  onPlace,
}: {
  board: number[];
  lastMove: number | null;
  canPlace: boolean;
  onPlace: (idx: number) => void;
}) {
  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white select-none">
      {/* 열 머리글 (A~O) — 시트 위장 */}
      <div className="flex bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div
          className="border-r border-[var(--sheet-cell-border)]"
          style={{ width: 26, height: 20 }}
        />
        {COL_LETTERS.map((l) => (
          <div
            key={l}
            style={{ width: 28, height: 20 }}
            className="border-r border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {l}
          </div>
        ))}
      </div>
      {Array.from({ length: SIZE }).map((_, r) => (
        <div key={r} className="flex">
          <div
            style={{ width: 26, height: 28 }}
            className="bg-[var(--sheet-header-bg)] border-r border-b border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {r + 1}
          </div>
          {Array.from({ length: SIZE }).map((_, c) => {
            const idx = r * SIZE + c;
            const v = board[idx];
            const isLast = idx === lastMove;
            return (
              <button
                key={c}
                type="button"
                onClick={() => v === 0 && onPlace(idx)}
                disabled={!canPlace || v !== 0}
                style={{ width: 28, height: 28 }}
                className={
                  "border-r border-b border-[var(--sheet-cell-border)] grid place-items-center " +
                  (isLast ? "bg-[var(--sheet-active-bg)] " : "bg-white ") +
                  (canPlace && v === 0
                    ? "cursor-pointer hover:bg-[var(--sheet-header-bg)]"
                    : "cursor-default")
                }
              >
                {v !== 0 && <Stone color={v as StoneColor} size={18} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ResultCard({
  results,
  myMemberId,
  isDraw,
}: {
  results: MatchResult[];
  myMemberId: string;
  isDraw: boolean;
}) {
  const winner = results.find((r) => r.rank === 1);
  const amWinner = winner?.memberId === myMemberId;
  return (
    <div className="flex flex-col items-center gap-2 p-5 border border-[var(--sheet-cell-border)] bg-white w-full max-w-[560px]">
      <div className="text-[16px] font-medium">
        {isDraw
          ? "무승부"
          : amWinner
            ? "승리! 🎉"
            : `${winner?.nickname ?? "?"} 승리`}
      </div>
      <div className="text-[13px] text-[var(--sheet-muted)]">
        {results
          .map((r) => `${r.nickname}${r.memberId === myMemberId ? "(나)" : ""}`)
          .join(" vs ")}
      </div>
    </div>
  );
}
