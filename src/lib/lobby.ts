// 게임 시작 전 대기실 — 그룹별 presence(접속자) + 준비 상태 관리
// 단어줍기/테트리스가 각자 인스턴스를 만들어 공용으로 사용한다.
// presence 는 각 게임의 SSE 구독 = "지금 그 게임 탭에 있는 사람"으로 잡는다.
//
// (자리비움 자동 이동 기능 제거됨) 무입력으로 멤버를 away 처리하지 않는다.
// away 필드/처리는 호환을 위해 남겨두되 항상 false 로 유지된다.

export type LobbyMemberView = {
  memberId: string;
  nickname: string;
  ready: boolean;
  isOwner: boolean;
  away: boolean;
};

type Member = { nickname: string; ready: boolean; away: boolean };
type Room = {
  ownerId: string | null;
  members: Map<string, Member>;
  gameRunning: boolean; // 게임 진행 중에는 idle 판정을 멈춘다
  idleTimers: Map<string, ReturnType<typeof setTimeout>>;
};

export class GroupLobby {
  private rooms = new Map<string, Room>();
  // 타이머에 의해 away 전환이 일어났을 때 호출(로비 브로드캐스트용)
  private onIdleChange?: (groupId: string) => void;

  constructor(onIdleChange?: (groupId: string) => void) {
    this.onIdleChange = onIdleChange;
  }

  private room(groupId: string): Room {
    let r = this.rooms.get(groupId);
    if (!r) {
      r = {
        ownerId: null,
        members: new Map(),
        gameRunning: false,
        idleTimers: new Map(),
      };
      this.rooms.set(groupId, r);
    }
    return r;
  }

  private clearIdleTimer(r: Room, memberId: string): void {
    const t = r.idleTimers.get(memberId);
    if (t) {
      clearTimeout(t);
      r.idleTimers.delete(memberId);
    }
  }

  private clearAllIdleTimers(r: Room): void {
    for (const t of r.idleTimers.values()) clearTimeout(t);
    r.idleTimers.clear();
  }

  // 자리비움(대기방 자동 이동) 기능 제거: 무입력으로 멤버를 away 처리하지 않는다.
  // 기존 타이머가 남아 있으면 정리만 하고, 새 타이머는 걸지 않는다.
  private armIdleTimer(_groupId: string, r: Room, memberId: string): void {
    this.clearIdleTimer(r, memberId);
  }

  // 접속(구독) 시 호출. 기존 준비/자리비움 상태는 유지한다(재연결 대비).
  join(groupId: string, memberId: string, nickname: string, isOwner: boolean): void {
    const r = this.room(groupId);
    if (isOwner) r.ownerId = memberId;
    const existing = r.members.get(memberId);
    r.members.set(memberId, {
      nickname,
      ready: existing?.ready ?? false,
      away: existing?.away ?? false,
    });
    if (isOwner) {
      this.clearIdleTimer(r, memberId);
    } else if (!existing) {
      this.armIdleTimer(groupId, r, memberId);
    }
  }

  leave(groupId: string, memberId: string): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    this.clearIdleTimer(r, memberId);
    r.members.delete(memberId);
    if (r.members.size === 0) {
      this.clearAllIdleTimers(r);
      this.rooms.delete(groupId);
    }
  }

  // 준비 토글 = 입력이 있었다는 뜻이므로 자리비움도 함께 해제한다.
  setReady(groupId: string, memberId: string, ready: boolean): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    const m = r.members.get(memberId);
    if (!m) return;
    m.ready = ready;
    m.away = false;
    if (ready) this.clearIdleTimer(r, memberId);
    else this.armIdleTimer(groupId, r, memberId);
  }

  // 게임 시작/종료 시 호출. 진행 중에는 idle 판정을 멈추고,
  // 끝나면 준비 안 한 멤버들의 idle 타이머를 다시 건다.
  setGameRunning(groupId: string, running: boolean): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    r.gameRunning = running;
    if (running) {
      this.clearAllIdleTimers(r);
    } else {
      for (const memberId of r.members.keys()) {
        this.armIdleTimer(groupId, r, memberId);
      }
    }
  }

  // 게임 시작 시 준비 상태 초기화(다음 라운드 대비).
  clearReady(groupId: string): void {
    const r = this.rooms.get(groupId);
    if (!r) return;
    for (const [memberId, m] of r.members.entries()) {
      m.ready = false;
      this.armIdleTimer(groupId, r, memberId);
    }
  }

  snapshot(groupId: string): LobbyMemberView[] {
    const r = this.rooms.get(groupId);
    if (!r) return [];
    const list = [...r.members.entries()].map(([memberId, m]) => ({
      memberId,
      nickname: m.nickname,
      ready: m.ready,
      isOwner: memberId === r.ownerId,
      away: m.away,
    }));
    // 방장을 맨 위로 → 활성 멤버 → 자리비움, 그다음 닉네임 순
    list.sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      if (a.away !== b.away) return a.away ? 1 : -1;
      return a.nickname.localeCompare(b.nickname);
    });
    return list;
  }

  // 해당 멤버가 대기실에 (자리비움 제외) 혼자 있는지(방장이 아니어도 솔로 시작 허용용).
  isAlone(groupId: string, memberId: string): boolean {
    const r = this.rooms.get(groupId);
    if (!r) return false;
    const me = r.members.get(memberId);
    if (!me || me.away) return false;
    for (const [id, m] of r.members.entries()) {
      if (id !== memberId && !m.away) return false;
    }
    return true;
  }

  // 방장을 제외한 모든 활성 접속자가 준비됐는지(자리비움은 제외, 혼자면 true → 솔로 시작 허용).
  allReady(groupId: string): boolean {
    const r = this.rooms.get(groupId);
    if (!r) return false;
    for (const [memberId, m] of r.members.entries()) {
      if (memberId === r.ownerId) continue;
      if (m.away) continue;
      if (!m.ready) return false;
    }
    return true;
  }

  destroy(groupId: string): void {
    const r = this.rooms.get(groupId);
    if (r) this.clearAllIdleTimers(r);
    this.rooms.delete(groupId);
  }
}
