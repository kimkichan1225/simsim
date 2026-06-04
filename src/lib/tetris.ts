// 테트리스 그룹 대결 — 인메모리 상태/이벤트 허브
// 단어줍기(multiplayer.ts)와 같은 패턴으로, 그룹 단위 실시간 동기화를 담당한다.
// 보드 진행은 각 클라이언트가 로컬 엔진으로 굴리고, 서버는
//   - 보드 스냅샷 중계(상대 미니뷰)
//   - 공격(방해 줄) 중계
//   - 탈락/생존 순위 판정
// 만 담당하는 권위-경량 구조다.

import { randomBytes } from "node:crypto";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export const TETRIS_COLS = 10;
export const TETRIS_ROWS = 20;

// 보드 셀: null(빈칸) 또는 조각 타입 문자열. 검증 시 화이트리스트로 사용.
export const CELL_TYPES = ["I", "O", "T", "S", "Z", "J", "L", "garbage"] as const;
export type CellType = (typeof CELL_TYPES)[number];
export type Board = (CellType | null)[][];

export type TetrisStatus = "running" | "ended";

export type TetrisPlayerView = {
  memberId: string;
  nickname: string;
  alive: boolean;
  score: number;
};

export type TetrisResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number; // 1 = 최후 생존자(승)
  survived: boolean;
};

export type TetrisSnapshot = {
  type: "snapshot";
  matchId: string;
  status: TetrisStatus;
  startedAt: number;
  players: TetrisPlayerView[];
  boards: Record<string, Board>; // memberId -> 마지막 보드 스냅샷
  results?: TetrisResult[];
};

export type TetrisEvent =
  | TetrisSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | { type: "player_joined"; memberId: string; nickname: string }
  | { type: "player_board"; memberId: string; board: Board }
  | {
      type: "player_attack";
      fromMemberId: string;
      targetMemberId: string;
      lines: number;
    }
  | { type: "player_out"; memberId: string; rank: number; score: number }
  | { type: "match_ended"; results: TetrisResult[] }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type Subscriber = (event: TetrisEvent) => void;

type TetrisPlayer = {
  memberId: string;
  nickname: string;
  alive: boolean;
  score: number;
  rank: number | null; // 탈락 시 확정
  board: Board | null;
};

type TetrisMatch = {
  matchId: string;
  groupId: string;
  status: TetrisStatus;
  startedAt: number;
  players: Map<string, TetrisPlayer>;
  results: TetrisResult[] | null;
  onEnded?: (results: TetrisResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, TetrisMatch>();
const groupSubscribers = new Map<string, Map<string, Subscriber>>();
// 자리비움 전환이 일어나면 로비 상태를 모두에게 다시 알린다.
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: TetrisEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("tetris subscriber error", e);
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

// 대기실에 해당 멤버 혼자만 있는지(방장이 아니어도 솔로 시작 허용용)
export function isAloneInLobby(groupId: string, memberId: string): boolean {
  return lobby.isAlone(groupId, memberId);
}

function playerView(p: TetrisPlayer): TetrisPlayerView {
  return {
    memberId: p.memberId,
    nickname: p.nickname,
    alive: p.alive,
    score: p.score,
  };
}

function snapshotOf(match: TetrisMatch): TetrisSnapshot {
  const boards: Record<string, Board> = {};
  for (const p of match.players.values()) {
    if (p.board) boards[p.memberId] = p.board;
  }
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    players: [...match.players.values()].map(playerView),
    boards,
    results: match.results ?? undefined,
  };
}

export function getMatch(groupId: string): TetrisMatch | null {
  return matches.get(groupId) ?? null;
}

function aliveCount(match: TetrisMatch): number {
  let n = 0;
  for (const p of match.players.values()) if (p.alive) n += 1;
  return n;
}

// 방장이 새 대결을 시작한다(기존 대결은 폐기). 참가자는 joinMatch로 합류한다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: TetrisResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const now = Date.now();
  const match: TetrisMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    onEnded: input.onEnded,
    players: new Map([
      [
        input.memberId,
        {
          memberId: input.memberId,
          nickname: input.nickname,
          alive: true,
          score: 0,
          rank: null,
          board: null,
        },
      ],
    ]),
    results: null,
  };
  matches.set(input.groupId, match);
  // 대결 진행 중에는 자리비움(idle) 판정을 멈춘다
  lobby.setGameRunning(input.groupId, true);
  // 새 대결 시작 → 준비 상태 초기화
  lobby.clearReady(input.groupId);
  broadcastLobby(input.groupId);
  broadcastToGroup(match.groupId, {
    type: "match_started",
    matchId: match.matchId,
    startedAt: match.startedAt,
  });
  broadcastToGroup(match.groupId, snapshotOf(match));
  return { matchId: match.matchId, startedAt: match.startedAt };
}

// 시작 직후 이 시간 안에 들어온 요청만 합류 허용(도중 난입 방지).
const JOIN_GRACE_MS = 5000;

// 진행 중인 대결에 합류한다(새 대결은 만들지 않는다).
export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): {
  ok: boolean;
  reason?: "no_match" | "in_progress";
  matchId?: string;
  startedAt?: number;
} {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "no_match" };
  }
  // 이미 참가자면 통과(재연결 등). 신규 합류는 시작 직후 유예시간 내에서만 허용.
  if (
    !match.players.has(input.memberId) &&
    Date.now() - match.startedAt > JOIN_GRACE_MS
  ) {
    return { ok: false, reason: "in_progress" };
  }
  if (!match.players.has(input.memberId)) {
    match.players.set(input.memberId, {
      memberId: input.memberId,
      nickname: input.nickname,
      alive: true,
      score: 0,
      rank: null,
      board: null,
    });
    broadcastToGroup(match.groupId, {
      type: "player_joined",
      memberId: input.memberId,
      nickname: input.nickname,
    });
  }
  return { ok: true, matchId: match.matchId, startedAt: match.startedAt };
}

// 내 보드 스냅샷을 올린다 → 상대 미니뷰로 중계. 점수도 함께 갱신.
export function pushBoard(input: {
  groupId: string;
  memberId: string;
  board: Board;
  score: number;
}): { ok: boolean } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") return { ok: false };
  const p = match.players.get(input.memberId);
  if (!p) return { ok: false };
  p.board = input.board;
  p.score = input.score;
  broadcastToGroup(match.groupId, {
    type: "player_board",
    memberId: input.memberId,
    board: input.board,
  });
  return { ok: true };
}

// 공격(방해 줄) 발사 → 지정한 타겟 1명에게 중계.
// 타겟이 무효(미지정/탈락/본인)면 살아있는 다른 참가자 중 무작위 1명을 고른다.
// 실제 줄 적립은 수신 클라이언트가 다음 고정 때 처리한다(권위 경량).
export function sendAttack(input: {
  groupId: string;
  memberId: string;
  lines: number;
  targetMemberId?: string;
}): { ok: boolean } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") return { ok: false };
  const p = match.players.get(input.memberId);
  if (!p || !p.alive) return { ok: false };

  let target = input.targetMemberId
    ? match.players.get(input.targetMemberId)
    : undefined;
  if (!target || !target.alive || target.memberId === input.memberId) {
    const candidates = [...match.players.values()].filter(
      (x) => x.alive && x.memberId !== input.memberId,
    );
    if (candidates.length === 0) return { ok: true }; // 공격할 상대가 없음
    target = candidates[Math.floor(Math.random() * candidates.length)];
  }

  broadcastToGroup(match.groupId, {
    type: "player_attack",
    fromMemberId: input.memberId,
    targetMemberId: target.memberId,
    lines: input.lines,
  });
  return { ok: true };
}

// 내가 탑아웃(탈락)했음을 보고한다 → 순위 확정, 남은 인원에 따라 종료 판정.
export function reportOut(input: {
  groupId: string;
  memberId: string;
  score: number;
}): { ok: boolean; rank?: number } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") return { ok: false };
  const p = match.players.get(input.memberId);
  if (!p || !p.alive) return { ok: false };

  const rankAtDeath = aliveCount(match); // 탈락 시점 생존 수 = 이 사람 순위
  p.alive = false;
  p.score = input.score;
  p.rank = rankAtDeath;
  broadcastToGroup(match.groupId, {
    type: "player_out",
    memberId: input.memberId,
    rank: rankAtDeath,
    score: input.score,
  });

  const remaining = aliveCount(match);
  const total = match.players.size;
  // 혼자 남으면(2인 이상 대결) 그 사람이 우승. 전원 탈락(혹은 1인 대결)이면 그대로 종료.
  if (remaining === 0 || (remaining === 1 && total >= 2)) {
    endMatch(match);
  }
  return { ok: true, rank: rankAtDeath };
}

function endMatch(match: TetrisMatch): void {
  if (match.status === "ended") return;
  match.status = "ended";
  // 대결 종료 → 자리비움(idle) 판정 재개
  lobby.setGameRunning(match.groupId, false);

  // 마지막 생존자에게 1위를 부여하고, 나머지는 탈락 시 확정한 순위 사용.
  for (const p of match.players.values()) {
    if (p.alive) {
      p.alive = false;
      if (p.rank == null) p.rank = 1;
    }
  }
  const results: TetrisResult[] = [...match.players.values()]
    .map((p) => ({
      memberId: p.memberId,
      nickname: p.nickname,
      score: p.score,
      rank: p.rank ?? 1,
      survived: false,
    }))
    .sort((a, b) => a.rank - b.rank);
  // 1위는 생존자로 표기(2인 이상일 때만 의미)
  if (results.length > 0 && match.players.size >= 2) {
    results[0].survived = true;
  }
  match.results = results;

  broadcastToGroup(match.groupId, { type: "match_ended", results });

  if (match.onEnded) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("tetris onEnded failed", e);
      });
    } catch (e) {
      console.error("tetris onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) {
      matches.delete(match.groupId);
    }
  }, 8000);
}

function cleanupMatch(match: TetrisMatch): void {
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
): { unsubscribe: () => void; initialEvent: TetrisEvent } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: TetrisEvent = match
    ? snapshotOf(match)
    : { type: "no_match" };

  const unsubscribe = () => {
    const b = groupSubscribers.get(groupId);
    if (b && b.get(memberId) === fn) {
      b.delete(memberId);
      if (b.size === 0) groupSubscribers.delete(groupId);
    }
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

// 방 폭파 시 인메모리 대결/구독 상태를 모두 정리한다.
export function destroyGroupTetris(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) matches.delete(groupId);
  groupSubscribers.delete(groupId);
  lobby.destroy(groupId);
}
