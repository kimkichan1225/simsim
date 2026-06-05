// 루미큐브(2~4인 턴제) — 인메모리 상태/이벤트 허브
// 표준 룰: 106타일(1~13 × 4색 × 2 + 조커 2), 시작 14장, 첫 등록 30점,
// 그룹(같은 수·다른 색 3~4장) / 런(같은 색 연속 3장+), 조커 자유 대체.
// 턴 무제한. 손이 먼저 빈 사람이 승리, 더미 소진 후 전원 패스면 남은 합 최소가 승리.
//
// 서버가 전부 권위를 가진다:
//   - 더미/손패/테이블 상태 보관 (손패는 본인에게만 개인화 스냅샷으로 전송)
//   - 턴 제출(테이블 전체 배치) 검증: 타일 보존, 세트 유효성, 첫 등록 30점
//   - 뽑기/패스, 기권, 종료·점수 판정

import { randomBytes } from "node:crypto";
import { GroupLobby, type LobbyMemberView } from "./lobby";
import {
  INITIAL_MELD_POINTS,
  rackPenalty,
  validateSet,
  type RummyTile,
} from "./rummy-rules";

export type { RummyTile } from "./rummy-rules";

export const RUMMY_MAX_PLAYERS = 4;
const INITIAL_HAND = 14;
// 시작 후 이 시간 동안 합류를 받고, 지나면 타일을 돌리고 시작한다.
const JOIN_WINDOW_MS = 8_000;

export type RummyStatus = "joining" | "running" | "ended";

export type RummyPlayerView = {
  memberId: string;
  nickname: string;
  rackCount: number;
  hasMelded: boolean;
  resigned: boolean;
};

export type RummyResult = {
  memberId: string;
  nickname: string;
  score: number; // 승자: 상대 잔여 합, 패자: 0
  rank: number;
  remaining: number; // 손에 남은 타일 합(벌점)
};

export type RummySnapshot = {
  type: "snapshot";
  matchId: string;
  status: RummyStatus;
  startedAt: number;
  players: RummyPlayerView[]; // 배열 순서 = 턴 순서
  turnMemberId: string | null;
  table: RummyTile[][];
  liveTable: RummyTile[][] | null; // 턴 플레이어가 배치 중인 테이블(실시간 미리보기)
  liveDraggingId: string | null; // 턴 플레이어가 드는 중인 테이블 타일(상대에겐 뒷면)
  myRack: RummyTile[]; // 수신자 전용(관전자는 빈 배열)
  myLastDrawnId: string | null; // 수신자 전용 — 마지막으로 뽑은 타일
  poolCount: number;
  consecutivePasses: number;
  results?: RummyResult[];
};

export type RummyEvent =
  | RummySnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | { type: "match_cancelled" } // 인원 미달 취소
  | { type: "match_ended"; results: RummyResult[] }
  | {
      type: "live";
      memberId: string;
      table: RummyTile[][];
      dragging: string | null; // 드는 중인 테이블 타일(뒷면 처리용)
    } // 턴 플레이어의 배치 미리보기
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type Subscriber = (event: RummyEvent) => void;

type RummyPlayer = {
  memberId: string;
  nickname: string;
  rack: Map<string, RummyTile>;
  hasMelded: boolean;
  resigned: boolean;
  lastDrawn: string | null; // 마지막으로 뽑은 타일(본인 강조 표시용)
};

type RummyMatch = {
  matchId: string;
  groupId: string;
  status: RummyStatus;
  startedAt: number;
  players: Map<string, RummyPlayer>; // 삽입 순서 = 턴 순서
  order: string[];
  turnIdx: number;
  pool: RummyTile[];
  table: RummyTile[][];
  liveTable: RummyTile[][] | null; // 턴 플레이어가 제출 전 배치 중인 테이블
  liveDragging: string | null; // 턴 플레이어가 드는 중인 테이블 타일
  consecutivePasses: number;
  results: RummyResult[] | null;
  dealTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: RummyResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, RummyMatch>();
const groupSubscribers = new Map<string, Map<string, Subscriber>>();
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: RummyEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("rummy subscriber error", e);
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

// ---------- 타일/세트 룰 ----------

function buildPool(): RummyTile[] {
  const tiles: RummyTile[] = [];
  let i = 0;
  for (let copy = 0; copy < 2; copy += 1) {
    for (let color = 0; color < 4; color += 1) {
      for (let value = 1; value <= 13; value += 1) {
        tiles.push({ id: `t${i++}`, color, value, joker: false });
      }
    }
  }
  tiles.push({ id: `t${i++}`, color: -1, value: 0, joker: true });
  tiles.push({ id: `t${i++}`, color: -1, value: 0, joker: true });
  // Fisher–Yates 셔플
  for (let j = tiles.length - 1; j > 0; j -= 1) {
    const k = Math.floor(Math.random() * (j + 1));
    [tiles[j], tiles[k]] = [tiles[k], tiles[j]];
  }
  return tiles;
}

// ---------- 스냅샷 ----------

function playerView(p: RummyPlayer): RummyPlayerView {
  return {
    memberId: p.memberId,
    nickname: p.nickname,
    rackCount: p.rack.size,
    hasMelded: p.hasMelded,
    resigned: p.resigned,
  };
}

export function snapshotFor(
  match: RummyMatch,
  memberId: string,
): RummySnapshot {
  const me = match.players.get(memberId);
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    startedAt: match.startedAt,
    players: match.order
      .map((id) => match.players.get(id))
      .filter(Boolean)
      .map((p) => playerView(p!)),
    turnMemberId:
      match.status === "running" ? (match.order[match.turnIdx] ?? null) : null,
    table: match.table,
    liveTable: match.liveTable,
    liveDraggingId: match.liveDragging,
    myRack: me ? [...me.rack.values()] : [],
    myLastDrawnId: me?.lastDrawn ?? null,
    poolCount: match.pool.length,
    consecutivePasses: match.consecutivePasses,
    results: match.results ?? undefined,
  };
}

// 모든 구독자에게 각자의 개인화 스냅샷을 보낸다(손패는 본인 것만).
function broadcastSnapshots(match: RummyMatch): void {
  const subs = groupSubscribers.get(match.groupId);
  if (!subs) return;
  for (const [memberId, fn] of subs) {
    try {
      fn(snapshotFor(match, memberId));
    } catch (e) {
      console.error("rummy subscriber error", e);
    }
  }
}

export function getMatch(groupId: string): RummyMatch | null {
  return matches.get(groupId) ?? null;
}

// ---------- 진행 ----------

// 방장이 판을 연다. 합류 창(8초) 동안 2~4명을 모은 뒤 타일을 돌린다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: RummyResult[], groupId: string) => Promise<void> | void;
}): { matchId: string; startedAt: number } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const now = Date.now();
  const match: RummyMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "joining",
    startedAt: now,
    players: new Map(),
    order: [],
    turnIdx: 0,
    pool: buildPool(),
    table: [],
    liveTable: null,
    liveDragging: null,
    consecutivePasses: 0,
    results: null,
    dealTimer: null,
    onEnded: input.onEnded,
  };
  addPlayer(match, input.memberId, input.nickname);
  matches.set(input.groupId, match);
  lobby.setGameRunning(input.groupId, true);
  lobby.clearReady(input.groupId);
  broadcastLobby(input.groupId);
  broadcastToGroup(match.groupId, {
    type: "match_started",
    matchId: match.matchId,
    startedAt: match.startedAt,
  });
  broadcastSnapshots(match);

  match.dealTimer = setTimeout(() => {
    const current = matches.get(input.groupId);
    if (current !== match || match.status !== "joining") return;
    if (activePlayers(match).length < 2) {
      // 인원 미달 — 취소
      match.status = "ended";
      lobby.setGameRunning(match.groupId, false);
      broadcastToGroup(match.groupId, { type: "match_cancelled" });
      cleanupMatch(match);
      return;
    }
    deal(match);
  }, JOIN_WINDOW_MS);

  return { matchId: match.matchId, startedAt: match.startedAt };
}

function addPlayer(match: RummyMatch, memberId: string, nickname: string): void {
  match.players.set(memberId, {
    memberId,
    nickname,
    rack: new Map(),
    hasMelded: false,
    resigned: false,
    lastDrawn: null,
  });
  match.order.push(memberId);
}

export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): { ok: boolean; reason?: "no_match" | "in_progress" | "full" } {
  const match = matches.get(input.groupId);
  if (!match || match.status === "ended") {
    return { ok: false, reason: "no_match" };
  }
  if (match.players.has(input.memberId)) return { ok: true }; // 재연결
  if (match.status !== "joining") return { ok: false, reason: "in_progress" };
  if (match.players.size >= RUMMY_MAX_PLAYERS) {
    return { ok: false, reason: "full" };
  }
  addPlayer(match, input.memberId, input.nickname);
  broadcastSnapshots(match);
  // 4명이 차면 바로 시작
  if (match.players.size >= RUMMY_MAX_PLAYERS) {
    if (match.dealTimer) clearTimeout(match.dealTimer);
    match.dealTimer = null;
    deal(match);
  }
  return { ok: true };
}

function deal(match: RummyMatch): void {
  for (const p of match.players.values()) {
    if (p.resigned) continue; // 합류 창에서 빠진 사람은 제외
    for (let i = 0; i < INITIAL_HAND; i += 1) {
      const tile = match.pool.pop();
      if (tile) p.rack.set(tile.id, tile);
    }
  }
  match.status = "running";
  // 턴 순서를 랜덤으로 섞는다 — 방장이 항상 선이 되지 않도록 (Fisher–Yates)
  for (let i = match.order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [match.order[i], match.order[j]] = [match.order[j], match.order[i]];
  }
  // 첫 차례는 기권하지 않은 첫 참가자
  match.turnIdx = match.order.findIndex(
    (id) => !match.players.get(id)!.resigned,
  );
  broadcastSnapshots(match);
}

function activePlayers(match: RummyMatch): RummyPlayer[] {
  return match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => !p.resigned);
}

function advanceTurn(match: RummyMatch): void {
  match.liveTable = null; // 턴이 넘어가면 배치 미리보기 폐기
  match.liveDragging = null;
  if (activePlayers(match).length === 0) return;
  do {
    match.turnIdx = (match.turnIdx + 1) % match.order.length;
  } while (match.players.get(match.order[match.turnIdx])!.resigned);
}

export type PlayResult =
  | { ok: true; won: boolean }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_player"
        | "not_your_turn"
        | "unknown_tile"
        | "duplicate_tile"
        | "table_tile_missing"
        | "no_tiles_played"
        | "invalid_set"
        | "first_meld_table_touched"
        | "first_meld_under_30";
    };

// 턴 제출 — 새 테이블 배치(타일 ID 2차원 배열)를 통째로 검증한다.
export function playTurn(input: {
  groupId: string;
  memberId: string;
  tableIds: string[][];
}): PlayResult {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  const me = match.players.get(input.memberId);
  if (!me || me.resigned) return { ok: false, reason: "not_player" };
  if (match.order[match.turnIdx] !== input.memberId) {
    return { ok: false, reason: "not_your_turn" };
  }

  // 사용할 수 있는 타일 = 현재 테이블 + 내 손패
  const available = new Map<string, RummyTile>();
  for (const set of match.table) for (const t of set) available.set(t.id, t);
  for (const t of me.rack.values()) available.set(t.id, t);

  // 제출 배치를 타일로 복원 (중복/미지 타일 검사)
  const seen = new Set<string>();
  const newTable: RummyTile[][] = [];
  for (const setIds of input.tableIds) {
    const set: RummyTile[] = [];
    for (const id of setIds) {
      const tile = available.get(id);
      if (!tile) return { ok: false, reason: "unknown_tile" };
      if (seen.has(id)) return { ok: false, reason: "duplicate_tile" };
      seen.add(id);
      set.push(tile);
    }
    if (set.length > 0) newTable.push(set);
  }

  // 테이블 타일은 사라질 수 없다(손으로 회수 불가)
  for (const set of match.table) {
    for (const t of set) {
      if (!seen.has(t.id)) return { ok: false, reason: "table_tile_missing" };
    }
  }

  // 새로 낸 타일 = 제출 배치 중 내 손패에서 나온 것
  const placed: RummyTile[] = [];
  for (const id of seen) {
    if (me.rack.has(id)) placed.push(me.rack.get(id)!);
  }
  if (placed.length === 0) return { ok: false, reason: "no_tiles_played" };

  // 모든 세트 유효성 검사
  const setInfos = newTable.map((set) => ({ set, ...validateSet(set) }));
  if (setInfos.some((s) => !s.ok)) return { ok: false, reason: "invalid_set" };

  // 첫 등록: 기존 테이블을 건드리지 않고, 새 세트(전부 내 타일)만으로 30점 이상
  if (!me.hasMelded) {
    const oldSetKeys = new Set(
      match.table.map((set) =>
        set
          .map((t) => t.id)
          .sort()
          .join(","),
      ),
    );
    const placedIds = new Set(placed.map((t) => t.id));
    let newPoints = 0;
    for (const info of setInfos) {
      const key = info.set
        .map((t) => t.id)
        .sort()
        .join(",");
      if (oldSetKeys.has(key)) {
        oldSetKeys.delete(key);
        continue; // 기존 세트 그대로
      }
      // 새 세트는 전부 이번에 낸 타일이어야 한다
      if (!info.set.every((t) => placedIds.has(t.id))) {
        return { ok: false, reason: "first_meld_table_touched" };
      }
      newPoints += info.points;
    }
    if (oldSetKeys.size > 0) {
      // 기존 세트가 변형됨 — 첫 등록에서는 금지
      return { ok: false, reason: "first_meld_table_touched" };
    }
    if (newPoints < INITIAL_MELD_POINTS) {
      return { ok: false, reason: "first_meld_under_30" };
    }
  }

  // 확정
  match.table = newTable;
  for (const t of placed) me.rack.delete(t.id);
  me.hasMelded = true;
  me.lastDrawn = null; // 턴을 제출했으면 뽑은 타일 강조 해제
  match.consecutivePasses = 0;

  if (me.rack.size === 0) {
    endMatch(match, me);
    return { ok: true, won: true };
  }
  advanceTurn(match);
  broadcastSnapshots(match);
  return { ok: true, won: false };
}

// 턴 플레이어가 배치 중인 테이블을 실시간 공유한다(검증은 타일 존재만, 세트 유효성은 안 본다).
export function updateLive(input: {
  groupId: string;
  memberId: string;
  tableIds: string[][];
  draggingId?: string | null;
}): { ok: boolean } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") return { ok: false };
  const me = match.players.get(input.memberId);
  if (!me || me.resigned) return { ok: false };
  if (match.order[match.turnIdx] !== input.memberId) return { ok: false };

  // 제출 가능한 타일(현재 테이블 + 본인 손패)로만 구성됐는지 확인
  const available = new Map<string, RummyTile>();
  for (const set of match.table) for (const t of set) available.set(t.id, t);
  for (const t of me.rack.values()) available.set(t.id, t);

  const seen = new Set<string>();
  const liveTable: RummyTile[][] = [];
  for (const setIds of input.tableIds) {
    const set: RummyTile[] = [];
    for (const id of setIds) {
      const tile = available.get(id);
      if (!tile || seen.has(id)) return { ok: false };
      seen.add(id);
      set.push(tile);
    }
    if (set.length > 0) liveTable.push(set);
  }

  match.liveTable = liveTable;
  // 드는 중 타일은 미리보기 테이블에 있는 것만 인정한다.
  // (손패 타일 id는 값이 유추될 수 있으므로 밖으로 내보내지 않는다)
  match.liveDragging =
    input.draggingId && seen.has(input.draggingId) ? input.draggingId : null;
  broadcastToGroup(match.groupId, {
    type: "live",
    memberId: input.memberId,
    table: liveTable,
    dragging: match.liveDragging,
  });
  return { ok: true };
}

// 뽑고 패스(낼 게 없을 때). 더미가 비었으면 그냥 패스.
export function drawAndPass(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_player" | "not_your_turn" } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  const me = match.players.get(input.memberId);
  if (!me || me.resigned) return { ok: false, reason: "not_player" };
  if (match.order[match.turnIdx] !== input.memberId) {
    return { ok: false, reason: "not_your_turn" };
  }

  const tile = match.pool.pop();
  if (tile) {
    me.rack.set(tile.id, tile);
    me.lastDrawn = tile.id; // 방금 뽑은 타일 — 본인 손패에서 강조
    match.consecutivePasses = 0; // 뽑으면 패스 카운트 리셋(교착은 더미 소진 후만)
  } else {
    match.consecutivePasses += 1;
    // 더미가 비고 전원이 연속 패스 → 남은 합 최소가 승리
    if (match.consecutivePasses >= activePlayers(match).length) {
      endMatch(match, null);
      return { ok: true };
    }
  }
  advanceTurn(match);
  broadcastSnapshots(match);
  return { ok: true };
}

// 기권 — 남은 한 명이 되면 그 사람이 승리.
export function resign(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_player" } {
  const match = matches.get(input.groupId);
  if (!match || match.status === "ended") {
    return { ok: false, reason: "not_running" };
  }
  const me = match.players.get(input.memberId);
  if (!me || me.resigned) return { ok: false, reason: "not_player" };

  me.resigned = true;
  const remaining = activePlayers(match);

  if (match.status === "joining") {
    // 합류 창 중 기권 — 인원에서 빠지기만 한다(시작자가 나가도 창은 유지)
    broadcastSnapshots(match);
    return { ok: true };
  }
  if (remaining.length <= 1) {
    endMatch(match, remaining[0] ?? null);
    return { ok: true };
  }
  if (match.order[match.turnIdx] === input.memberId) {
    advanceTurn(match);
  }
  match.consecutivePasses = 0;
  broadcastSnapshots(match);
  return { ok: true };
}

function endMatch(match: RummyMatch, winner: RummyPlayer | null): void {
  if (match.status === "ended") return;
  match.status = "ended";
  match.liveTable = null;
  match.liveDragging = null;
  if (match.dealTimer) clearTimeout(match.dealTimer);
  match.dealTimer = null;
  lobby.setGameRunning(match.groupId, false);

  // 합류 창에서 빠진(타일을 받지 않은) 사람은 결과에서 제외
  const players = match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => !(p.resigned && p.rack.size === 0 && !p.hasMelded));
  // 더미 소진 교착 종료면 남은 합 최소가 승자
  const resolvedWinner =
    winner ??
    activePlayers(match).sort(
      (a, b) => rackPenalty(a.rack.values()) - rackPenalty(b.rack.values()),
    )[0] ??
    null;

  const losers = players
    .filter((p) => p !== resolvedWinner)
    .sort((a, b) => {
      // 기권자는 뒤로, 나머지는 남은 합 적은 순
      if (a.resigned !== b.resigned) return a.resigned ? 1 : -1;
      return rackPenalty(a.rack.values()) - rackPenalty(b.rack.values());
    });
  const winnerScore = losers.reduce(
    (sum, p) => sum + rackPenalty(p.rack.values()),
    0,
  );

  const results: RummyResult[] = [];
  if (resolvedWinner) {
    results.push({
      memberId: resolvedWinner.memberId,
      nickname: resolvedWinner.nickname,
      score: winnerScore,
      rank: 1,
      remaining: rackPenalty(resolvedWinner.rack.values()),
    });
  }
  losers.forEach((p, i) => {
    results.push({
      memberId: p.memberId,
      nickname: p.nickname,
      score: 0,
      rank: i + 2,
      remaining: rackPenalty(p.rack.values()),
    });
  });
  match.results = results;

  broadcastSnapshots(match);
  broadcastToGroup(match.groupId, { type: "match_ended", results });

  if (match.onEnded && results.length >= 2) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("rummy onEnded failed", e);
      });
    } catch (e) {
      console.error("rummy onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) {
      cleanupMatch(match);
    }
  }, 8000);
}

function cleanupMatch(match: RummyMatch): void {
  if (match.dealTimer) clearTimeout(match.dealTimer);
  match.dealTimer = null;
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
): { unsubscribe: () => void; initialEvent: RummyEvent } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: RummyEvent = match
    ? snapshotFor(match, memberId)
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

// 방 폭파 시 인메모리 판/구독 상태를 모두 정리한다.
export function destroyGroupRummy(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  groupSubscribers.delete(groupId);
  lobby.destroy(groupId);
}
