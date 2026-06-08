// 섯다(세장, 2~6인) — 인메모리 상태/이벤트 허브
// 20장(1~10월 각 2장, 피 제외), 광은 1·3·8월.
// 흐름: 2장 받고 베팅 → 1장 더 받고 베팅 → 3장 중 2장 선택(번복 불가) → 오픈.
// 특수패/족보 평가는 sutda-rules.ts(서버·클라 공유)에 있고, 여기선 진행/베팅/정산만 담당한다.
// 골드는 시작 시 주입받아 인메모리로 굴리고, 판이 끝나면 onEnded로 DB에 반영(올인·사이드팟 없음).

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";
import { GroupLobby, type LobbyMemberView } from "./lobby";
import {
  bestTwoOf,
  DECK_SPEC,
  evaluate2,
  type HandCategory,
  type SutdaCard,
} from "./sutda-rules";

export type { Suit, SutdaCard } from "./sutda-rules";

export const SUTDA_MAX_PLAYERS = 6;
const JOIN_WINDOW_MS = 8_000;
export const SUTDA_ANTE = 100;
const MIN_BET = 100;

export type SutdaStatus = "joining" | "bet1" | "bet2" | "select" | "ended";
export type SutdaAction = "call" | "bbing" | "ttadang" | "half";

// 쇼다운 서열 — 상대(본인 제외 안 죽은 사람들)의 카테고리에 따라 특수패가 발동한다.
function showdownRank(cat: HandCategory, others: HandCategory[]): number {
  switch (cat.t) {
    case "g38":
      return 1000;
    case "gwang":
      return 900;
    case "ddaeng":
      return 800 + cat.v;
    case "amhaeng": {
      // 13·18광땡이 있을 때만 발동(38광땡은 못 잡음). 없으면 1끗.
      const has13or18 = others.some((c) => c.t === "gwang");
      return has13or18 ? 950 : 1;
    }
    case "ddangjabi": {
      // 1~9땡이 있을 때 발동(장땡은 못 잡음). 없으면 망통.
      const has1to9 = others.some((c) => c.t === "ddaeng" && c.v < 10);
      return has1to9 ? 809.5 : 0;
    }
    case "special":
      return cat.r;
    case "menggusa":
    case "gusa":
      return 3; // 재경기 불발 시 3끗 취급
    case "kkut":
      return cat.v;
  }
}

// 안 죽은 사람 중 최고 서열(특수패 상황 반영) 보유자들. 동점이면 여러 명.
function computeWinners(active: SutdaPlayer[]): SutdaPlayer[] {
  if (active.length === 0) return [];
  if (active.length === 1) return [active[0]];
  let best = -Infinity;
  let winners: SutdaPlayer[] = [];
  for (const p of active) {
    const others = active.filter((o) => o !== p).map((o) => o.hand!.cat);
    const r = showdownRank(p.hand!.cat, others);
    if (r > best) {
      best = r;
      winners = [p];
    } else if (r === best) {
      winners.push(p);
    }
  }
  return winners;
}

// 구사 재경기 여부 — 구사/멍구사 보유자가 있고 판이 약할 때.
function isReplay(cats: HandCategory[]): boolean {
  const hasGwang = cats.some((c) => c.t === "g38" || c.t === "gwang");
  const hasDdaeng = cats.some((c) => c.t === "ddaeng");
  const hasMeng = cats.some((c) => c.t === "menggusa");
  const hasGusa = cats.some((c) => c.t === "gusa");
  if (hasMeng && !hasGwang) return true; // 최고가 장땡 이하
  if (hasGusa && !hasDdaeng && !hasGwang) return true; // 알리 이하(땡 없음)
  return false;
}

// ---------- 타입(스냅샷/이벤트) ----------

export type SutdaPlayerView = {
  memberId: string;
  nickname: string;
  gold: number;
  bet: number;
  folded: boolean;
  selected: boolean;
  cardCount: number; // 받은 패 수
  openCard: SutdaCard | null; // 베팅 중 공개되는 첫 2장 중 1장(둘째 장)
  cards: SutdaCard[] | null; // 공개 시(쇼다운에서 안 죽은 패의 선택 2장)
  hand: string | null;
};

export type SutdaResult = {
  memberId: string;
  nickname: string;
  handName: string;
  delta: number;
  finalGold: number;
  winner: boolean;
};

export type SutdaSnapshot = {
  type: "snapshot";
  matchId: string;
  status: SutdaStatus;
  round: 1 | 2;
  players: SutdaPlayerView[];
  turnMemberId: string | null;
  pot: number;
  currentBet: number;
  myCards: SutdaCard[]; // 본인 패(2 또는 3장)
  myChosen: [number, number] | null;
  results?: SutdaResult[];
};

export type SutdaEvent =
  | SutdaSnapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string }
  | { type: "match_cancelled" }
  | { type: "match_ended"; results: SutdaResult[] }
  | { type: "replay" }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type SutdaPlayer = {
  memberId: string;
  nickname: string;
  gold: number;
  startGold: number;
  cards: SutdaCard[];
  chosen: [number, number] | null;
  hand: { cat: HandCategory; name: string } | null;
  bet: number;
  roundBet: number;
  folded: boolean;
};

type SutdaMatch = {
  matchId: string;
  groupId: string;
  status: SutdaStatus;
  players: Map<string, SutdaPlayer>;
  order: string[];
  turnIdx: number;
  pot: number;
  currentBet: number;
  roundBase: number; // 이번 라운드 시작 베팅액(삥 가능 판정용)
  actedCount: number;
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

function buildDeck(): SutdaCard[] {
  const deck = DECK_SPEC.map(([num, suit], i) => ({ id: `c${i}`, num, suit }));
  for (let j = deck.length - 1; j > 0; j -= 1) {
    const k = Math.floor(Math.random() * (j + 1));
    [deck[j], deck[k]] = [deck[k], deck[j]];
  }
  return deck;
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

// ---------- 스냅샷 ----------

function playerView(
  match: SutdaMatch,
  p: SutdaPlayer,
): SutdaPlayerView {
  const showdown = match.status === "ended" && !p.folded;
  const inHand =
    (match.status === "bet1" ||
      match.status === "bet2" ||
      match.status === "select") &&
    !p.folded;
  const chosenCards =
    p.chosen && p.cards.length >= 2
      ? ([p.cards[p.chosen[0]], p.cards[p.chosen[1]]] as SutdaCard[])
      : null;
  return {
    memberId: p.memberId,
    nickname: p.nickname,
    gold: p.gold,
    bet: p.bet,
    folded: p.folded,
    selected: p.chosen != null,
    cardCount: p.cards.length,
    // 첫 2장 중 둘째 장이 오픈(2장 받고 1장 오픈 룰)
    openCard: inHand && p.cards.length >= 2 ? p.cards[1] : null,
    cards: showdown ? chosenCards : null,
    hand: showdown ? (p.hand?.name ?? null) : null,
  };
}

export function snapshotFor(match: SutdaMatch, memberId: string): SutdaSnapshot {
  const me = match.players.get(memberId);
  return {
    type: "snapshot",
    matchId: match.matchId,
    status: match.status,
    round: match.status === "bet2" ? 2 : 1,
    players: match.order
      .map((id) => match.players.get(id))
      .filter(Boolean)
      .map((p) => playerView(match, p!)),
    turnMemberId:
      match.status === "bet1" || match.status === "bet2"
        ? (match.order[match.turnIdx] ?? null)
        : null,
    pot: match.pot,
    currentBet: match.currentBet,
    myCards: me ? me.cards : [],
    myChosen: me?.chosen ?? null,
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
    roundBase: 0,
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
    chosen: null,
    hand: null,
    bet: 0,
    roundBet: 0,
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
  if (match.players.has(input.memberId)) return { ok: true };
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

function eligiblePlayers(match: SutdaMatch): SutdaPlayer[] {
  return match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => p.gold >= SUTDA_ANTE);
}

function activePlayers(match: SutdaMatch): SutdaPlayer[] {
  return match.order
    .map((id) => match.players.get(id)!)
    .filter((p) => !p.folded);
}

// 첫 딜(2장) + 앤티.
function deal(match: SutdaMatch): void {
  const deck = buildDeck();
  for (const p of match.order.map((id) => match.players.get(id)!)) {
    if (p.folded) continue;
    if (p.gold < SUTDA_ANTE) {
      p.folded = true;
      continue;
    }
    p.cards = [deck.pop()!, deck.pop()!];
    p.chosen = null;
    p.hand = null;
    p.gold -= SUTDA_ANTE;
    p.bet += SUTDA_ANTE;
    match.pot += SUTDA_ANTE;
  }
  startBettingRound(match, "bet1", SUTDA_ANTE);
}

// 3번째 카드 분배 + 2라운드 베팅
function dealThird(match: SutdaMatch): void {
  const used = new Set<string>();
  for (const p of activePlayers(match)) for (const c of p.cards) used.add(c.id);
  const deck = buildDeck().filter((c) => !used.has(c.id));
  for (const p of activePlayers(match)) {
    const card = deck.pop();
    if (card) p.cards.push(card);
  }
  startBettingRound(match, "bet2", 0);
}

function startBettingRound(
  match: SutdaMatch,
  status: "bet1" | "bet2",
  baseBet: number,
): void {
  match.status = status;
  match.roundBase = baseBet;
  match.currentBet = baseBet;
  match.actedCount = 0;
  for (const p of activePlayers(match)) {
    p.roundBet = baseBet;
  }
  const aliveIdx = match.order
    .map((id, i) => ({ i, p: match.players.get(id)! }))
    .filter((x) => !x.p.folded)
    .map((x) => x.i);
  match.turnIdx = aliveIdx[Math.floor(Math.random() * aliveIdx.length)] ?? 0;
  broadcastSnapshots(match);
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

export function act(input: {
  groupId: string;
  memberId: string;
  action: SutdaAction;
}): ActResult {
  const match = matches.get(input.groupId);
  if (!match || (match.status !== "bet1" && match.status !== "bet2")) {
    return { ok: false, reason: "not_running" };
  }
  const p = match.players.get(input.memberId);
  if (!p || p.folded) return { ok: false, reason: "not_player" };
  if (match.order[match.turnIdx] !== input.memberId) {
    return { ok: false, reason: "not_your_turn" };
  }

  const place = (newRoundBet: number, raise: boolean): ActResult => {
    const diff = newRoundBet - p.roundBet;
    if (diff > p.gold) return { ok: false, reason: "insufficient" };
    p.gold -= diff;
    p.roundBet = newRoundBet;
    p.bet += diff;
    match.pot += diff;
    if (raise) {
      match.currentBet = newRoundBet;
      match.actedCount = 1;
    } else {
      match.actedCount += 1;
    }
    return { ok: true };
  };

  let res: ActResult;
  switch (input.action) {
    case "call":
      res = place(match.currentBet, false);
      break;
    case "bbing":
      if (match.currentBet !== match.roundBase) {
        return { ok: false, reason: "cannot_bbing" };
      }
      res = place(match.currentBet + MIN_BET, true);
      break;
    case "ttadang":
      res = place(Math.max(match.currentBet * 2, MIN_BET), true);
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

  const active = activePlayers(match);
  if (active.length <= 1) {
    endMatch(match);
    return { ok: true };
  }
  if (match.actedCount >= active.length) {
    endBettingRound(match);
    return { ok: true };
  }
  advanceTurn(match);
  broadcastSnapshots(match);
  return { ok: true };
}

export function fold(input: {
  groupId: string;
  memberId: string;
}): { ok: boolean; reason?: "not_running" | "not_player" } {
  const match = matches.get(input.groupId);
  if (!match || (match.status !== "bet1" && match.status !== "bet2")) {
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
  if (match.order[match.turnIdx] === input.memberId) advanceTurn(match);
  if (match.actedCount >= active.length) {
    endBettingRound(match);
    return { ok: true };
  }
  broadcastSnapshots(match);
  return { ok: true };
}

function endBettingRound(match: SutdaMatch): void {
  if (match.status === "bet1") {
    dealThird(match);
    return;
  }
  // bet2 끝 → 2장 선택 단계
  match.status = "select";
  maybeShowdown(match);
  broadcastSnapshots(match);
}

// 3장 중 2장 선택(번복 불가)
export function selectCards(input: {
  groupId: string;
  memberId: string;
  cards: [number, number];
}): {
  ok: boolean;
  reason?: "not_selecting" | "not_player" | "bad_index" | "already";
} {
  const match = matches.get(input.groupId);
  if (!match || match.status !== "select") {
    return { ok: false, reason: "not_selecting" };
  }
  const p = match.players.get(input.memberId);
  if (!p || p.folded) return { ok: false, reason: "not_player" };
  if (p.chosen) return { ok: false, reason: "already" };
  const [i, j] = input.cards;
  if (i === j || i < 0 || j < 0 || i >= p.cards.length || j >= p.cards.length) {
    return { ok: false, reason: "bad_index" };
  }
  p.chosen = [i, j];
  if (!maybeShowdown(match)) broadcastSnapshots(match);
  return { ok: true };
}

// 안 죽은 사람이 모두 선택했으면 쇼다운. 진행되면 true.
function maybeShowdown(match: SutdaMatch): boolean {
  if (match.status !== "select") return false;
  const active = activePlayers(match);
  if (active.some((p) => !p.chosen)) return false;
  for (const p of active) {
    const [i, j] = p.chosen!;
    p.hand = evaluate2(p.cards[i], p.cards[j]);
  }
  const cats = active.map((p) => p.hand!.cat);
  // 구사/멍구사 재경기 — 안 죽은 전원이 새 카드
  if (isReplay(cats)) {
    broadcastToGroup(match.groupId, { type: "replay" });
    redeal(match);
    return true;
  }
  // 무승부 재경기 — 최고 족보가 둘 이상이면 그 동점자끼리만 재경기(판돈 유지)
  const winners = computeWinners(active);
  if (winners.length >= 2) {
    broadcastToGroup(match.groupId, { type: "replay" });
    for (const p of active) {
      if (!winners.includes(p)) p.folded = true;
    }
    redeal(match);
    return true;
  }
  endMatch(match);
  return true;
}

// 재경기용 — 앤티 없이(판돈 유지) 안 죽은 사람에게 새 2장을 돌리고 베팅 1라운드부터.
function redeal(match: SutdaMatch): void {
  const deck = buildDeck();
  for (const p of activePlayers(match)) {
    p.cards = [deck.pop()!, deck.pop()!];
    p.chosen = null;
    p.hand = null;
  }
  startBettingRound(match, "bet1", 0);
}

function endMatch(match: SutdaMatch): void {
  if (match.status === "ended") return;
  match.status = "ended";
  if (match.dealTimer) clearTimeout(match.dealTimer);
  match.dealTimer = null;
  lobby.setGameRunning(match.groupId, false);

  const active = activePlayers(match);
  // 선택 안 한 패는 자동 최고 2장
  for (const p of active) {
    if (!p.chosen && p.cards.length >= 2) p.chosen = bestTwoOf(p.cards).pick;
    if (p.chosen) p.hand = evaluate2(p.cards[p.chosen[0]], p.cards[p.chosen[1]]);
  }

  const winners = computeWinners(active);

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

  broadcastSnapshots(match);
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
    if (!channel.remove(groupId, memberId, fn)) return;
    lobby.leave(groupId, memberId);
    broadcastLobby(groupId);
  };

  return { unsubscribe, initialEvent };
}

export function destroyGroupSutda(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const match = matches.get(groupId);
  if (match) cleanupMatch(match);
  channel.clear(groupId);
  lobby.destroy(groupId);
}
