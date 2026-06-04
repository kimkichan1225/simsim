// 대기방 presence — 그룹 접속자 전원의 "현재 어느 시트(탭)에 있는지"를 중계한다.
// 각 클라이언트가 탭 전환 시 + 주기 하트비트로 위치를 보고(POST /api/presence)하고,
// 대기방 시트 구독자(SSE)에게 명단을 브로드캐스트한다.
// 하트비트가 끊기면(브라우저 종료 등) TTL 경과 후 명단에서 내린다.

export type WaitingMember = {
  memberId: string;
  nickname: string;
  location: string; // 탭 ID 슬러그 (waiting | match | tetris | apple | suika | leaderboard | activity ...)
};

export type WaitingEvent =
  | { type: "waiting"; members: WaitingMember[] }
  | { type: "group_destroyed" };

type Subscriber = (event: WaitingEvent) => void;

type PresenceEntry = {
  nickname: string;
  location: string;
  updatedAt: number;
};

// 하트비트(25초) 기준 3회 놓치면 퇴장으로 간주
const PRESENCE_TTL_MS = 80_000;
const SWEEP_INTERVAL_MS = 30_000;

const groupSubscribers = new Map<string, Map<string, Subscriber>>();
// groupId -> (memberId -> presence)
const groupPresence = new Map<string, Map<string, PresenceEntry>>();

function broadcastToGroup(groupId: string, event: WaitingEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("waiting subscriber error", e);
    }
  }
}

function rosterOf(groupId: string): WaitingEvent {
  const presence = groupPresence.get(groupId);
  const list: WaitingMember[] = presence
    ? [...presence.entries()].map(([memberId, p]) => ({
        memberId,
        nickname: p.nickname,
        location: p.location,
      }))
    : [];
  list.sort((a, b) => a.nickname.localeCompare(b.nickname));
  return { type: "waiting", members: list };
}

// 위치 보고(탭 전환·하트비트). 새 멤버이거나 위치가 바뀐 경우에만 브로드캐스트한다.
export function reportPresence(
  groupId: string,
  memberId: string,
  nickname: string,
  location: string,
): void {
  let presence = groupPresence.get(groupId);
  if (!presence) {
    presence = new Map();
    groupPresence.set(groupId, presence);
  }
  const prev = presence.get(memberId);
  presence.set(memberId, { nickname, location, updatedAt: Date.now() });
  if (!prev || prev.location !== location || prev.nickname !== nickname) {
    broadcastToGroup(groupId, rosterOf(groupId));
  }
}

// 명시적 퇴장(나가기) 시 즉시 명단에서 내린다.
export function removePresence(groupId: string, memberId: string): void {
  const presence = groupPresence.get(groupId);
  if (!presence || !presence.delete(memberId)) return;
  if (presence.size === 0) groupPresence.delete(groupId);
  broadcastToGroup(groupId, rosterOf(groupId));
}

// 하트비트 끊긴 멤버 정리
function sweepStale(): void {
  const now = Date.now();
  for (const [groupId, presence] of groupPresence) {
    let changed = false;
    for (const [memberId, p] of presence) {
      if (now - p.updatedAt > PRESENCE_TTL_MS) {
        presence.delete(memberId);
        changed = true;
      }
    }
    if (presence.size === 0) groupPresence.delete(groupId);
    if (changed) broadcastToGroup(groupId, rosterOf(groupId));
  }
}
setInterval(sweepStale, SWEEP_INTERVAL_MS).unref?.();

export function registerWaitingSubscriber(
  groupId: string,
  memberId: string,
  nickname: string,
  fn: Subscriber,
): { unsubscribe: () => void; initialEvent: WaitingEvent } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  bucket.set(memberId, fn);

  // 대기방 탭에 들어왔다는 것 자체가 위치 보고이기도 하다.
  reportPresence(groupId, memberId, nickname, "waiting");

  const unsubscribe = () => {
    const b = groupSubscribers.get(groupId);
    if (b && b.get(memberId) === fn) {
      b.delete(memberId);
      if (b.size === 0) groupSubscribers.delete(groupId);
    }
    // 위치는 지우지 않는다 — 다른 탭으로 이동하면 그쪽에서 다시 보고된다.
  };

  return { unsubscribe, initialEvent: rosterOf(groupId) };
}

// 방 폭파 시 대기방 구독/명단 정리.
export function destroyGroupWaiting(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  groupSubscribers.delete(groupId);
  groupPresence.delete(groupId);
}
