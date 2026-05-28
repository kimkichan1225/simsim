import { randomBytes } from "node:crypto";

type Session = {
  memberId: string;
  startedAt: number;
  expiresAt: number;
};

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_SESSIONS = 5_000;

function evict(now: number) {
  for (const [k, v] of sessions) {
    if (v.expiresAt <= now) sessions.delete(k);
  }
  if (sessions.size > MAX_SESSIONS) {
    const overflow = sessions.size - MAX_SESSIONS;
    let i = 0;
    for (const k of sessions.keys()) {
      if (i >= overflow) break;
      sessions.delete(k);
      i += 1;
    }
  }
}

export function createGameSession(memberId: string): {
  runId: string;
  startedAt: number;
} {
  const now = Date.now();
  evict(now);
  const runId = randomBytes(18).toString("base64url");
  sessions.set(runId, {
    memberId,
    startedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return { runId, startedAt: now };
}

export type ConsumeError = "not_found" | "wrong_member" | "expired";

export function consumeGameSession(
  runId: string,
  memberId: string,
): { startedAt: number } | { error: ConsumeError } {
  const now = Date.now();
  const s = sessions.get(runId);
  if (!s) return { error: "not_found" };
  sessions.delete(runId);
  if (s.memberId !== memberId) return { error: "wrong_member" };
  if (s.expiresAt <= now) return { error: "expired" };
  return { startedAt: s.startedAt };
}
