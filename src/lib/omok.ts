// 오목(15×15, 표준 룰·무금수·턴 무제한) — 인메모리 상태/이벤트 허브
// 사과게임(apple.ts)과 같은 패턴. 1:1 턴제라 서버가 전부 권위를 가진다:
//   - 착수 검증(차례/빈칸), 5목 판정, 기권 처리
//   - 시작자 + 첫 합류자 중 동전 던지기로 흑(선공)/백 배정. 나머지는 관전.

import { randomBytes } from "node:crypto";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export const OMOK_SIZE = 15;
const CELLS = OMOK_SIZE * OMOK_SIZE;

// 백(상대)이 이 시간 안에 합류하지 않으면 판을 취소한다.
const OPPONENT_WAIT_MS = 15_000;

export type OmokStatus = "running" | "ended";
export type StoneColor = 1 | 2; // 1=흑, 2=백

export type OmokPlayer = {
  memberId: string;
  nickname: string;
  color: StoneColor;
};

export type OmokResult = {
  memberId: string;
  nickname: string;
  score: number; // 승 1, 패 0 (점수판 최고점수 칸용)
  rank: number;
};

export type OmokSnapshot = {
  type: "snapshot";
  matchId: string;
  status: OmokStatus;
  startedAt: number;
  board: number[]; // 0=빈칸, 1=흑, 2=백 (row-major 15×15)
  black: OmokPlayer | null;
  white: OmokPlayer | null;
  turnMemberId: string | null; // null = 상대 대기 중
  lastMove: number | null; // 마지막 착수 인덱스
  results?: OmokResult[];
};

export type OmokEvent =
  | OmokSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | {
      type: "stone_placed";
      idx: number;
      color: StoneColor;
      nextTurnMemberId: string;
    }
  | { type: "match_ended"; results: OmokResult[] }
  | { type: "match_cancelled" } // 상대가 합류하지 않아 취소
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type Subscriber = (event: OmokEvent) => void;

type OmokMatch = {
  matchId: string;
  groupId: string;
  status: OmokStatus;
  startedAt: number;
  board: number[];
  black: OmokPlayer;
  white: OmokPlayer | null;
  turnMemberId: string | null;
  lastMove: number | null;
  moves: number;
  results: OmokResult[] | null;
  waitTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: OmokResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, OmokMatch>();
const groupSubscribers = new Map<string, Map<string, Subscriber>>();
// 자리비움 전환이 일어나면 로비 상태를 모두에게 다시 알린다.
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: OmokEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("omok subscriber error", e);
    }
  }
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

export function snapshotOf(match: OmokMatch): OmokSnapshot {
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    board: match.board,
    black: match.black,
    white: match.white,
    turnMemberId: match.turnMemberId,
    lastMove: match.lastMove,
    results: match.results ?? undefined,
  };
}

export function getMatch(groupId: string): OmokMatch | null {
  return matches.get(groupId) ?? null;
}

// 방장이 새 판을 시작한다(기존 판은 폐기). 흑이 되어 상대(백) 합류를 기다린다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: OmokResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const now = Date.now();
  const match: OmokMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    board: new Array<number>(CELLS).fill(0),
    black: {
      memberId: input.memberId,
      nickname: input.nickname,
      color: 1,
    },
    white: null,
    turnMemberId: null, // 백 합류 전에는 둘 수 없다
    lastMove: null,
    moves: 0,
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
  // 재연결: 이미 플레이어면 통과
  if (match.black.memberId === input.memberId) return { ok: true, color: 1 };
  if (match.white?.memberId === input.memberId) return { ok: true, color: 2 };
  if (match.white) return { ok: false, reason: "full" };

  const joiner: OmokPlayer = {
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
  // 색 배정이 바뀔 수 있으므로 전체 스냅샷으로 알린다
  broadcastToGroup(match.groupId, snapshotOf(match));
  return {
    ok: true,
    color: match.black.memberId === input.memberId ? 1 : 2,
  };
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// 방금 둔 돌 기준 4방향으로 5개 이상 연속이면 승리(장목 허용 표준 룰)
function isWinningMove(board: number[], idx: number, color: StoneColor): boolean {
  const r = Math.floor(idx / OMOK_SIZE);
  const c = idx % OMOK_SIZE;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (
        rr >= 0 &&
        rr < OMOK_SIZE &&
        cc >= 0 &&
        cc < OMOK_SIZE &&
        board[rr * OMOK_SIZE + cc] === color
      ) {
        count += 1;
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

export type PlaceResult =
  | { ok: true; win: boolean; draw: boolean }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_player"
        | "not_your_turn"
        | "waiting_opponent"
        | "occupied"
        | "bad_cell";
    };

export function placeStone(input: {
  groupId: string;
  memberId: string;
  idx: number;
}): PlaceResult {
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
  if (!Number.isInteger(input.idx) || input.idx < 0 || input.idx >= CELLS) {
    return { ok: false, reason: "bad_cell" };
  }
  if (match.board[input.idx] !== 0) return { ok: false, reason: "occupied" };

  match.board[input.idx] = me.color;
  match.lastMove = input.idx;
  match.moves += 1;
  const opponent = me.color === 1 ? match.white : match.black;
  match.turnMemberId = opponent.memberId;
  broadcastToGroup(match.groupId, {
    type: "stone_placed",
    idx: input.idx,
    color: me.color,
    nextTurnMemberId: opponent.memberId,
  });

  const win = isWinningMove(match.board, input.idx, me.color);
  const draw = !win && match.moves >= CELLS;
  if (win) {
    endMatch(match, me, opponent);
  } else if (draw) {
    endMatch(match, null, null);
  }
  return { ok: true, win, draw };
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
  match: OmokMatch,
  winner: OmokPlayer | null,
  loser: OmokPlayer | null,
): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.waitTimer) clearTimeout(match.waitTimer);
  match.waitTimer = null;
  lobby.setGameRunning(match.groupId, false);

  // 무승부(보드 가득참)는 둘 다 1위로 두되 기록은 남기지 않는다(사실상 발생 불가).
  const results: OmokResult[] =
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
        console.error("omok onEnded failed", e);
      });
    } catch (e) {
      console.error("omok onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) {
      cleanupMatch(match);
    }
  }, 8000);
}

function cleanupMatch(match: OmokMatch): void {
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
  fn: Subscriber,
): { unsubscribe: () => void; initialEvent: OmokEvent } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: OmokEvent = match
    ? snapshotOf(match)
    : { type: "no_match" };

  const unsubscribe = () => {
    const b = groupSubscribers.get(groupId);
    // 재연결로 더 최신 구독이 들어왔다면(이 fn이 현재 것이 아니면) 아무것도 정리하지 않는다.
    // 그렇지 않으면 접속 중인데도 로비에서 빠져 참가자 목록에서 사라진다.
    if (!b || b.get(memberId) !== fn) return;
    b.delete(memberId);
    if (b.size === 0) groupSubscribers.delete(groupId);
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

// 방 폭파 시 인메모리 판/구독 상태를 모두 정리한다.
export function destroyGroupOmok(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  groupSubscribers.delete(groupId);
  lobby.destroy(groupId);
}
