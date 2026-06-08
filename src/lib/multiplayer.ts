import { randomBytes } from "node:crypto";
import { rollWord, type Word } from "./words";
import { GroupLobby, type LobbyMemberView } from "./lobby";

export type GameStatus = "running" | "ended";

export type ActiveWord = Word & { id: string };

export type Participant = {
  memberId: string;
  nickname: string;
  score: number;
};

export type GameResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

export type GameSnapshot = {
  type: "snapshot";
  gameId: string;
  startedAt: number;
  endsAt: number;
  status: GameStatus;
  participants: Participant[];
  activeWords: ActiveWord[];
  results?: GameResult[];
};

export type GameEvent =
  | GameSnapshot
  | { type: "no_game" }
  | { type: "participant_joined"; memberId: string; nickname: string }
  | {
      type: "word_claimed";
      wordId: string;
      byMemberId: string;
      points: number;
      newScore: number;
    }
  | { type: "word_spawned"; word: ActiveWord }
  | { type: "game_ended"; results: GameResult[] }
  | { type: "lobby"; members: LobbyMemberView[] }
  | { type: "group_destroyed" };

type Subscriber = (event: GameEvent) => void;

type ActiveGame = {
  gameId: string;
  groupId: string;
  status: GameStatus;
  startedAt: number;
  endsAt: number;
  participants: Map<string, Participant>;
  activeWords: Map<string, ActiveWord>;
  usedTexts: Set<string>;
  results: GameResult[] | null;
  endTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: GameResult[], game: ActiveGame) => Promise<void> | void;
};

const games = new Map<string, ActiveGame>();
const groupSubscribers = new Map<string, Map<string, Subscriber>>();
// 자리비움 전환이 일어나면 로비 상태를 모두에게 다시 알린다.
const lobby = new GroupLobby((groupId) => broadcastLobby(groupId));

const DURATION_SEC = 30;
const TARGET_WORD_COUNT = 8;

function newId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function broadcastToGroup(groupId: string, event: GameEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("subscriber error", e);
    }
  }
}

function broadcastLobby(groupId: string): void {
  broadcastToGroup(groupId, { type: "lobby", members: lobby.snapshot(groupId) });
}

// 준비 상태 토글 → 대기실 갱신 브로드캐스트
export function setLobbyReady(
  groupId: string,
  memberId: string,
  ready: boolean,
): void {
  lobby.setReady(groupId, memberId, ready);
  broadcastLobby(groupId);
}

// 방장을 제외한 접속자 전원 준비 여부(혼자면 true)
export function isAllReady(groupId: string): boolean {
  return lobby.allReady(groupId);
}

// 대기실에 해당 멤버 혼자만 있는지(방장이 아니어도 솔로 시작 허용용)
export function isAloneInLobby(groupId: string, memberId: string): boolean {
  return lobby.isAlone(groupId, memberId);
}

function hasPrefixConflict(
  text: string,
  actives: Map<string, ActiveWord>,
): boolean {
  for (const w of actives.values()) {
    if (text === w.text) return true;
    if (text.startsWith(w.text)) return true;
    if (w.text.startsWith(text)) return true;
  }
  return false;
}

function ensureActiveWords(game: ActiveGame): void {
  while (game.activeWords.size < TARGET_WORD_COUNT) {
    const w = rollWord(game.usedTexts, (text) =>
      hasPrefixConflict(text, game.activeWords),
    );
    if (!w) break;
    const word: ActiveWord = { id: newId(6), ...w };
    game.activeWords.set(word.id, word);
    game.usedTexts.add(w.text);
    broadcastToGroup(game.groupId, { type: "word_spawned", word });
  }
}

export function getActiveGame(groupId: string): ActiveGame | null {
  return games.get(groupId) ?? null;
}

export function snapshotOf(game: ActiveGame): GameSnapshot {
  return {
    type: "snapshot",
    gameId: game.gameId,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    status: game.status,
    participants: [...game.participants.values()],
    activeWords: [...game.activeWords.values()],
    results: game.results ?? undefined,
  };
}

export function startOrJoinGame(input: {
  groupId: string;
  memberId: string;
  nickname: string;
  onEnded?: (results: GameResult[], game: ActiveGame) => Promise<void> | void;
}): { game: ActiveGame; created: boolean } {
  const existing = games.get(input.groupId);
  if (existing && existing.status === "running" && Date.now() < existing.endsAt) {
    if (!existing.participants.has(input.memberId)) {
      existing.participants.set(input.memberId, {
        memberId: input.memberId,
        nickname: input.nickname,
        score: 0,
      });
      broadcastToGroup(existing.groupId, {
        type: "participant_joined",
        memberId: input.memberId,
        nickname: input.nickname,
      });
    }
    return { game: existing, created: false };
  }
  if (existing) {
    if (existing.status === "running") {
      void endGame(existing);
    } else {
      cleanupGame(existing);
    }
  }
  const now = Date.now();
  const game: ActiveGame = {
    gameId: newId(9),
    groupId: input.groupId,
    status: "running",
    startedAt: now,
    endsAt: now + DURATION_SEC * 1000,
    participants: new Map([
      [
        input.memberId,
        {
          memberId: input.memberId,
          nickname: input.nickname,
          score: 0,
        },
      ],
    ]),
    activeWords: new Map(),
    usedTexts: new Set(),
    results: null,
    endTimer: null,
    onEnded: input.onEnded,
  };
  games.set(input.groupId, game);
  // 게임 진행 중에는 자리비움(idle) 판정을 멈춘다
  lobby.setGameRunning(input.groupId, true);
  // 새 라운드 시작 → 준비 상태 초기화
  lobby.clearReady(input.groupId);
  broadcastLobby(input.groupId);
  ensureActiveWords(game);
  broadcastToGroup(game.groupId, snapshotOf(game));
  game.endTimer = setTimeout(() => {
    void endGame(game);
  }, DURATION_SEC * 1000);
  return { game, created: true };
}

// 진행 중인 게임에 참가자로 합류한다. 새 게임을 만들지는 않는다(시작은 방장만).
export function joinGame(input: {
  groupId: string;
  memberId: string;
  nickname: string;
}): { ok: boolean; reason?: "no_game" } {
  const game = games.get(input.groupId);
  if (!game || game.status !== "running" || Date.now() >= game.endsAt) {
    return { ok: false, reason: "no_game" };
  }
  if (!game.participants.has(input.memberId)) {
    game.participants.set(input.memberId, {
      memberId: input.memberId,
      nickname: input.nickname,
      score: 0,
    });
    broadcastToGroup(game.groupId, {
      type: "participant_joined",
      memberId: input.memberId,
      nickname: input.nickname,
    });
  }
  return { ok: true };
}

export function registerSubscriber(
  groupId: string,
  memberId: string,
  nickname: string,
  isOwner: boolean,
  fn: Subscriber,
): { unsubscribe: () => void; initialEvent: GameEvent } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  // 접속 = 대기실 입장. 다른 접속자에게도 갱신을 알린다(본인 포함).
  lobby.join(groupId, memberId, nickname, isOwner);
  broadcastLobby(groupId);

  const game = games.get(groupId);
  const initialEvent: GameEvent = game ? snapshotOf(game) : { type: "no_game" };

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

export function removeSubscriber(groupId: string, memberId: string): void {
  const b = groupSubscribers.get(groupId);
  if (!b) return;
  b.delete(memberId);
  if (b.size === 0) groupSubscribers.delete(groupId);
}

// 방이 폭파될 때 인메모리 게임/타이머/구독 상태를 모두 정리한다.
export function destroyGroup(groupId: string): void {
  // 구독자(참가자) 화면이 입장 화면으로 돌아가도록 먼저 폭파 이벤트를 보낸다.
  broadcastToGroup(groupId, { type: "group_destroyed" });
  const game = games.get(groupId);
  if (game) {
    cleanupGame(game);
    games.delete(groupId);
  }
  groupSubscribers.delete(groupId);
  lobby.destroy(groupId);
}

export type ClaimResult =
  | { ok: true; points: number; newScore: number }
  | {
      ok: false;
      reason:
        | "not_running"
        | "not_participant"
        | "word_not_found"
        | "mismatch";
    };

export function claimWord(input: {
  groupId: string;
  memberId: string;
  wordId: string;
  attempt: string;
}): ClaimResult {
  const game = games.get(input.groupId);
  if (!game || game.status !== "running") {
    return { ok: false, reason: "not_running" };
  }
  if (Date.now() >= game.endsAt) {
    void endGame(game);
    return { ok: false, reason: "not_running" };
  }
  const participant = game.participants.get(input.memberId);
  if (!participant) return { ok: false, reason: "not_participant" };
  const word = game.activeWords.get(input.wordId);
  if (!word) return { ok: false, reason: "word_not_found" };
  if (word.text !== input.attempt) return { ok: false, reason: "mismatch" };

  game.activeWords.delete(input.wordId);
  participant.score += word.points;
  broadcastToGroup(game.groupId, {
    type: "word_claimed",
    wordId: input.wordId,
    byMemberId: input.memberId,
    points: word.points,
    newScore: participant.score,
  });
  ensureActiveWords(game);
  if (game.activeWords.size === 0) {
    void endGame(game);
  }
  return { ok: true, points: word.points, newScore: participant.score };
}

function cleanupGame(game: ActiveGame): void {
  if (game.endTimer) clearTimeout(game.endTimer);
  game.endTimer = null;
}

export async function endGame(game: ActiveGame): Promise<void> {
  if (game.status === "ended") return;
  game.status = "ended";
  if (game.endTimer) clearTimeout(game.endTimer);
  game.endTimer = null;
  // 게임 종료 → 자리비움(idle) 판정 재개
  lobby.setGameRunning(game.groupId, false);

  const results: GameResult[] = [...game.participants.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      memberId: p.memberId,
      nickname: p.nickname,
      score: p.score,
      rank: i + 1,
    }));
  game.results = results;
  game.activeWords.clear();

  broadcastToGroup(game.groupId, { type: "game_ended", results });

  if (game.onEnded) {
    try {
      await game.onEnded(results, game);
    } catch (e) {
      console.error("onEnded callback failed", e);
    }
  }

  setTimeout(() => {
    if (games.get(game.groupId) === game) {
      cleanupGame(game);
      games.delete(game.groupId);
    }
  }, 5000);
}
