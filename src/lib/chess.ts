// 체스(표준 8×8) — 인메모리 상태/이벤트 허브.
// 오목(omok.ts)과 같은 1:1 턴제 패턴이라 서버가 전부 권위를 가진다:
//   - 기물 이동 검증, 캐슬링, 앙파상, 폰 프로모션
//   - 체크/체크메이트/스테일메이트/50수·기물부족 무승부 판정, 기권 처리
//   - 시작자 + 첫 합류자 중 동전 던지기로 백(선공)/흑 배정. 나머지는 관전.
// 규칙(이동 생성·합법성 검증)은 순수 모듈 chess-rules.ts에 있다(클라와 공용).

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";
import { GroupLobby, type LobbyMemberView } from "./lobby";
import {
  CHESS_CELLS,
  type CastlingRights,
  type Move,
  type PieceColor,
  applyToBoard,
  colorOf,
  inCheck,
  initialBoard,
  insufficientMaterial,
  legalMoves,
  typeOf,
} from "./chess-rules";

export const CHESS_SIZE = 8;

// 흑(상대)이 이 시간 안에 합류하지 않으면 판을 취소한다.
const OPPONENT_WAIT_MS = 15_000;

export type ChessStatus = "running" | "ended";
export type { PieceColor, Move, CastlingRights } from "./chess-rules";

export type ChessPlayer = {
  memberId: string;
  nickname: string;
  color: PieceColor;
};

export type ChessResult = {
  memberId: string;
  nickname: string;
  score: number; // 승 1, 무 0(무승부는 양쪽 rank 1)
  rank: number;
};

export type ChessSnapshot = {
  type: "snapshot";
  matchId: string;
  status: ChessStatus;
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
  results?: ChessResult[];
};

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "fifty_move"
  | "resign"
  | "insufficient";

export type ChessEvent =
  | ChessSnapshot
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
  | { type: "match_ended"; results: ChessResult[]; reason: EndReason }
  | { type: "match_cancelled" }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type ChessMatch = {
  matchId: string;
  groupId: string;
  status: ChessStatus;
  startedAt: number;
  board: string[];
  white: ChessPlayer;
  black: ChessPlayer | null;
  turn: PieceColor;
  turnMemberId: string | null;
  lastMove: Move | null;
  castling: CastlingRights;
  epTarget: number | null;
  halfmove: number; // 50수 룰(폰 이동/캡처 시 0으로 리셋)
  results: ChessResult[] | null;
  waitTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: ChessResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, ChessMatch>();
const channel = new GameChannel();
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: ChessEvent): void {
  channel.broadcast(groupId, event);
}

function broadcastLobby(groupId: string): void {
  broadcastToGroup(groupId, { type: "lobby", members: lobby.snapshot(groupId) });
}

export function setLobbyReady(
  groupId: string,
  memberId: string,
  ready: boolean,
): void {
  lobby.setReady(groupId, memberId, ready);
  broadcastLobby(groupId);
}

export function isAllReady(groupId: string): boolean {
  return lobby.allReady(groupId);
}

export function isAloneInLobby(groupId: string, memberId: string): boolean {
  return lobby.isAlone(groupId, memberId);
}

export function snapshotOf(match: ChessMatch): ChessSnapshot {
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    board: match.board.slice(),
    white: match.white,
    black: match.black,
    turn: match.turn,
    turnMemberId: match.turnMemberId,
    lastMove: match.lastMove,
    castling: { ...match.castling },
    epTarget: match.epTarget,
    check: inCheck(match.board, match.turn),
    results: match.results ?? undefined,
  };
}

export function getMatch(groupId: string): ChessMatch | null {
  return matches.get(groupId) ?? null;
}

// 방장이 새 판을 시작한다(기존 판은 폐기). 백이 되어 상대(흑) 합류를 기다린다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: ChessResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const now = Date.now();
  const match: ChessMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    board: initialBoard(),
    white: { memberId: input.memberId, nickname: input.nickname, color: 1 },
    black: null,
    turn: 1,
    turnMemberId: null, // 흑 합류 전에는 둘 수 없다
    lastMove: null,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epTarget: null,
    halfmove: 0,
    results: null,
    waitTimer: null,
    onEnded: input.onEnded,
  };
  matches.set(input.groupId, match);
  lobby.setGameRunning(input.groupId, true);
  lobby.clearReady(input.groupId);
  broadcastLobby(input.groupId);
  broadcastToGroup(match.groupId, {
    type: "match_started",
    matchId: match.matchId,
    startedAt: match.startedAt,
  });
  broadcastToGroup(match.groupId, snapshotOf(match));

  match.waitTimer = setTimeout(() => {
    const current = matches.get(input.groupId);
    if (current === match && match.status === "running" && !match.black) {
      match.status = "ended";
      lobby.setGameRunning(match.groupId, false);
      broadcastToGroup(match.groupId, { type: "match_cancelled" });
      cleanupMatch(match);
    }
  }, OPPONENT_WAIT_MS);

  return { matchId: match.matchId, startedAt: match.startedAt };
}

// 진행 중인 판에 상대로 합류한다. 이미 두 명이 찼으면 관전(full).
// 합류 시점에 동전 던지기로 백(선공)/흑을 랜덤 배정한다.
export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): { ok: boolean; reason?: "no_match" | "full"; color?: PieceColor } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "no_match" };
  }
  if (match.white.memberId === input.memberId) return { ok: true, color: 1 };
  if (match.black?.memberId === input.memberId) return { ok: true, color: 2 };
  if (match.black) return { ok: false, reason: "full" };

  const joiner: ChessPlayer = {
    memberId: input.memberId,
    nickname: input.nickname,
    color: 2,
  };
  if (Math.random() < 0.5) {
    // 시작자가 흑, 합류자가 백
    match.black = { ...match.white, color: 2 };
    match.white = { ...joiner, color: 1 };
  } else {
    match.black = joiner;
  }
  match.turn = 1;
  match.turnMemberId = match.white.memberId; // 백 선
  if (match.waitTimer) {
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
  }
  broadcastToGroup(match.groupId, snapshotOf(match));
  return {
    ok: true,
    color: match.white.memberId === input.memberId ? 1 : 2,
  };
}

export type MoveResult =
  | { ok: true; end: EndReason | null }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_player"
        | "not_your_turn"
        | "waiting_opponent"
        | "illegal_move";
    };

export function applyMove(input: {
  groupId: string;
  memberId: string;
  from: number;
  to: number;
  promotion?: "Q" | "R" | "B" | "N";
}): MoveResult {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  if (!match.black) return { ok: false, reason: "waiting_opponent" };

  const me =
    match.white.memberId === input.memberId
      ? match.white
      : match.black.memberId === input.memberId
        ? match.black
        : null;
  if (!me) return { ok: false, reason: "not_player" };
  if (match.turnMemberId !== input.memberId || match.turn !== me.color) {
    return { ok: false, reason: "not_your_turn" };
  }

  const { from, to } = input;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= CHESS_CELLS ||
    to < 0 ||
    to >= CHESS_CELLS
  ) {
    return { ok: false, reason: "illegal_move" };
  }
  if (colorOf(match.board[from]) !== me.color) {
    return { ok: false, reason: "illegal_move" };
  }

  // 합법 수 목록에서 일치하는 수를 찾는다(프로모션 기본 Q)
  const legal = legalMoves(match.board, me.color, match.castling, match.epTarget);
  const isPromotion =
    typeOf(match.board[from]) === "P" &&
    (Math.floor(to / CHESS_SIZE) === 0 || Math.floor(to / CHESS_SIZE) === 7);
  const wantPromo = isPromotion ? (input.promotion ?? "Q") : undefined;
  const move = legal.find(
    (m) =>
      m.from === from &&
      m.to === to &&
      (isPromotion ? m.promotion === wantPromo : true),
  );
  if (!move) return { ok: false, reason: "illegal_move" };

  const piece = match.board[from];
  const type = typeOf(piece);
  const isCapture = match.board[to] !== "." || to === match.epTarget;

  // 캐슬링 권리 갱신
  const castling = { ...match.castling };
  if (type === "K") {
    if (me.color === 1) {
      castling.wK = false;
      castling.wQ = false;
    } else {
      castling.bK = false;
      castling.bQ = false;
    }
  }
  const touchRook = (sq: number) => {
    if (sq === 56) castling.wQ = false; // a1
    if (sq === 63) castling.wK = false; // h1
    if (sq === 0) castling.bQ = false; // a8
    if (sq === 7) castling.bK = false; // h8
  };
  touchRook(from);
  touchRook(to);

  // 앙파상 타겟(폰 2칸 전진 시 지나친 칸)
  let epTarget: number | null = null;
  if (
    type === "P" &&
    Math.abs(Math.floor(to / CHESS_SIZE) - Math.floor(from / CHESS_SIZE)) === 2
  ) {
    epTarget = (from + to) / 2;
  }

  match.board = applyToBoard(match.board, move);
  match.castling = castling;
  match.epTarget = epTarget;
  match.halfmove = type === "P" || isCapture ? 0 : match.halfmove + 1;
  match.lastMove = move;

  // 턴 전환
  const opponent = me.color === 1 ? match.black : match.white;
  match.turn = opponent.color;
  match.turnMemberId = opponent.memberId;

  const oppCheck = inCheck(match.board, opponent.color);
  broadcastToGroup(match.groupId, {
    type: "moved",
    board: match.board.slice(),
    lastMove: move,
    turn: match.turn,
    nextTurnMemberId: opponent.memberId,
    castling: { ...match.castling },
    epTarget: match.epTarget,
    check: oppCheck,
  });

  // 종료 판정
  const oppLegal = legalMoves(
    match.board,
    opponent.color,
    match.castling,
    match.epTarget,
  );
  let end: EndReason | null = null;
  if (oppLegal.length === 0) {
    end = oppCheck ? "checkmate" : "stalemate";
  } else if (match.halfmove >= 100) {
    end = "fifty_move";
  } else if (insufficientMaterial(match.board)) {
    end = "insufficient";
  }

  if (end) {
    if (end === "checkmate") {
      endMatch(match, me, opponent, end); // 둔 사람이 승
    } else {
      endMatch(match, null, null, end); // 무승부
    }
  }
  return { ok: true, end };
}

// 기권 — 상대 승리로 종료
export function resign(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_player" | "waiting_opponent" } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  if (!match.black) {
    if (match.white.memberId !== input.memberId) {
      return { ok: false, reason: "not_player" };
    }
    match.status = "ended";
    lobby.setGameRunning(match.groupId, false);
    broadcastToGroup(match.groupId, { type: "match_cancelled" });
    cleanupMatch(match);
    return { ok: true };
  }
  const loser =
    match.white.memberId === input.memberId
      ? match.white
      : match.black.memberId === input.memberId
        ? match.black
        : null;
  if (!loser) return { ok: false, reason: "not_player" };
  const winner = loser.color === 1 ? match.black : match.white;
  endMatch(match, winner, loser, "resign");
  return { ok: true };
}

function endMatch(
  match: ChessMatch,
  winner: ChessPlayer | null,
  loser: ChessPlayer | null,
  reason: EndReason,
): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.waitTimer) clearTimeout(match.waitTimer);
  match.waitTimer = null;
  lobby.setGameRunning(match.groupId, false);

  const results: ChessResult[] =
    winner && loser
      ? [
          { memberId: winner.memberId, nickname: winner.nickname, score: 1, rank: 1 },
          { memberId: loser.memberId, nickname: loser.nickname, score: 0, rank: 2 },
        ]
      : [match.white, match.black].filter(Boolean).map((p) => ({
          memberId: p!.memberId,
          nickname: p!.nickname,
          score: 0,
          rank: 1, // 무승부 — 양쪽 동순위
        }));
  match.results = results;

  broadcastToGroup(match.groupId, { type: "match_ended", results, reason });

  // 승패가 갈린 결과만 점수판/활동에 기록(무승부 제외)
  if (match.onEnded && winner && loser) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("chess onEnded failed", e);
      });
    } catch (e) {
      console.error("chess onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) cleanupMatch(match);
  }, 8000);
}

function cleanupMatch(match: ChessMatch): void {
  if (match.waitTimer) clearTimeout(match.waitTimer);
  match.waitTimer = null;
  if (matches.get(match.groupId) === match) {
    matches.delete(match.groupId);
  }
}

export function registerSubscriber(
  groupId: string,
  memberId: string,
  nickname: string,
  isOwner: boolean,
  fn: SseSubscriber,
): { unsubscribe: () => void; initialEvent: ChessEvent } {
  channel.add(groupId, memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: ChessEvent = match
    ? snapshotOf(match)
    : { type: "no_match" };

  const unsubscribe = () => {
    if (!channel.remove(groupId, memberId, fn)) return;
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

export function destroyGroupChess(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  channel.clear(groupId);
  lobby.destroy(groupId);
}
