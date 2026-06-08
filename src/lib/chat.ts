// 그룹 채팅(댓글) — 인메모리 pub/sub. 메시지 영구저장은 라우트에서 prisma로 처리하고,
// 이 모듈은 실시간 전달(브로드캐스트)만 담당한다. (단어줍기/테트리스 SSE와 동일한 패턴)

import { randomBytes } from "node:crypto";
import { GameChannel, type SseSubscriber } from "./game-channel";

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

// 한 멤버가 여러 탭을 열 수 있으므로 멤버ID가 아니라 고유 구독ID로 관리한다.
const channel = new GameChannel();

function subId(): string {
  return randomBytes(9).toString("base64url");
}

export function broadcastChat(groupId: string, event: ChatEvent): void {
  channel.broadcast(groupId, event);
}

export function registerChatSubscriber(
  groupId: string,
  fn: SseSubscriber,
): { unsubscribe: () => void } {
  const id = subId();
  channel.add(groupId, id, fn);

  const unsubscribe = () => {
    channel.remove(groupId, id, fn);
  };
  return { unsubscribe };
}

export function destroyGroupChat(groupId: string): void {
  broadcastChat(groupId, { type: "group_destroyed" });
  channel.clear(groupId);
}
