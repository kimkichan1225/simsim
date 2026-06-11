// 워크스페이스 제어 채널 — 방장이 특정 멤버를 다른 시트(탭)로 강제 이동시키는
// 명령을 그 멤버의 "항상 켜진" 구독으로 전달한다.
// 대기방 presence(waiting.ts)와는 분리된 전용 채널이다(구독해도 위치 보고가 일어나지 않게).
//
// 전달 방식은 코드베이스 관례(게임 스냅샷 broadcast + 클라이언트가 myMemberId로 필터)를 따른다:
// move 이벤트에 대상 memberId를 실어 그룹 전체에 broadcast하고, 각 클라이언트는
// 자기 memberId와 일치할 때만 탭을 전환한다.

import { GameChannel, type SseSubscriber } from "./game-channel";

export type ControlEvent =
  | { type: "connected" }
  | { type: "move"; memberId: string; location: string }
  | { type: "group_destroyed" };

const channel = new GameChannel();

// 워크스페이스 전역 명령 구독 등록. 위치 보고 같은 부수효과는 없다.
export function registerControlSubscriber(
  groupId: string,
  memberId: string,
  fn: SseSubscriber,
): { unsubscribe: () => void } {
  channel.add(groupId, memberId, fn);
  return {
    unsubscribe: () => {
      channel.remove(groupId, memberId, fn);
    },
  };
}

// 방장 → 대상 멤버를 location 탭으로 강제 이동.
export function sendMove(
  groupId: string,
  targetMemberId: string,
  location: string,
): void {
  channel.broadcast(groupId, {
    type: "move",
    memberId: targetMemberId,
    location,
  } satisfies ControlEvent);
}

// 방 폭파 시 제어 채널 정리.
export function destroyGroupControl(groupId: string): void {
  channel.broadcast(groupId, { type: "group_destroyed" } satisfies ControlEvent);
  channel.clear(groupId);
}
