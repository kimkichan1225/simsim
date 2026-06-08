// 그룹별 SSE 구독 허브 — 게임 모듈(omok/rummy/apple/tetris)과
// 대기방·채팅이 공유한다. groupSubscribers Map 복붙을 대체한다.
//
// 핵심: broadcast()는 동일 이벤트를 구독자 수와 무관하게 JSON.stringify를 1회만 한다
// (구독자 콜백은 이미 직렬화된 문자열을 받는다).
// 개인화 페이로드(루미큐브 손패 등)는 broadcastEach()로 구독자별로 만든다.

export type SseSubscriber = (data: string) => void; // 직렬화된 JSON 문자열을 받는다

export class GameChannel {
  // groupId -> (key -> subscriber). key는 보통 memberId, 채팅은 구독ID.
  private groups = new Map<string, Map<string, SseSubscriber>>();

  // 동일 이벤트를 모든 구독자에게 — 직렬화 1회.
  broadcast(groupId: string, event: unknown): void {
    const subs = this.groups.get(groupId);
    if (!subs) return;
    const data = JSON.stringify(event);
    for (const fn of subs.values()) {
      try {
        fn(data);
      } catch (e) {
        console.error("sse subscriber error", e);
      }
    }
  }

  // 구독자별로 다른 이벤트(개인화) — key(memberId)마다 make()로 만들어 보낸다.
  broadcastEach(groupId: string, make: (key: string) => unknown): void {
    const subs = this.groups.get(groupId);
    if (!subs) return;
    for (const [key, fn] of subs) {
      try {
        fn(JSON.stringify(make(key)));
      } catch (e) {
        console.error("sse subscriber error", e);
      }
    }
  }

  add(groupId: string, key: string, fn: SseSubscriber): void {
    let bucket = this.groups.get(groupId);
    if (!bucket) {
      bucket = new Map();
      this.groups.set(groupId, bucket);
    }
    bucket.set(key, fn);
  }

  // 현재 구독일 때만 제거한다(재연결 가드: 더 최신 구독이 들어왔으면 false).
  remove(groupId: string, key: string, fn: SseSubscriber): boolean {
    const bucket = this.groups.get(groupId);
    if (!bucket || bucket.get(key) !== fn) return false;
    bucket.delete(key);
    if (bucket.size === 0) this.groups.delete(groupId);
    return true;
  }

  // fn 가드 없이 key로 강제 제거(명시적 퇴장 등 — 재연결이 없는 경우에만 사용).
  removeKey(groupId: string, key: string): boolean {
    const bucket = this.groups.get(groupId);
    if (!bucket || !bucket.delete(key)) return false;
    if (bucket.size === 0) this.groups.delete(groupId);
    return true;
  }

  clear(groupId: string): void {
    this.groups.delete(groupId);
  }
}
