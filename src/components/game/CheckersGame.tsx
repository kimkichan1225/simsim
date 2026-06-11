"use client";

// 체커(영미식 8×8 체커스) — 1:1 대결 + 나머지는 관전.
// 시작자 + 첫 합류자 중 흑(선공)/백은 랜덤 배정. 위장: 시트 셀 그리드에 말 데이터 찍는 모양.
// 보드 칸 값: 0=빈칸, 1=흑 일반, 2=백 일반, 3=흑 킹, 4=백 킹.

import { useCallback, useEffect, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { notifyTab } from "@/lib/tab-alert";
import { useGameStream } from "@/lib/use-game-stream";

const SIZE = 8;
const CELLS = SIZE * SIZE;
const COL_LETTERS = "ABCDEFGH".split("");

type StoneColor = 1 | 2;

type CheckersPlayer = {
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

type Move = { from: number; to: number };

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "running" | "ended";
  startedAt: number;
  board: number[];
  black: CheckersPlayer | null;
  white: CheckersPlayer | null;
  turnMemberId: string | null;
  lastMove: Move | null;
  mustContinueFrom: number | null;
  results?: MatchResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | {
      type: "piece_moved";
      board: number[];
      lastMove: Move;
      nextTurnMemberId: string;
      mustContinueFrom: number | null;
    }
  | { type: "match_ended"; results: MatchResult[] }
  | { type: "match_cancelled" }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "playing" | "result";

// ── 클라 측 합법 수 계산(목적지 하이라이트용; 최종 판정은 서버 권위) ──

function colorOf(v: number): 0 | StoneColor {
  if (v === 0) return 0;
  return v === 1 || v === 3 ? 1 : 2;
}
function isKing(v: number): boolean {
  return v === 3 || v === 4;
}
function dirsFor(v: number): ReadonlyArray<readonly [number, number]> {
  if (isKing(v)) {
    return [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
  }
  return colorOf(v) === 1
    ? [
        [1, 1],
        [1, -1],
      ]
    : [
        [-1, 1],
        [-1, -1],
      ];
}
function capturesFrom(board: number[], idx: number): number[] {
  const v = board[idx];
  if (v === 0) return [];
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const out: number[] = [];
  for (const [dr, dc] of dirsFor(v)) {
    const mr = r + dr;
    const mc = c + dc;
    const tr = r + 2 * dr;
    const tc = c + 2 * dc;
    if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) continue;
    const mid = mr * SIZE + mc;
    const to = tr * SIZE + tc;
    if (board[mid] !== 0 && colorOf(board[mid]) !== colorOf(v) && board[to] === 0) {
      out.push(to);
    }
  }
  return out;
}
function simpleMovesFrom(board: number[], idx: number): number[] {
  const v = board[idx];
  if (v === 0) return [];
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const out: number[] = [];
  for (const [dr, dc] of dirsFor(v)) {
    const tr = r + dr;
    const tc = c + dc;
    if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) continue;
    const to = tr * SIZE + tc;
    if (board[to] === 0) out.push(to);
  }
  return out;
}
function hasAnyCapture(board: number[], color: StoneColor): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (colorOf(board[i]) === color && capturesFrom(board, i).length > 0) {
      return true;
    }
  }
  return false;
}

export function CheckersGame({
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
  const [phase, setPhase] = useState<Phase>("lobby");
  const [board, setBoard] = useState<number[]>(() =>
    new Array<number>(CELLS).fill(0),
  );
  const [black, setBlack] = useState<CheckersPlayer | null>(null);
  const [white, setWhite] = useState<CheckersPlayer | null>(null);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [mustContinueFrom, setMustContinueFrom] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const movePendingRef = useRef(false);
  const amAwayRef = useRef(false);

  // 자리비움 판정 → 대기방 탭으로 이동
  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    amAwayRef.current = amAway;
    if (amAway) onAway();
  }, [amAway, onAway]);

  const applyEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setBoard(ev.board);
          setBlack(ev.black);
          setWhite(ev.white);
          setTurnMemberId(ev.turnMemberId);
          setLastMove(ev.lastMove);
          setMustContinueFrom(ev.mustContinueFrom);
          setSelected(ev.mustContinueFrom);
          if (ev.status === "running") {
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
          setMustContinueFrom(null);
          setSelected(null);
          setResults(null);
          setNotice(null);
          // 대기방(자리비움)이면 합류하지 않는다. 색 배정은 스냅샷으로 온다.
          if (amAwayRef.current) break;
          setPhase("playing");
          // 가장 먼저 응답한 사람이 상대(흑백 랜덤) — 이미 찼으면 관전(실패 무시)
          void fetch("/api/checkers/join", { method: "POST" }).catch(
            () => undefined,
          );
          break;
        }
        case "piece_moved": {
          setBoard(ev.board);
          setLastMove(ev.lastMove);
          setTurnMemberId(ev.nextTurnMemberId);
          setMustContinueFrom(ev.mustContinueFrom);
          // 멀티 점프 중이면 그 말을 이어서 선택, 아니면 선택 해제
          setSelected(ev.mustContinueFrom);
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

  // SSE 연결 (group_destroyed 처리·정리는 공용 훅이 담당)
  useGameStream<ServerEvent>("/api/checkers/stream", applyEvent);

  const myPlayer =
    black?.memberId === myMemberId
      ? black
      : white?.memberId === myMemberId
        ? white
        : null;
  const isMyTurn =
    myPlayer != null && white != null && turnMemberId === myMemberId;

  // 내 턴이 되면 탭이 백그라운드일 때 제목에 알림 표시
  useEffect(() => {
    if (phase === "playing" && isMyTurn) notifyTab();
  }, [phase, isMyTurn]);

  const sendMove = useCallback((from: number, to: number) => {
    if (movePendingRef.current) return;
    movePendingRef.current = true;
    void fetch("/api/checkers/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    })
      .catch(() => undefined)
      .finally(() => {
        movePendingRef.current = false;
      });
  }, []);

  // 강제 캡처: 잡을 수 있으면 캡처만 합법
  const forceCapture =
    mustContinueFrom !== null ||
    (myPlayer != null && isMyTurn && hasAnyCapture(board, myPlayer.color));

  // 현재 선택된 말의 합법 목적지
  const targets =
    selected != null && myPlayer != null
      ? forceCapture
        ? capturesFrom(board, selected)
        : simpleMovesFrom(board, selected)
      : [];

  const handleCell = useCallback(
    (idx: number) => {
      if (phase !== "playing" || !isMyTurn || myPlayer == null) return;
      // 멀티 점프 중이면 그 말만 움직일 수 있다
      const lockedFrom = mustContinueFrom;

      // 내 말 클릭 → 선택(점프 잠금 중이 아닐 때만 다른 말 선택 가능)
      if (colorOf(board[idx]) === myPlayer.color) {
        if (lockedFrom !== null && idx !== lockedFrom) return;
        const moves = forceCapture
          ? capturesFrom(board, idx)
          : simpleMovesFrom(board, idx);
        if (moves.length > 0) setSelected(idx);
        return;
      }
      // 빈 칸 클릭 → 선택된 말의 합법 목적지면 이동
      if (selected != null) {
        const moves = forceCapture
          ? capturesFrom(board, selected)
          : simpleMovesFrom(board, selected);
        if (moves.includes(idx)) sendMove(selected, idx);
      }
    },
    [phase, isMyTurn, myPlayer, board, selected, forceCapture, mustContinueFrom, sendMove],
  );

  const startMatch = useCallback(async () => {
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/checkers/start", { method: "POST" });
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
    void fetch("/api/checkers/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const resignMatch = useCallback(() => {
    void fetch("/api/checkers/resign", { method: "POST" }).catch(
      () => undefined,
    );
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
          forceCapture={forceCapture && isMyTurn}
          onResign={resignMatch}
        />
      )}

      {phase !== "lobby" && (
        <Board
          board={board}
          lastMove={lastMove}
          selected={selected}
          targets={targets}
          canPlay={phase === "playing" && isMyTurn}
          onCell={handleCell}
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
          title={phase === "result" ? "다시 하기" : "체커"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "8×8 영미식 체커 1:1 대결이에요.\n방장이 시작하면 가장 먼저 응한 사람이 상대가 되고(흑백은 랜덤), 나머지는 관전해요."
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
    case "unauthorized":
      return "그룹에 다시 입장해야 해요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    case "forbidden":
      return "게임 시작은 방장만 할 수 있어요.";
    case "need_opponent":
      return "체커는 상대가 있어야 시작할 수 있어요.";
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
  forceCapture,
  onResign,
}: {
  black: CheckersPlayer | null;
  white: CheckersPlayer | null;
  turnMemberId: string | null;
  myMemberId: string;
  myPlayer: CheckersPlayer | null;
  ended: boolean;
  forceCapture: boolean;
  onResign: () => void;
}) {
  const turnLabel = ended
    ? "대국 종료"
    : !white
      ? "상대를 기다리는 중... (15초 안에 합류 없으면 취소)"
      : turnMemberId === myMemberId
        ? forceCapture
          ? "내 차례 — 잡을 수 있으면 반드시 잡아야 해요"
          : "내 차례"
        : `${
            (turnMemberId === black?.memberId ? black : white)?.nickname ?? "?"
          } 차례${myPlayer ? "" : " — 관전 중"}`;

  return (
    <div className="flex items-stretch border border-[var(--sheet-cell-border)] bg-white w-full max-w-[420px]">
      <PlayerChip player={black} label="흑" isMe={black?.memberId === myMemberId} />
      <PlayerChip player={white} label="백" isMe={white?.memberId === myMemberId} />
      <div className="flex-1 flex items-center justify-center px-3 text-[12px] text-[var(--sheet-fg)] text-center">
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
  player: CheckersPlayer | null;
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
      <Stone color={label === "흑" ? 1 : 2} king={false} size={14} />
      <span className="truncate max-w-[90px]">
        {player ? player.nickname : "대기 중"}
        {isMe ? " (나)" : ""}
      </span>
    </div>
  );
}

function Stone({
  color,
  king,
  size,
}: {
  color: StoneColor;
  king: boolean;
  size: number;
}) {
  return (
    <span
      className={
        "inline-grid place-items-center rounded-full shrink-0 " +
        (color === 1
          ? "bg-[#3c4043] text-[#f8d667]"
          : "bg-white border-[1.5px] border-[#5f6368] text-[#c2820a]")
      }
      style={{ width: size, height: size, fontSize: size * 0.6, lineHeight: 1 }}
    >
      {king ? "♔" : ""}
    </span>
  );
}

function Board({
  board,
  lastMove,
  selected,
  targets,
  canPlay,
  onCell,
}: {
  board: number[];
  lastMove: Move | null;
  selected: number | null;
  targets: number[];
  canPlay: boolean;
  onCell: (idx: number) => void;
}) {
  const targetSet = new Set(targets);
  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white select-none">
      {/* 열 머리글 (A~H) — 시트 위장 */}
      <div className="flex bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div
          className="border-r border-[var(--sheet-cell-border)]"
          style={{ width: 26, height: 20 }}
        />
        {COL_LETTERS.map((l) => (
          <div
            key={l}
            style={{ width: 44, height: 20 }}
            className="border-r border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {l}
          </div>
        ))}
      </div>
      {Array.from({ length: SIZE }).map((_, r) => (
        <div key={r} className="flex">
          <div
            style={{ width: 26, height: 44 }}
            className="bg-[var(--sheet-header-bg)] border-r border-b border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {r + 1}
          </div>
          {Array.from({ length: SIZE }).map((_, c) => {
            const idx = r * SIZE + c;
            const v = board[idx];
            const dark = (r + c) % 2 === 1;
            const isSelected = idx === selected;
            const isTarget = targetSet.has(idx);
            const isLast =
              lastMove != null && (idx === lastMove.from || idx === lastMove.to);
            return (
              <button
                key={c}
                type="button"
                onClick={() => onCell(idx)}
                disabled={!canPlay}
                style={{ width: 44, height: 44 }}
                className={
                  "relative border-r border-b border-[var(--sheet-cell-border)] grid place-items-center " +
                  (dark ? "bg-[#e7ecf3] " : "bg-white ") +
                  (isSelected ? "outline outline-2 -outline-offset-2 outline-[var(--sheet-active)] " : "") +
                  (isLast ? "bg-[var(--sheet-active-bg)] " : "") +
                  (canPlay ? "cursor-pointer" : "cursor-default")
                }
              >
                {v !== 0 && (
                  <Stone color={colorOf(v) as StoneColor} king={isKing(v)} size={32} />
                )}
                {isTarget && v === 0 && (
                  <span className="absolute w-3 h-3 rounded-full bg-[var(--sheet-green)] opacity-70" />
                )}
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
    <div className="flex flex-col items-center gap-2 p-5 border border-[var(--sheet-cell-border)] bg-white w-full max-w-[420px]">
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
