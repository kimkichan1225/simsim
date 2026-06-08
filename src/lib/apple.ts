// 사과게임(합 10 지우기) 그룹 대결 — 인메모리 상태/이벤트 허브
// 그룹 단위 실시간 동기화(상태/이벤트 허브)를 담당한다.
// 모두 같은 숫자판을 받고 각자 지운다(서버 권위):
//   - 보드 생성은 서버가 한 번만, 전원 동일한 판
//   - 지우기(드래그 범위)는 서버가 합=10 검증 후 확정
//   - 제한시간 종료 시 점수 순위 판정

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export const APPLE_COLS = 17;
export const APPLE_ROWS = 10;
export const APPLE_TARGET_SUM = 10;

const DURATION_SEC = 120;
// 시작 직후 이 시간 안에 들어온 요청만 합류 허용(도중 난입 방지).
const JOIN_GRACE_MS = 5000;

export type AppleStatus = "running" | "ended";

export type ApplePlayerView = {
  memberId: string;
  nickname: string;
  score: number;
  done: boolean; // 포기(중도 종료) — 점수는 그 시점으로 확정
};

export type AppleResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

export type AppleSnapshot = {
  type: "snapshot";
  matchId: string;
  status: AppleStatus;
  startedAt: number;
  endsAt: number;
  board: number[]; // row-major, APPLE_ROWS × APPLE_COLS, 값 1~9
  players: ApplePlayerView[];
  cleared: Record<string, number[]>; // memberId -> 지운 셀 인덱스(재접속 복원용)
  results?: AppleResult[];
};

export type AppleEvent =
  | AppleSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number; endsAt: number }
  | { type: "player_joined"; memberId: string; nickname: string }
  | { type: "player_done"; memberId: string }
  | { type: "cells_cleared"; memberId: string; cells: number[]; newScore: number }
  | { type: "match_ended"; results: AppleResult[] }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type ApplePlayer = {
  memberId: string;
  nickname: string;
  score: number;
  done: boolean; // 포기(중도 종료)
  cleared: boolean[]; // 셀 인덱스별 지움 여부
};

type AppleMatch = {
  matchId: string;
  groupId: string;
  status: AppleStatus;
  startedAt: number;
  endsAt: number;
  board: number[];
  players: Map<string, ApplePlayer>;
  results: AppleResult[] | null;
  endTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: AppleResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, AppleMatch>();
const channel = new GameChannel();
// 자리비움 전환이 일어나면 로비 상태를 모두에게 다시 알린다.
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: AppleEvent): void {
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

// 대기실에 해당 멤버 혼자만 있는지(방장이 아니어도 솔로 시작 허용용)
export function isAloneInLobby(groupId: string, memberId: string): boolean {
  return lobby.isAlone(groupId, memberId);
}

// 1~9 균등 분포 숫자판 생성(원작 방식)
function generateBoard(): number[] {
  const cells = APPLE_ROWS * APPLE_COLS;
  const board = new Array<number>(cells);
  for (let i = 0; i < cells; i += 1) {
    board[i] = 1 + Math.floor(Math.random() * 9);
  }
  return board;
}

function newPlayer(memberId: string, nickname: string): ApplePlayer {
  return {
    memberId,
    nickname,
    score: 0,
    done: false,
    cleared: new Array<boolean>(APPLE_ROWS * APPLE_COLS).fill(false),
  };
}

function playerView(p: ApplePlayer): ApplePlayerView {
  return {
    memberId: p.memberId,
    nickname: p.nickname,
    score: p.score,
    done: p.done,
  };
}

function clearedIndices(p: ApplePlayer): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.cleared.length; i += 1) {
    if (p.cleared[i]) out.push(i);
  }
  return out;
}

export function snapshotOf(match: AppleMatch): AppleSnapshot {
  const cleared: Record<string, number[]> = {};
  for (const p of match.players.values()) {
    cleared[p.memberId] = clearedIndices(p);
  }
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    board: match.board,
    players: [...match.players.values()].map(playerView),
    cleared,
    results: match.results ?? undefined,
  };
}

export function getMatch(groupId: string): AppleMatch | null {
  return matches.get(groupId) ?? null;
}

// 방장이 새 대결을 시작한다(기존 대결은 폐기). 참가자는 joinMatch로 합류한다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: AppleResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number; endsAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) {
    if (existing.status === "running") {
      endMatch(existing);
    }
    cleanupMatch(existing);
  }

  const now = Date.now();
  const match: AppleMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    endsAt: now + DURATION_SEC * 1000,
    board: generateBoard(),
    players: new Map([
      [input.memberId, newPlayer(input.memberId, input.nickname)],
    ]),
    results: null,
    endTimer: null,
    onEnded: input.onEnded,
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
    endsAt: match.endsAt,
  });
  broadcastToGroup(match.groupId, snapshotOf(match));
  match.endTimer = setTimeout(() => {
    const current = matches.get(input.groupId);
    if (current === match) endMatch(match);
  }, DURATION_SEC * 1000);
  return { matchId: match.matchId, startedAt: match.startedAt, endsAt: match.endsAt };
}

// 진행 중인 대결에 합류한다(새 대결은 만들지 않는다).
export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): {
  ok: boolean;
  reason?: "no_match" | "in_progress";
  matchId?: string;
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
    match.players.set(
      input.memberId,
      newPlayer(input.memberId, input.nickname),
    );
    broadcastToGroup(match.groupId, {
      type: "player_joined",
      memberId: input.memberId,
      nickname: input.nickname,
    });
  }
  return { ok: true, matchId: match.matchId };
}

export type ClearResult =
  | { ok: true; cells: number[]; newScore: number }
  | {
      ok: false;
      reason: "not_running" | "not_participant" | "bad_rect" | "sum_mismatch";
    };

// 드래그 범위(셀 사각형) 지우기 — 범위 내 남은 숫자 합이 정확히 10이면
// 그 셀들을 지우고 지운 개수만큼 점수를 준다(원작 규칙).
export function clearRect(input: {
  groupId: string;
  memberId: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}): ClearResult {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  if (Date.now() >= match.endsAt) {
    endMatch(match);
    return { ok: false, reason: "not_running" };
  }
  const player = match.players.get(input.memberId);
  if (!player || player.done) return { ok: false, reason: "not_participant" };

  const rMin = Math.min(input.r1, input.r2);
  const rMax = Math.max(input.r1, input.r2);
  const cMin = Math.min(input.c1, input.c2);
  const cMax = Math.max(input.c1, input.c2);
  if (rMin < 0 || rMax >= APPLE_ROWS || cMin < 0 || cMax >= APPLE_COLS) {
    return { ok: false, reason: "bad_rect" };
  }

  let sum = 0;
  const cells: number[] = [];
  for (let r = rMin; r <= rMax; r += 1) {
    for (let c = cMin; c <= cMax; c += 1) {
      const idx = r * APPLE_COLS + c;
      if (player.cleared[idx]) continue;
      sum += match.board[idx];
      cells.push(idx);
      if (sum > APPLE_TARGET_SUM) return { ok: false, reason: "sum_mismatch" };
    }
  }
  if (sum !== APPLE_TARGET_SUM || cells.length === 0) {
    return { ok: false, reason: "sum_mismatch" };
  }

  for (const idx of cells) player.cleared[idx] = true;
  player.score += cells.length;
  broadcastToGroup(match.groupId, {
    type: "cells_cleared",
    memberId: player.memberId,
    cells,
    newScore: player.score,
  });
  return { ok: true, cells, newScore: player.score };
}

// 포기(중도 종료) — 점수는 그 시점으로 확정하고 빠진다.
// 전원이 포기하면 매치를 즉시 종료한다(혼자면 바로 종료).
export function giveUp(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_participant" } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  const player = match.players.get(input.memberId);
  if (!player) return { ok: false, reason: "not_participant" };
  if (!player.done) {
    player.done = true;
    broadcastToGroup(match.groupId, {
      type: "player_done",
      memberId: player.memberId,
    });
    const allDone = [...match.players.values()].every((p) => p.done);
    if (allDone) endMatch(match);
  }
  return { ok: true };
}

function endMatch(match: AppleMatch): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.endTimer) clearTimeout(match.endTimer);
  match.endTimer = null;
  // 대결 종료 → 자리비움(idle) 판정 재개
  lobby.setGameRunning(match.groupId, false);

  const results: AppleResult[] = [...match.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      memberId: p.memberId,
      nickname: p.nickname,
      score: p.score,
      rank: i + 1,
    }));
  match.results = results;

  broadcastToGroup(match.groupId, { type: "match_ended", results });

  if (match.onEnded) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("apple onEnded failed", e);
      });
    } catch (e) {
      console.error("apple onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) {
      cleanupMatch(match);
    }
  }, 8000);
}

function cleanupMatch(match: AppleMatch): void {
  if (match.endTimer) clearTimeout(match.endTimer);
  match.endTimer = null;
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
): { unsubscribe: () => void; initialEvent: AppleEvent } {
  channel.add(groupId, memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: AppleEvent = match
    ? snapshotOf(match)
    : { type: "no_match" };

  const unsubscribe = () => {
    // 재연결로 더 최신 구독이 들어왔으면 remove가 false → 정리하지 않는다.
    if (!channel.remove(groupId, memberId, fn)) return;
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

// 방 폭파 시 인메모리 대결/구독 상태를 모두 정리한다.
export function destroyGroupApple(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  channel.clear(groupId);
  lobby.destroy(groupId);
}
