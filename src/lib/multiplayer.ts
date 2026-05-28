import { randomBytes } from "node:crypto";
import { rollWord, type Word } from "./words";

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
  | { type: "game_ended"; results: GameResult[] };

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
  endTimer: ReturnType<typeof setTimeout> | null;
  onEnded?: (results: GameResult[], game: ActiveGame) => Promise<void> | void;
};

const games = new Map<string, ActiveGame>();
const groupSubscribers = new Map<string, Map<string, Subscriber>>();

const DURATION_SEC = 90;
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

function ensureActiveWords(game: ActiveGame): void {
  while (game.activeWords.size < TARGET_WORD_COUNT) {
    const w = rollWord(game.usedTexts);
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

function snapshotOf(game: ActiveGame): GameSnapshot {
  return {
    type: "snapshot",
    gameId: game.gameId,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    status: game.status,
    participants: [...game.participants.values()],
    activeWords: [...game.activeWords.values()],
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
  if (existing) cleanupGame(existing);
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
    endTimer: null,
    onEnded: input.onEnded,
  };
  games.set(input.groupId, game);
  ensureActiveWords(game);
  broadcastToGroup(game.groupId, snapshotOf(game));
  game.endTimer = setTimeout(() => {
    void endGame(game);
  }, DURATION_SEC * 1000);
  return { game, created: true };
}

export function subscribe(
  groupId: string,
  memberId: string,
  fn: Subscriber,
): () => void {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  const game = games.get(groupId);
  if (game) fn(snapshotOf(game));
  else fn({ type: "no_game" });

  return () => {
    const b = groupSubscribers.get(groupId);
    if (b && b.get(memberId) === fn) {
      b.delete(memberId);
      if (b.size === 0) groupSubscribers.delete(groupId);
    }
  };
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

  const results: GameResult[] = [...game.participants.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      memberId: p.memberId,
      nickname: p.nickname,
      score: p.score,
      rank: i + 1,
    }));

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
