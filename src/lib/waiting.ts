// 대기방 presence — "지금 대기방 시트(탭)에 있는 사람" 명단을 그룹 단위로 중계한다.
// 게임 허브(multiplayer/tetris)와 같은 패턴이되, 게임 상태 없이 명단만 다루는 경량 허브.

export type WaitingMember = {
  memberId: string;
  nickname: string;
};

export type WaitingEvent =
  | { type: "waiting"; members: WaitingMember[] }
  | { type: "group_destroyed" };

type Subscriber = (event: WaitingEvent) => void;

const groupSubscribers = new Map<string, Map<string, Subscriber>>();
// groupId -> (memberId -> nickname)
const groupMembers = new Map<string, Map<string, string>>();

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
  const members = groupMembers.get(groupId);
  const list: WaitingMember[] = members
    ? [...members.entries()].map(([memberId, nickname]) => ({
        memberId,
        nickname,
      }))
    : [];
  list.sort((a, b) => a.nickname.localeCompare(b.nickname));
  return { type: "waiting", members: list };
}

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

  let members = groupMembers.get(groupId);
  if (!members) {
    members = new Map();
    groupMembers.set(groupId, members);
  }
  members.set(memberId, nickname);
  broadcastToGroup(groupId, rosterOf(groupId));

  const unsubscribe = () => {
    const b = groupSubscribers.get(groupId);
    if (b && b.get(memberId) === fn) {
      b.delete(memberId);
      if (b.size === 0) groupSubscribers.delete(groupId);
    }
    const m = groupMembers.get(groupId);
    if (m) {
      m.delete(memberId);
      if (m.size === 0) groupMembers.delete(groupId);
    }
    broadcastToGroup(groupId, rosterOf(groupId));
  };

  return { unsubscribe, initialEvent: rosterOf(groupId) };
}

// 방 폭파 시 대기방 구독/명단 정리.
export function destroyGroupWaiting(groupId: string): void {
  broadcastToGroup(groupId, { type: "group_destroyed" });
  groupSubscribers.delete(groupId);
  groupMembers.delete(groupId);
}
