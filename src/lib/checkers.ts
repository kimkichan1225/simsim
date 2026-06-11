// 체커(영미식 8×8 체커스) — 인메모리 상태/이벤트 허브.
// 오목(omok.ts)과 같은 1:1 턴제 패턴이라 서버가 전부 권위를 가진다:
//   - 이동/캡처 검증, 강제 캡처, 멀티 점프, 킹 승급, 승패 판정, 기권 처리
//   - 시작자 + 첫 합류자 중 동전 던지기로 흑(선공)/백 배정. 나머지는 관전.
//
// 영미식 룰 요약:
//   - 8×8 보드, 어두운 칸(dark square)에만 말이 놓인다. 각 진영 12개.
//   - 일반 말은 대각선 전진 1칸. 잡을 수 있으면 반드시 잡는다(강제 캡처).
//   - 캡처는 상대 말을 뛰어넘어 그 너머 빈 칸에 착지. 연속 캡처(멀티 점프) 가능.
//   - 일반 말이 상대 끝줄에 닿으면 킹 승급(점프 중 승급 시 그 즉시 턴 종료).
//   - 킹은 네 방향 대각 1칸 이동/캡처(영미식 short king).
//   - 상대 말이 전멸하거나 상대가 둘 수 없으면 승리.

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export const CHECKERS_SIZE = 8;
const CELLS = CHECKERS_SIZE * CHECKERS_SIZE;

// 백(상대)이 이 시간 안에 합류하지 않으면 판을 취소한다.
const OPPONENT_WAIT_MS = 15_000;

export type CheckersStatus = "running" | "ended";
export type StoneColor = 1 | 2; // 1=흑(선공, 위쪽), 2=백(아래쪽)

// 보드 칸 값: 0=빈칸, 1=흑 일반, 2=백 일반, 3=흑 킹, 4=백 킹
type Cell = 0 | 1 | 2 | 3 | 4;

export type CheckersPlayer = {
  memberId: string;
  nickname: string;
  color: StoneColor;
};

export type CheckersResult = {
  memberId: string;
  nickname: string;
  score: number; // 승 1, 패 0 (점수판 표기용)
  rank: number;
};

export type Move = { from: number; to: number };

export type CheckersSnapshot = {
  type: "snapshot";
  matchId: string;
  status: CheckersStatus;
  startedAt: number;
  board: number[]; // 64칸 (row-major 8×8)
  black: CheckersPlayer | null;
  white: CheckersPlayer | null;
  turnMemberId: string | null; // null = 상대 대기 중
  lastMove: Move | null; // 마지막 이동(from→to)
  mustContinueFrom: number | null; // 멀티 점프 중 계속 움직여야 하는 말의 위치
  results?: CheckersResult[];
};

export type CheckersEvent =
  | CheckersSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | {
      type: "piece_moved";
      board: number[];
      lastMove: Move;
      nextTurnMemberId: string;
      mustContinueFrom: number | null;
    }
  | { type: "match_ended"; results: CheckersResult[] }
  | { type: "match_cancelled" } // 상대가 합류하지 않아 취소
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type CheckersMatch = {
  matchId: string;
  groupId: string;
  status: CheckersStatus;
  startedAt: number;
  board: Cell[];
  black: CheckersPlayer;
  white: CheckersPlayer | null;
  turnMemberId: string | null;
  lastMove: Move | null;
  mustContinueFrom: number | null;
  results: CheckersResult[] | null;
  waitTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: CheckersResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, CheckersMatch>();
const channel = new GameChannel();
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: CheckersEvent): void {
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

// ── 보드 규칙 헬퍼 ───────────────────────────────────────────────

// 어두운 칸(말이 놓이는 칸)인지
function isDark(idx: number): boolean {
  const r = Math.floor(idx / CHECKERS_SIZE);
  const c = idx % CHECKERS_SIZE;
  return (r + c) % 2 === 1;
}

function colorOf(v: Cell): 0 | StoneColor {
  if (v === 0) return 0;
  return v === 1 || v === 3 ? 1 : 2;
}

function isKing(v: Cell): boolean {
  return v === 3 || v === 4;
}

// 일반 말의 전진 대각 방향(흑은 아래로 +행, 백은 위로 -행)
const KING_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function dirsFor(v: Cell): ReadonlyArray<readonly [number, number]> {
  if (isKing(v)) return KING_DIRS;
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

// 끝줄(승급 행): 흑은 7행, 백은 0행
function promoteRow(color: StoneColor): number {
  return color === 1 ? CHECKERS_SIZE - 1 : 0;
}

// 특정 말이 할 수 있는 캡처 수 목록
function capturesFrom(
  board: Cell[],
  idx: number,
): Array<{ to: number; captured: number }> {
  const v = board[idx];
  if (v === 0) return [];
  const r = Math.floor(idx / CHECKERS_SIZE);
  const c = idx % CHECKERS_SIZE;
  const out: Array<{ to: number; captured: number }> = [];
  for (const [dr, dc] of dirsFor(v)) {
    const mr = r + dr;
    const mc = c + dc;
    const tr = r + 2 * dr;
    const tc = c + 2 * dc;
    if (tr < 0 || tr >= CHECKERS_SIZE || tc < 0 || tc >= CHECKERS_SIZE) continue;
    const mid = mr * CHECKERS_SIZE + mc;
    const to = tr * CHECKERS_SIZE + tc;
    const midV = board[mid];
    if (midV !== 0 && colorOf(midV) !== colorOf(v) && board[to] === 0) {
      out.push({ to, captured: mid });
    }
  }
  return out;
}

// 특정 말의 단순 이동(비캡처) 목적지 목록
function simpleMovesFrom(board: Cell[], idx: number): number[] {
  const v = board[idx];
  if (v === 0) return [];
  const r = Math.floor(idx / CHECKERS_SIZE);
  const c = idx % CHECKERS_SIZE;
  const out: number[] = [];
  for (const [dr, dc] of dirsFor(v)) {
    const tr = r + dr;
    const tc = c + dc;
    if (tr < 0 || tr >= CHECKERS_SIZE || tc < 0 || tc >= CHECKERS_SIZE) continue;
    const to = tr * CHECKERS_SIZE + tc;
    if (board[to] === 0) out.push(to);
  }
  return out;
}

// 해당 색이 캡처할 수 있는 말이 하나라도 있는지(강제 캡처 판정)
function hasAnyCapture(board: Cell[], color: StoneColor): boolean {
  for (let i = 0; i < CELLS; i++) {
    if (colorOf(board[i]) === color && capturesFrom(board, i).length > 0) {
      return true;
    }
  }
  return false;
}

// 해당 색이 둘 수 있는 수가 하나라도 있는지
function hasAnyMove(board: Cell[], color: StoneColor): boolean {
  if (hasAnyCapture(board, color)) return true;
  for (let i = 0; i < CELLS; i++) {
    if (colorOf(board[i]) === color && simpleMovesFrom(board, i).length > 0) {
      return true;
    }
  }
  return false;
}

function countColor(board: Cell[], color: StoneColor): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (colorOf(board[i]) === color) n += 1;
  return n;
}

// 초기 보드: 흑(1)은 0~2행, 백(2)은 5~7행의 어두운 칸에 배치
function initialBoard(): Cell[] {
  const board = new Array<Cell>(CELLS).fill(0);
  for (let i = 0; i < CELLS; i++) {
    if (!isDark(i)) continue;
    const r = Math.floor(i / CHECKERS_SIZE);
    if (r <= 2) board[i] = 1;
    else if (r >= 5) board[i] = 2;
  }
  return board;
}

// ── 스냅샷/조회 ─────────────────────────────────────────────────

export function snapshotOf(match: CheckersMatch): CheckersSnapshot {
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    board: match.board.slice(),
    black: match.black,
    white: match.white,
    turnMemberId: match.turnMemberId,
    lastMove: match.lastMove,
    mustContinueFrom: match.mustContinueFrom,
    results: match.results ?? undefined,
  };
}

export function getMatch(groupId: string): CheckersMatch | null {
  return matches.get(groupId) ?? null;
}

// 방장이 새 판을 시작한다(기존 판은 폐기). 흑이 되어 상대(백) 합류를 기다린다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: CheckersResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const now = Date.now();
  const match: CheckersMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    board: initialBoard(),
    black: {
      memberId: input.memberId,
      nickname: input.nickname,
      color: 1,
    },
    white: null,
    turnMemberId: null, // 백 합류 전에는 둘 수 없다
    lastMove: null,
    mustContinueFrom: null,
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

  // 상대가 합류하지 않으면 판 취소
  match.waitTimer = setTimeout(() => {
    const current = matches.get(input.groupId);
    if (current === match && match.status === "running" && !match.white) {
      match.status = "ended";
      lobby.setGameRunning(match.groupId, false);
      broadcastToGroup(match.groupId, { type: "match_cancelled" });
      cleanupMatch(match);
    }
  }, OPPONENT_WAIT_MS);

  return { matchId: match.matchId, startedAt: match.startedAt };
}

// 진행 중인 판에 상대로 합류한다. 이미 두 명이 찼으면 관전(full).
// 합류 시점에 동전 던지기로 흑(선공)/백을 랜덤 배정한다.
export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): { ok: boolean; reason?: "no_match" | "full"; color?: StoneColor } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "no_match" };
  }
  if (match.black.memberId === input.memberId) return { ok: true, color: 1 };
  if (match.white?.memberId === input.memberId) return { ok: true, color: 2 };
  if (match.white) return { ok: false, reason: "full" };

  const joiner: CheckersPlayer = {
    memberId: input.memberId,
    nickname: input.nickname,
    color: 2,
  };
  if (Math.random() < 0.5) {
    // 시작자가 백, 합류자가 흑
    match.white = { ...match.black, color: 2 };
    match.black = { ...joiner, color: 1 };
  } else {
    match.white = joiner;
  }
  match.turnMemberId = match.black.memberId; // 흑 선
  if (match.waitTimer) {
    clearTimeout(match.waitTimer);
    match.waitTimer = null;
  }
  broadcastToGroup(match.groupId, snapshotOf(match));
  return {
    ok: true,
    color: match.black.memberId === input.memberId ? 1 : 2,
  };
}

export type MoveResult =
  | { ok: true; win: boolean }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_player"
        | "not_your_turn"
        | "waiting_opponent"
        | "must_continue"
        | "must_capture"
        | "illegal_move";
    };

// 한 수(단일 이동 또는 한 번의 점프)를 둔다. 점프 후 추가 점프가 가능하면 턴을 유지한다.
export function applyMove(input: {
  groupId: string;
  memberId: string;
  from: number;
  to: number;
}): MoveResult {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  if (!match.white) return { ok: false, reason: "waiting_opponent" };

  const me =
    match.black.memberId === input.memberId
      ? match.black
      : match.white.memberId === input.memberId
        ? match.white
        : null;
  if (!me) return { ok: false, reason: "not_player" };
  if (match.turnMemberId !== input.memberId) {
    return { ok: false, reason: "not_your_turn" };
  }

  const { from, to } = input;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= CELLS ||
    to < 0 ||
    to >= CELLS
  ) {
    return { ok: false, reason: "illegal_move" };
  }

  const board = match.board;
  const piece = board[from];
  // 내 말이어야 한다
  if (piece === 0 || colorOf(piece) !== me.color) {
    return { ok: false, reason: "illegal_move" };
  }
  // 멀티 점프 중이면 그 말만 움직일 수 있다
  if (match.mustContinueFrom !== null && from !== match.mustContinueFrom) {
    return { ok: false, reason: "must_continue" };
  }

  const captures = capturesFrom(board, from);
  const capture = captures.find((m) => m.to === to);
  const mustCapture =
    match.mustContinueFrom !== null || hasAnyCapture(board, me.color);

  if (mustCapture) {
    // 잡을 수 있으면 반드시 잡아야 한다
    if (!capture) return { ok: false, reason: "must_capture" };
  } else {
    // 캡처 없는 상황에서는 단순 이동만 허용
    if (!simpleMovesFrom(board, from).includes(to)) {
      return { ok: false, reason: "illegal_move" };
    }
  }

  // 이동 적용
  board[to] = piece;
  board[from] = 0;
  if (capture) board[capture.captured] = 0;

  // 킹 승급(일반 말이 끝줄 도달)
  let promoted = false;
  if (!isKing(piece) && Math.floor(to / CHECKERS_SIZE) === promoteRow(me.color)) {
    board[to] = (me.color === 1 ? 3 : 4) as Cell;
    promoted = true;
  }

  match.lastMove = { from, to };

  // 멀티 점프 판정: 방금 캡처했고, 승급하지 않았고, 같은 말로 또 캡처 가능하면 턴 유지
  if (capture && !promoted && capturesFrom(board, to).length > 0) {
    match.mustContinueFrom = to;
    broadcastToGroup(match.groupId, {
      type: "piece_moved",
      board: board.slice(),
      lastMove: match.lastMove,
      nextTurnMemberId: me.memberId,
      mustContinueFrom: to,
    });
    return { ok: true, win: false };
  }

  // 턴 종료 → 상대에게 넘김
  match.mustContinueFrom = null;
  const opponent = me.color === 1 ? match.white : match.black;
  match.turnMemberId = opponent.memberId;
  broadcastToGroup(match.groupId, {
    type: "piece_moved",
    board: board.slice(),
    lastMove: match.lastMove,
    nextTurnMemberId: opponent.memberId,
    mustContinueFrom: null,
  });

  // 승패: 상대 말 전멸 또는 상대가 둘 수 없으면 내 승리
  const win =
    countColor(board, opponent.color) === 0 ||
    !hasAnyMove(board, opponent.color);
  if (win) endMatch(match, me, opponent);
  return { ok: true, win };
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
  if (!match.white) {
    // 상대 합류 전 — 시작한 사람이 접으면 판 취소
    if (match.black.memberId !== input.memberId) {
      return { ok: false, reason: "not_player" };
    }
    match.status = "ended";
    lobby.setGameRunning(match.groupId, false);
    broadcastToGroup(match.groupId, { type: "match_cancelled" });
    cleanupMatch(match);
    return { ok: true };
  }
  const loser =
    match.black.memberId === input.memberId
      ? match.black
      : match.white.memberId === input.memberId
        ? match.white
        : null;
  if (!loser) return { ok: false, reason: "not_player" };
  const winner = loser.color === 1 ? match.white : match.black;
  endMatch(match, winner, loser);
  return { ok: true };
}

function endMatch(
  match: CheckersMatch,
  winner: CheckersPlayer | null,
  loser: CheckersPlayer | null,
): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.waitTimer) clearTimeout(match.waitTimer);
  match.waitTimer = null;
  lobby.setGameRunning(match.groupId, false);

  const results: CheckersResult[] =
    winner && loser
      ? [
          {
            memberId: winner.memberId,
            nickname: winner.nickname,
            score: 1,
            rank: 1,
          },
          {
            memberId: loser.memberId,
            nickname: loser.nickname,
            score: 0,
            rank: 2,
          },
        ]
      : [match.black, match.white].filter(Boolean).map((p) => ({
          memberId: p!.memberId,
          nickname: p!.nickname,
          score: 0,
          rank: 1,
        }));
  match.results = results;

  broadcastToGroup(match.groupId, { type: "match_ended", results });

  if (match.onEnded && winner && loser) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("checkers onEnded failed", e);
      });
    } catch (e) {
      console.error("checkers onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) {
      cleanupMatch(match);
    }
  }, 8000);
}

function cleanupMatch(match: CheckersMatch): void {
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
): { unsubscribe: () => void; initialEvent: CheckersEvent } {
  channel.add(groupId, memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: CheckersEvent = match
    ? snapshotOf(match)
    : { type: "no_match" };

  const unsubscribe = () => {
    if (!channel.remove(groupId, memberId, fn)) return;
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

// 방 폭파 시 인메모리 판/구독 상태를 모두 정리한다.
export function destroyGroupCheckers(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  channel.clear(groupId);
  lobby.destroy(groupId);
}
