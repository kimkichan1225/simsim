"use client";

// 체스(표준 8×8) — 1:1 대결 + 나머지는 관전.
// 시작자 + 첫 합류자 중 백(선공)/흑은 랜덤 배정. 위장: 시트 셀 그리드에 기물 데이터 찍는 모양.
// 규칙(합법 수 계산)은 서버와 공용인 chess-rules.ts를 쓴다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { notifyTab } from "@/lib/tab-alert";
import { useGameStream } from "@/lib/use-game-stream";
import {
  CHESS_SIZE,
  type CastlingRights,
  type Move,
  type PieceColor,
  colorOf,
  legalMoves,
  typeOf,
} from "@/lib/chess-rules";

const SIZE = CHESS_SIZE;
const CELLS = SIZE * SIZE;
const COL_LETTERS = "ABCDEFGH".split("");

type PromoPiece = "Q" | "R" | "B" | "N";

type ChessPlayer = {
  memberId: string;
  nickname: string;
  color: PieceColor;
};

type MatchResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

type EndReason =
  | "checkmate"
  | "stalemate"
  | "fifty_move"
  | "resign"
  | "insufficient";

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "running" | "ended";
  startedAt: number;
  board: string[];
  white: ChessPlayer | null;
  black: ChessPlayer | null;
  turn: PieceColor;
  turnMemberId: string | null;
  lastMove: Move | null;
  castling: CastlingRights;
  epTarget: number | null;
  check: boolean;
  results?: MatchResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | {
      type: "moved";
      board: string[];
      lastMove: Move;
      turn: PieceColor;
      nextTurnMemberId: string;
      castling: CastlingRights;
      epTarget: number | null;
      check: boolean;
    }
  | { type: "match_ended"; results: MatchResult[]; reason: EndReason }
  | { type: "match_cancelled" }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "playing" | "result";

const WHITE_GLYPH: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
};
const BLACK_GLYPH: Record<string, string> = {
  K: "♚",
  Q: "♛",
  R: "♜",
  B: "♝",
  N: "♞",
  P: "♟",
};

function glyphFor(ch: string): string {
  if (ch === ".") return "";
  const g = colorOf(ch) === 1 ? WHITE_GLYPH : BLACK_GLYPH;
  return g[typeOf(ch)] ?? "";
}

const EMPTY_BOARD = (): string[] => new Array<string>(CELLS).fill(".");
const NO_CASTLING: CastlingRights = {
  wK: false,
  wQ: false,
  bK: false,
  bQ: false,
};

export function ChessGame({
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
  const [board, setBoard] = useState<string[]>(EMPTY_BOARD);
  const [white, setWhite] = useState<ChessPlayer | null>(null);
  const [black, setBlack] = useState<ChessPlayer | null>(null);
  const [turn, setTurn] = useState<PieceColor>(1);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [castling, setCastling] = useState<CastlingRights>(NO_CASTLING);
  const [epTarget, setEpTarget] = useState<number | null>(null);
  const [check, setCheck] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const movePendingRef = useRef(false);
  const amAwayRef = useRef(false);

  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    amAwayRef.current = amAway;
    if (amAway) onAway();
  }, [amAway, onAway]);

  const applyEvent = useCallback((ev: ServerEvent) => {
    switch (ev.type) {
      case "snapshot": {
        setBoard(ev.board);
        setWhite(ev.white);
        setBlack(ev.black);
        setTurn(ev.turn);
        setTurnMemberId(ev.turnMemberId);
        setLastMove(ev.lastMove);
        setCastling(ev.castling);
        setEpTarget(ev.epTarget);
        setCheck(ev.check);
        setSelected(null);
        setPromo(null);
        if (ev.status === "running") {
          setResults(null);
          setEndReason(null);
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
        setBoard(EMPTY_BOARD());
        setBlack(null);
        setTurnMemberId(null);
        setLastMove(null);
        setCastling(NO_CASTLING);
        setEpTarget(null);
        setCheck(false);
        setSelected(null);
        setPromo(null);
        setResults(null);
        setEndReason(null);
        setNotice(null);
        if (amAwayRef.current) break;
        setPhase("playing");
        // 가장 먼저 응답한 사람이 상대(흑백 랜덤) — 이미 찼으면 관전(실패 무시)
        void fetch("/api/chess/join", { method: "POST" }).catch(() => undefined);
        break;
      }
      case "moved": {
        setBoard(ev.board);
        setLastMove(ev.lastMove);
        setTurn(ev.turn);
        setTurnMemberId(ev.nextTurnMemberId);
        setCastling(ev.castling);
        setEpTarget(ev.epTarget);
        setCheck(ev.check);
        setSelected(null);
        setPromo(null);
        break;
      }
      case "match_ended": {
        setResults(ev.results);
        setEndReason(ev.reason);
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
  }, []);

  useGameStream<ServerEvent>("/api/chess/stream", applyEvent);

  const myColor: PieceColor | null =
    white?.memberId === myMemberId
      ? 1
      : black?.memberId === myMemberId
        ? 2
        : null;
  const isMyTurn =
    myColor != null &&
    black != null &&
    turnMemberId === myMemberId &&
    turn === myColor;
  // 흑 플레이어는 보드를 뒤집어 자기 진영이 아래로 오게 본다
  const flip = myColor === 2;

  useEffect(() => {
    if (phase === "playing" && isMyTurn) notifyTab();
  }, [phase, isMyTurn]);

  // 내 턴의 합법 수(하이라이트/검증용)
  const myLegal = useMemo(
    () =>
      isMyTurn && myColor != null
        ? legalMoves(board, myColor, castling, epTarget)
        : [],
    [isMyTurn, myColor, board, castling, epTarget],
  );
  const targets = useMemo(
    () =>
      selected != null
        ? myLegal.filter((m) => m.from === selected).map((m) => m.to)
        : [],
    [myLegal, selected],
  );

  const sendMove = useCallback(
    (from: number, to: number, promotion?: PromoPiece) => {
      if (movePendingRef.current) return;
      movePendingRef.current = true;
      void fetch("/api/chess/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, promotion }),
      })
        .catch(() => undefined)
        .finally(() => {
          movePendingRef.current = false;
        });
    },
    [],
  );

  const handleCell = useCallback(
    (realIdx: number) => {
      if (phase !== "playing" || !isMyTurn || myColor == null || promo) return;

      // 내 기물 클릭 → 선택
      if (colorOf(board[realIdx]) === myColor) {
        setSelected(realIdx);
        return;
      }
      // 목적지 클릭 → 합법이면 이동(폰 승급이면 기물 선택)
      if (selected != null && targets.includes(realIdx)) {
        const isPromo =
          typeOf(board[selected]) === "P" &&
          (Math.floor(realIdx / SIZE) === 0 || Math.floor(realIdx / SIZE) === 7);
        if (isPromo) {
          setPromo({ from: selected, to: realIdx });
        } else {
          sendMove(selected, realIdx);
        }
      }
    },
    [phase, isMyTurn, myColor, board, selected, targets, promo, sendMove],
  );

  const choosePromo = useCallback(
    (p: PromoPiece) => {
      if (!promo) return;
      sendMove(promo.from, promo.to, p);
      setPromo(null);
      setSelected(null);
    },
    [promo, sendMove],
  );

  const startMatch = useCallback(async () => {
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/chess/start", { method: "POST" });
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
    void fetch("/api/chess/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const resignMatch = useCallback(() => {
    void fetch("/api/chess/resign", { method: "POST" }).catch(() => undefined);
  }, []);

  // 체크 중인 킹 칸(현재 둘 색)
  const checkedKing =
    check && phase === "playing"
      ? board.findIndex((ch) => ch === (turn === 1 ? "K" : "k"))
      : -1;

  return (
    <div className="flex flex-col gap-4 w-full pt-4 pb-8 items-center">
      {phase !== "lobby" && (
        <StatusBar
          white={white}
          black={black}
          turnMemberId={turnMemberId}
          myMemberId={myMemberId}
          isPlayer={myColor != null}
          ready={black != null}
          ended={phase === "result"}
          check={check}
          onResign={resignMatch}
        />
      )}

      {phase !== "lobby" && (
        <div className="relative">
          <Board
            board={board}
            flip={flip}
            lastMove={lastMove}
            selected={selected}
            targets={targets}
            checkedKing={checkedKing}
            canPlay={phase === "playing" && isMyTurn}
            onCell={handleCell}
          />
          {promo && (
            <PromoPicker color={myColor === 2 ? 2 : 1} onPick={choosePromo} />
          )}
        </div>
      )}

      {phase === "result" && results && (
        <ResultCard
          results={results}
          reason={endReason}
          myMemberId={myMemberId}
        />
      )}

      {(phase === "lobby" || phase === "result") && (
        <LobbyCard
          title={phase === "result" ? "다시 하기" : "체스"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "8×8 표준 체스 1:1 대결이에요.\n방장이 시작하면 가장 먼저 응한 사람이 상대가 되고(흑백은 랜덤), 나머지는 관전해요."
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
      return "체스는 상대가 있어야 시작할 수 있어요.";
    case "not_ready":
      return "모든 참가자가 준비해야 시작할 수 있어요.";
    default:
      return "시작에 실패했어요.";
  }
}

function reasonLabel(reason: EndReason | null): string {
  switch (reason) {
    case "checkmate":
      return "체크메이트";
    case "stalemate":
      return "스테일메이트";
    case "fifty_move":
      return "50수 규칙";
    case "insufficient":
      return "기물 부족";
    case "resign":
      return "기권";
    default:
      return "";
  }
}

function StatusBar({
  white,
  black,
  turnMemberId,
  myMemberId,
  isPlayer,
  ready,
  ended,
  check,
  onResign,
}: {
  white: ChessPlayer | null;
  black: ChessPlayer | null;
  turnMemberId: string | null;
  myMemberId: string;
  isPlayer: boolean;
  ready: boolean;
  ended: boolean;
  check: boolean;
  onResign: () => void;
}) {
  const turnLabel = ended
    ? "대국 종료"
    : !ready
      ? "상대를 기다리는 중... (15초 안에 합류 없으면 취소)"
      : turnMemberId === myMemberId
        ? check
          ? "내 차례 — 체크!"
          : "내 차례"
        : `${
            (turnMemberId === white?.memberId ? white : black)?.nickname ?? "?"
          } 차례${isPlayer ? "" : " — 관전 중"}${check ? " (체크)" : ""}`;

  return (
    <div className="flex items-stretch border border-[var(--sheet-cell-border)] bg-white w-full max-w-[460px]">
      <PlayerChip player={white} label="백" isMe={white?.memberId === myMemberId} />
      <PlayerChip player={black} label="흑" isMe={black?.memberId === myMemberId} />
      <div className="flex-1 flex items-center justify-center px-3 text-[12px] text-[var(--sheet-fg)] text-center">
        {turnLabel}
      </div>
      {isPlayer && !ended && (
        <button
          type="button"
          onClick={onResign}
          className="px-3 my-1.5 mr-1.5 rounded border border-[var(--sheet-cell-border)] text-[12px] text-[var(--sheet-muted)] hover:bg-black/5"
        >
          {ready ? "기권" : "판 취소"}
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
  player: ChessPlayer | null;
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
      <span className="text-[16px] leading-none">
        {label === "백" ? "♔" : "♚"}
      </span>
      <span className="truncate max-w-[90px]">
        {player ? player.nickname : "대기 중"}
        {isMe ? " (나)" : ""}
      </span>
    </div>
  );
}

function Board({
  board,
  flip,
  lastMove,
  selected,
  targets,
  checkedKing,
  canPlay,
  onCell,
}: {
  board: string[];
  flip: boolean;
  lastMove: Move | null;
  selected: number | null;
  targets: number[];
  checkedKing: number;
  canPlay: boolean;
  onCell: (realIdx: number) => void;
}) {
  const targetSet = new Set(targets);
  // 표시 순서: 백 시점은 0..63, 흑 시점은 뒤집어 63..0
  const order = Array.from({ length: CELLS }, (_, i) => (flip ? CELLS - 1 - i : i));

  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white select-none">
      {/* 열 머리글 (A~H) — 시트 위장 */}
      <div className="flex bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div
          className="border-r border-[var(--sheet-cell-border)]"
          style={{ width: 24, height: 20 }}
        />
        {COL_LETTERS.map((l) => (
          <div
            key={l}
            style={{ width: 46, height: 20 }}
            className="border-r border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {l}
          </div>
        ))}
      </div>
      {Array.from({ length: SIZE }).map((_, dr) => (
        <div key={dr} className="flex">
          <div
            style={{ width: 24, height: 46 }}
            className="bg-[var(--sheet-header-bg)] border-r border-b border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
          >
            {dr + 1}
          </div>
          {Array.from({ length: SIZE }).map((_, dc) => {
            const realIdx = order[dr * SIZE + dc];
            const ch = board[realIdx];
            const r = Math.floor(realIdx / SIZE);
            const c = realIdx % SIZE;
            const dark = (r + c) % 2 === 1;
            const isSelected = realIdx === selected;
            const isTarget = targetSet.has(realIdx);
            const isLast =
              lastMove != null &&
              (realIdx === lastMove.from || realIdx === lastMove.to);
            const isChecked = realIdx === checkedKing;
            return (
              <button
                key={dc}
                type="button"
                onClick={() => onCell(realIdx)}
                disabled={!canPlay}
                style={{ width: 46, height: 46 }}
                className={
                  "relative border-r border-b border-[var(--sheet-cell-border)] grid place-items-center " +
                  (isChecked
                    ? "bg-[#f6c1bd] "
                    : isSelected
                      ? "bg-[var(--sheet-active-bg)] "
                      : isLast
                        ? "bg-[#fff3c4] "
                        : dark
                          ? "bg-[#e7ecf3] "
                          : "bg-white ") +
                  (canPlay ? "cursor-pointer" : "cursor-default")
                }
              >
                <span
                  className="leading-none"
                  style={{ fontSize: 30, color: "#2b2b2b" }}
                >
                  {glyphFor(ch)}
                </span>
                {isTarget && (
                  <span
                    className={
                      "absolute rounded-full " +
                      (ch === "."
                        ? "w-3.5 h-3.5 bg-[var(--sheet-green)] opacity-70"
                        : "w-full h-full border-[3px] border-[var(--sheet-green)] opacity-70")
                    }
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PromoPicker({
  color,
  onPick,
}: {
  color: PieceColor;
  onPick: (p: PromoPiece) => void;
}) {
  const glyph = color === 1 ? WHITE_GLYPH : BLACK_GLYPH;
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/30">
      <div className="flex gap-2 p-3 bg-white border border-[var(--sheet-cell-border)] rounded shadow">
        {(["Q", "R", "B", "N"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="w-12 h-12 grid place-items-center border border-[var(--sheet-cell-border)] rounded hover:bg-[var(--sheet-header-bg)]"
            style={{ fontSize: 30, color: "#2b2b2b", lineHeight: 1 }}
          >
            {glyph[p]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  results,
  reason,
  myMemberId,
}: {
  results: MatchResult[];
  reason: EndReason | null;
  myMemberId: string;
}) {
  const isDraw = results.length === 2 && results[0].rank === results[1].rank;
  const winner = results.find((r) => r.rank === 1);
  const amWinner = !isDraw && winner?.memberId === myMemberId;
  const label = reasonLabel(reason);
  return (
    <div className="flex flex-col items-center gap-2 p-5 border border-[var(--sheet-cell-border)] bg-white w-full max-w-[460px]">
      <div className="text-[16px] font-medium">
        {isDraw
          ? `무승부${label ? ` — ${label}` : ""}`
          : amWinner
            ? `승리! 🎉${label ? ` — ${label}` : ""}`
            : `${winner?.nickname ?? "?"} 승리${label ? ` — ${label}` : ""}`}
      </div>
      <div className="text-[13px] text-[var(--sheet-muted)]">
        {results
          .map((r) => `${r.nickname}${r.memberId === myMemberId ? "(나)" : ""}`)
          .join(" vs ")}
      </div>
    </div>
  );
}
