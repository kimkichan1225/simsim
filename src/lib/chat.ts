// 그룹 채팅(댓글) — 인메모리 pub/sub. 메시지 영구저장은 라우트에서 prisma로 처리하고,
// 이 모듈은 실시간 전달(브로드캐스트)만 담당한다. (단어줍기/테트리스 SSE와 동일한 패턴)

import { randomBytes } from "node:crypto";

export type ChatMessage = {
  id: string;
  memberId: string;
  nickname: string;
  text: string;
  createdAt: number;
};

export type ChatEvent =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "group_destroyed" };

type Subscriber = (event: ChatEvent) => void;

// 한 멤버가 여러 탭을 열 수 있으므로 멤버ID가 아니라 고유 구독ID로 관리한다.
const groupSubscribers = new Map<string, Map<string, Subscriber>>();

function subId(): string {
  return randomBytes(9).toString("base64url");
}

export function broadcastChat(groupId: string, event: ChatEvent): void {
  const subs = groupSubscribers.get(groupId);
  if (!subs) return;
  for (const fn of subs.values()) {
    try {
      fn(event);
    } catch (e) {
      console.error("chat subscriber error", e);
    }
  }
}

export function registerChatSubscriber(
  groupId: string,
  fn: Subscriber,
): { unsubscribe: () => void } {
  let bucket = groupSubscribers.get(groupId);
  if (!bucket) {
    bucket = new Map();
    groupSubscribers.set(groupId, bucket);
  }
  const id = subId();
  bucket.set(id, fn);

  const unsubscribe = () => {
    const b = groupSubscribers.get(groupId);
    if (b) {
      b.delete(id);
      if (b.size === 0) groupSubscribers.delete(groupId);
    }
  };
  return { unsubscribe };
}

export function destroyGroupChat(groupId: string): void {
  broadcastChat(groupId, { type: "group_destroyed" });
  groupSubscribers.delete(groupId);
}
