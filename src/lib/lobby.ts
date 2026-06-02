// 게임 시작 전 대기실 — 그룹별 presence(접속자) + 준비 상태 관리
// 단어줍기/테트리스가 각자 인스턴스를 만들어 공용으로 사용한다.
// presence 는 각 게임의 SSE 구독 = "지금 그 게임 탭에 있는 사람"으로 잡는다.

export type LobbyMemberView = {
  memberId: string;
  nickname: string;
  ready: boolean;
  isOwner: boolean;
};

type Member = { nickname: string; ready: boolean };
type Room = { ownerId: string | null; members: Map<string, Member> };

export class GroupLobby {
  private rooms = new Map<string, Room>();

  private room(groupId: string): Room {
    let r = this.rooms.get(groupId);
    if (!r) {
      r = { ownerId: null, members: new Map() };
      this.rooms.set(groupId, r);
    }
    return r;
  }

  // 접속(구독) 시 호출. 기존 준비 상태는 유지한다.
  join(groupId: string, memberId: string, nickname: string, isOwner: boolean): void {
    const r = this.room(groupId);
    if (isOwner) r.ownerId = memberId;
    const existing = r.members.get(memberId);
    r.members.set(memberId, { nickname, ready: existing?.ready ?? false });
  }

  leave(groupId: string, memberId: string): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    r.members.delete(memberId);
    if (r.members.size === 0) this.rooms.delete(groupId);
  }

  setReady(groupId: string, memberId: string, ready: boolean): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    const m = r.members.get(memberId);
    if (m) m.ready = ready;
  }

  // 게임 시작 시 준비 상태 초기화(다음 라운드 대비).
  clearReady(groupId: string): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    for (const m of r.members.values()) m.ready = false;
  }

  snapshot(groupId: string): LobbyMemberView[] {
    const r = this.rooms.get(groupId);
    if (!r) return [];
    const list = [...r.members.entries()].map(([memberId, m]) => ({
      memberId,
      nickname: m.nickname,
      ready: m.ready,
      isOwner: memberId === r.ownerId,
    }));
    // 방장을 맨 위로, 그다음 닉네임 순
    list.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return a.nickname.localeCompare(b.nickname);
    });
    return list;
  }

  // 방장을 제외한 모든 접속자가 준비됐는지(혼자면 true → 솔로 시작 허용).
  allReady(groupId: string): boolean {
    const r = this.rooms.get(groupId);
    if (!r) return false;
    for (const [memberId, m] of r.members.entries()) {
      if (memberId === r.ownerId) continue;
      if (!m.ready) return false;
    }
    return true;
  }

  destroy(groupId: string): void {
    this.rooms.delete(groupId);
  }
}
