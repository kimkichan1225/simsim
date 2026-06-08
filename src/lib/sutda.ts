// 섯다(2~6인 턴제) — 인메모리 상태/이벤트 허브
// 화투 1~10월 각 2장(20장), 각자 2장. 정통 베팅(앤티/삥/따당/하프/콜/다이).
// 38광땡만 최고패. 골드는 시작 시 주입받아 인메모리로 굴리고, 판이 끝나면
// onEnded로 각자 최종 골드·손익을 route에 넘겨 DB에 반영한다(올인/사이드팟 없음).

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export const SUTDA_MAX_PLAYERS = 6;
const JOIN_WINDOW_MS = 8_000;
export const SUTDA_ANTE = 100; // 기본 참가비
const MIN_BET = 100; // 삥 최소 베팅

export type SutdaStatus = "joining" | "betting" | "ended";
export type SutdaAction = "die" | "call" | "bbing" | "ttadang" | "half";

export type HwatuCard = { id: string; month: number; gwang: boolean };
export type HandRank = { score: number; name: string };

export type SutdaPlayerView = {
  memberId: string;
  nickname: string;
  gold: number;
  bet: number;
  folded: boolean;
  cards: HwatuCard[] | null; // 공개 시에만(본인이거나 쇼다운에서 안 죽은 패)
  hand: string | null; // 쇼다운 공개 시 족보 이름
};

export type SutdaResult = {
  memberId: string;
  nickname: string;
  handName: string;
  delta: number; // 이번 판 손익
  finalGold: number; // route가 DB에 반영
  winner: boolean;
};

export type SutdaSnapshot = {
  type: "snapshot";
  matchId: string;
  status: SutdaStatus;
  players: SutdaPlayerView[]; // 배열 순서 = 자리 순서
  turnMemberId: string | null;
  pot: number;
  currentBet: number; // 콜 기준(누적)
  myCards: HwatuCard[]; // 수신자 전용(관전자는 빈 배열)
  results?: SutdaResult[];
};

export type SutdaEvent =
  | SutdaSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string }
  | { type: "match_cancelled" } // 인원 미달 취소
  | { type: "match_ended"; results: SutdaResult[] }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type SutdaPlayer = {
  memberId: string;
  nickname: string;
  gold: number;
  startGold: number; // 이번 판 시작 시 골드(손익 계산 기준)
  cards: HwatuCard[];
  hand: HandRank | null;
  bet: number; // 이번 판 낸 누적
  folded: boolean;
};

type SutdaMatch = {
  matchId: string;
  groupId: string;
  status: SutdaStatus;
  players: Map<string, SutdaPlayer>; // 삽입 순서 = 자리 순서
  order: string[];
  turnIdx: number;
  pot: number;
  currentBet: number;
  actedCount: number; // 마지막 레이즈 이후 액션한 active(안 죽은) 수
  results: SutdaResult[] | null;
  dealTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: SutdaResult[], groupId: string) => Promise<void> | void;
};

const matches = new Map<string, SutdaMatch>();
const channel = new GameChannel();
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: SutdaEvent): void {
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

// ---------- 카드/족보 ----------

// 화투 1~10월 각 2장. 광은 3월·8월에 1장씩(38광땡 판정용).
function buildDeck(): HwatuCard[] {
  const deck: HwatuCard[] = [];
  let i = 0;
  for (let month = 1; month <= 10; month += 1) {
    for (let copy = 0; copy < 2; copy += 1) {
      const gwang = (month === 3 || month === 8) && copy === 0;
      deck.push({ id: `c${i++}`, month, gwang });
    }
  }
  for (let j = deck.length - 1; j > 0; j -= 1) {
    const k = Math.floor(Math.random() * (j + 1));
    [deck[j], deck[k]] = [deck[k], deck[j]];
  }
  return deck;
}

const SPECIAL: Record<string, [number, string]> = {
  "1,2": [880, "알리"],
  "1,4": [870, "독사"],
  "1,9": [860, "구삥"],
  "1,10": [850, "장삥"],
  "4,10": [840, "장사"],
  "4,6": [830, "세륙"],
};

// 두 장의 족보 — 점수 높을수록 강함.
// 38광땡(1000) > 땡(901~910) > 특수패(830~880) > 끗수(0~9)
export function evaluate(a: HwatuCard, b: HwatuCard): HandRank {
  // 38광땡: 3월·8월이 둘 다 광
  if (
    a.gwang &&
    b.gwang &&
    ((a.month === 3 && b.month === 8) || (a.month === 8 && b.month === 3))
  ) {
    return { score: 1000, name: "38광땡" };
  }
  // 땡: 같은 월
  if (a.month === b.month) {
    const t = a.month;
    return { score: 900 + t, name: t === 10 ? "장땡" : `${t}땡` };
  }
  // 특수패
  const lo = Math.min(a.month, b.month);
  const hi = Math.max(a.month, b.month);
  const sp = SPECIAL[`${lo},${hi}`];
  if (sp) return { score: sp[0], name: sp[1] };
  // 끗수
  const kkut = (a.month + b.month) % 10;
  const name = kkut === 9 ? "갑오" : kkut === 0 ? "망통" : `${kkut}끗`;
  return { score: kkut, name };
}

// ---------- 스냅샷 ----------

function playerView(
  match: SutdaMatch,
  p: SutdaPlayer,
  viewerId: string,
): SutdaPlayerView {
  const showdown = match.status === "ended" && !p.folded;
  const reveal = showdown || p.memberId === viewerId;
  return {
    memberId: p.memberId,
    nickname: p.nickname,
    gold: p.gold,
    bet: p.bet,
    folded: p.folded,
    cards: reveal && p.cards.length > 0 ? p.cards : null,
    hand: showdown ? (p.hand?.name ?? null) : null,
  };
}

export function snapshotFor(
  match: SutdaMatch,
  memberId: string,
): SutdaSnapshot {
  const me = match.players.get(memberId);
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    players: match.order
      .map((id) => match.players.get(id))
      .filter(Boolean)
      .map((p) => playerView(match, p!, memberId)),
    turnMemberId:
      match.status === "betting" ? (match.order[match.turnIdx] ?? null) : null,
    pot: match.pot,
    currentBet: match.currentBet,
    myCards: me ? me.cards : [],
    results: match.results ?? undefined,
  };
}

function broadcastSnapshots(match: SutdaMatch): void {
  channel.broadcastEach(match.groupId, (memberId) =>
    snapshotFor(match, memberId),
  );
}

export function getMatch(groupId: string): SutdaMatch | null {
  return matches.get(groupId) ?? null;
}

// ---------- 진행 ----------

// 방장이 판을 연다. 합류 창(8초) 동안 2~6명을 모은 뒤 카드를 돌린다.
export function startMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  gold: number;
  onEnded?: (results: SutdaResult[], groupId: string) => Promise<void> | void;
}): { matchId: string } {
  const existing = matches.get(input.groupId);
  if (existing) cleanupMatch(existing);

  const match: SutdaMatch = {
    matchId: newId(9),
    groupId: input.groupId,
    status: "joining",
    players: new Map(),
    order: [],
    turnIdx: 0,
    pot: 0,
    currentBet: 0,
    actedCount: 0,
    results: null,
    dealTimer: null,
    onEnded: input.onEnded,
  };
  addPlayer(match, input.memberId, input.nickname, input.gold);
  matches.set(input.groupId, match);
  lobby.setGameRunning(input.groupId, true);
  lobby.clearReady(input.groupId);
  broadcastLobby(input.groupId);
  broadcastToGroup(match.groupId, {
    type: "match_started",
    matchId: match.matchId,
  });
  broadcastSnapshots(match);

  match.dealTimer = setTimeout(() => {
    const current = matches.get(input.groupId);
    if (current !== match || match.status !== "joining") return;
    if (eligiblePlayers(match).length < 2) {
      match.status = "ended";
      lobby.setGameRunning(match.groupId, false);
      broadcastToGroup(match.groupId, { type: "match_cancelled" });
      cleanupMatch(match);
      return;
    }
    deal(match);
  }, JOIN_WINDOW_MS);

  return { matchId: match.matchId };
}

function addPlayer(
  match: SutdaMatch,
  memberId: string,
  nickname: string,
  gold: number,
): void {
  match.players.set(memberId, {
    memberId,
    nickname,
    gold,
    startGold: gold,
    cards: [],
    hand: null,
    bet: 0,
    folded: false,
  });
  match.order.push(memberId);
}

export function joinMatch(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  gold: number;
}): { ok: boolean; reason?: "no_match" | "in_progress" | "full" | "broke" } {
  const match = matches.get(input.groupId);
  if (!match || match.status === "ended") return { ok: false, reason: "no_match" };
  if (match.players.has(input.memberId)) return { ok: true }; // 재연결
  if (match.status !== "joining") return { ok: false, reason: "in_progress" };
  if (match.players.size >= SUTDA_MAX_PLAYERS) return { ok: false, reason: "full" };
  if (input.gold < SUTDA_ANTE) return { ok: false, reason: "broke" };
  addPlayer(match, input.memberId, input.nickname, input.gold);
  broadcastSnapshots(match);
  if (match.players.size >= SUTDA_MAX_PLAYERS) {
    if (match.dealTimer) clearTimeout(match.dealTimer);
    match.dealTimer = null;
    deal(match);
  }
  return { ok: true };
}

// 앤티를 낼 수 있는(골드 충분한) 참가자
function eligiblePlayers(match: SutdaMatch): SutdaPlayer[] {
  return match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => p.gold >= SUTDA_ANTE);
}

function deal(match: SutdaMatch): void {
  // 앤티를 못 내는 사람은 이번 판에서 제외(죽은 것으로)
  const deck = buildDeck();
  for (const p of match.order.map((id) => match.players.get(id)!)) {
    if (p.gold < SUTDA_ANTE) {
      p.folded = true;
      continue;
    }
    p.cards = [deck.pop()!, deck.pop()!];
    p.hand = evaluate(p.cards[0], p.cards[1]);
    p.gold -= SUTDA_ANTE;
    p.bet = SUTDA_ANTE;
    match.pot += SUTDA_ANTE;
  }
  match.currentBet = SUTDA_ANTE;
  match.actedCount = 0;
  match.status = "betting";
  // 선(첫 차례)은 안 죽은 사람 중 랜덤
  const aliveIdx = match.order
    .map((id, i) => ({ i, p: match.players.get(id)! }))
    .filter((x) => !x.p.folded)
    .map((x) => x.i);
  match.turnIdx = aliveIdx[Math.floor(Math.random() * aliveIdx.length)] ?? 0;
  broadcastSnapshots(match);
}

function activePlayers(match: SutdaMatch): SutdaPlayer[] {
  return match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => !p.folded);
}

function advanceTurn(match: SutdaMatch): void {
  if (activePlayers(match).length === 0) return;
  do {
    match.turnIdx = (match.turnIdx + 1) % match.order.length;
  } while (match.players.get(match.order[match.turnIdx])!.folded);
}

export type ActResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_player"
        | "not_your_turn"
        | "cannot_bbing"
        | "insufficient";
    };

// 베팅 액션. 정통: 삥(첫 베팅)·따당(콜액 2배)·하프(판돈 절반)·콜·다이.
export function act(input: {
  groupId: string;
  memberId: string;
  action: SutdaAction;
}): ActResult {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "betting") {
    return { ok: false, reason: "not_running" };
  }
  const p = match.players.get(input.memberId);
  if (!p || p.folded) return { ok: false, reason: "not_player" };
  if (match.order[match.turnIdx] !== input.memberId) {
    return { ok: false, reason: "not_your_turn" };
  }

  // 새 누적 베팅 목표 계산(레이즈류)
  const place = (newBet: number, raise: boolean): ActResult => {
    const diff = newBet - p.bet;
    if (diff > p.gold) return { ok: false, reason: "insufficient" };
    p.gold -= diff;
    p.bet = newBet;
    match.pot += diff;
    if (raise) {
      match.currentBet = newBet;
      match.actedCount = 1; // 레이즈한 본인만 매치 상태
    } else {
      match.actedCount += 1;
    }
    return { ok: true };
  };

  let res: ActResult;
  switch (input.action) {
    case "die":
      p.folded = true;
      res = { ok: true };
      break;
    case "call":
      res = place(match.currentBet, false);
      break;
    case "bbing":
      // 삥 = 첫 베팅(아직 아무도 안 올림)일 때만
      if (match.currentBet !== SUTDA_ANTE) {
        return { ok: false, reason: "cannot_bbing" };
      }
      res = place(match.currentBet + MIN_BET, true);
      break;
    case "ttadang":
      res = place(match.currentBet * 2, true);
      break;
    case "half": {
      const raise = Math.max(Math.floor(match.pot / 2), MIN_BET);
      res = place(match.currentBet + raise, true);
      break;
    }
    default:
      return { ok: false, reason: "not_running" };
  }
  if (!res.ok) return res;

  // 종료 판정
  const active = activePlayers(match);
  if (active.length <= 1) {
    endMatch(match);
    return { ok: true };
  }
  if (match.actedCount >= active.length) {
    endMatch(match); // 베팅 라운드 종료 → 쇼다운
    return { ok: true };
  }
  advanceTurn(match);
  broadcastSnapshots(match);
  return { ok: true };
}

// 기권(다이) — 차례와 무관하게 죽을 수 있다. 마지막 한 명이 남으면 그 사람 승.
export function fold(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_player" } {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "betting") {
    return { ok: false, reason: "not_running" };
  }
  const p = match.players.get(input.memberId);
  if (!p || p.folded) return { ok: false, reason: "not_player" };
  p.folded = true;
  const active = activePlayers(match);
  if (active.length <= 1) {
    endMatch(match);
    return { ok: true };
  }
  // 죽은 사람이 차례였으면 다음으로 넘긴다
  if (match.order[match.turnIdx] === input.memberId) {
    advanceTurn(match);
  }
  if (match.actedCount >= active.length) {
    endMatch(match);
    return { ok: true };
  }
  broadcastSnapshots(match);
  return { ok: true };
}

function endMatch(match: SutdaMatch): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.dealTimer) clearTimeout(match.dealTimer);
  match.dealTimer = null;
  lobby.setGameRunning(match.groupId, false);

  const active = activePlayers(match);
  let winners: SutdaPlayer[] = [];
  if (active.length > 0) {
    const max = Math.max(...active.map((p) => p.hand?.score ?? -1));
    winners = active.filter((p) => (p.hand?.score ?? -1) === max);
  }
  // 판돈 분배(동점이면 균등, 나머지는 첫 승자에게)
  if (winners.length > 0) {
    const share = Math.floor(match.pot / winners.length);
    const remainder = match.pot - share * winners.length;
    winners.forEach((w, i) => {
      w.gold += share + (i === 0 ? remainder : 0);
    });
  }

  const winnerSet = new Set(winners.map((w) => w.memberId));
  const results: SutdaResult[] = match.order
    .map((id) => match.players.get(id)!)
    .map((p) => ({
      memberId: p.memberId,
      nickname: p.nickname,
      handName: p.hand?.name ?? "-",
      delta: p.gold - p.startGold,
      finalGold: p.gold,
      winner: winnerSet.has(p.memberId),
    }));
  match.results = results;

  broadcastSnapshots(match); // 안 죽은 패 공개
  broadcastToGroup(match.groupId, { type: "match_ended", results });

  if (match.onEnded) {
    try {
      void Promise.resolve(match.onEnded(results, match.groupId)).catch((e) => {
        console.error("sutda onEnded failed", e);
      });
    } catch (e) {
      console.error("sutda onEnded failed", e);
    }
  }

  setTimeout(() => {
    if (matches.get(match.groupId) === match) cleanupMatch(match);
  }, 8000);
}

function cleanupMatch(match: SutdaMatch): void {
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
  fn: SseSubscriber,
): { unsubscribe: () => void; initialEvent: SutdaEvent } {
  channel.add(groupId, memberId, fn);

  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const match = matches.get(groupId);
  const initialEvent: SutdaEvent = match
    ? snapshotFor(match, memberId)
    : { type: "no_match" };

  const unsubscribe = () => {
    // 재연결로 더 최신 구독이 들어왔으면 remove가 false → 정리하지 않는다.
    if (!channel.remove(groupId, memberId, fn)) return;
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

// 방 폭파 시 인메모리 판/구독 상태를 모두 정리한다.
export function destroyGroupSutda(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  channel.clear(groupId);
  lobby.destroy(groupId);
}
