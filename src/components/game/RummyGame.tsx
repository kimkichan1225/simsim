"use client";

// 루미큐브(2~4인 턴제, 턴 무제한) — 드래그&드롭으로 타일을 배치한다.
// 내 턴 동안 로컬 사본(테이블+손패)을 자유롭게 편집하고, "턴 종료" 시
// 테이블 전체 배치를 서버에 제출해 검증받는다(실패하면 그대로 유지).
// 손패는 서버가 본인에게만 보내는 개인화 스냅샷으로 받는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  INITIAL_MELD_POINTS,
  rackPenalty,
  validateSet,
  type RummyTile,
} from "@/lib/rummy-rules";
import { notifyTab } from "@/lib/tab-alert";
import { LobbyCard, type LobbyMember } from "./LobbyCard";

// 타일 색 (0~3) — 구글 차트 팔레트로 위장
const TILE_COLORS = ["#d93025", "#1a73e8", "#f29900", "#202124"];
const JOKER_COLOR = "#9334e6";

type PlayerView = {
  memberId: string;
  nickname: string;
  rackCount: number;
  hasMelded: boolean;
  resigned: boolean;
};

type MatchResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
  remaining: number;
};

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "joining" | "running" | "ended";
  startedAt: number;
  players: PlayerView[];
  turnMemberId: string | null;
  table: RummyTile[][];
  liveTable: RummyTile[][] | null;
  liveDraggingId: string | null;
  myRack: RummyTile[];
  myLastDrawnId: string | null;
  poolCount: number;
  consecutivePasses: number;
  results?: MatchResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | { type: "match_cancelled" }
  | { type: "match_ended"; results: MatchResult[] }
  | {
      type: "live";
      memberId: string;
      table: RummyTile[][];
      dragging: string | null;
    }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "joining" | "playing" | "result";

type DragSource = { tileId: string; from: "rack" | "table" };

// 세트를 값 오름차순으로 자동 정렬한다.
// 조커는 숫자 사이 빈 자리에 끼워 런을 만들고, 남으면 뒤(13 초과 시 앞)에 붙인다.
function autoSortSet(set: RummyTile[]): RummyTile[] {
  const jokers = set.filter((t) => t.joker);
  const nums = set
    .filter((t) => !t.joker)
    .sort((a, b) => a.value - b.value || a.color - b.color);
  if (nums.length === 0) return set;
  if (jokers.length === 0) return nums;
  // 그룹(모두 같은 값)이면 조커를 뒤에 붙인다
  if (nums.every((t) => t.value === nums[0].value)) return [...nums, ...jokers];
  const pool = [...jokers];
  const out: RummyTile[] = [nums[0]];
  for (let i = 1; i < nums.length; i += 1) {
    let gap = nums[i].value - nums[i - 1].value - 1;
    while (gap > 0 && pool.length > 0) {
      out.push(pool.pop()!);
      gap -= 1;
    }
    out.push(nums[i]);
  }
  let head = nums[0].value;
  let tail = nums[nums.length - 1].value;
  while (pool.length > 0) {
    if (tail < 13) {
      out.push(pool.pop()!);
      tail += 1;
    } else if (head > 1) {
      out.unshift(pool.pop()!);
      head -= 1;
    } else {
      out.push(pool.pop()!);
    }
  }
  return out;
}

type DropTarget =
  | { type: "set"; setIdx: number; beforeTileId?: string }
  | { type: "new" }
  | { type: "rack" };

export function RummyGame({
  myMemberId,
  myNickname,
  isOwner,
  onAway,
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
  onAway: () => void;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("lobby");
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [turnMemberId, setTurnMemberId] = useState<string | null>(null);
  const [serverTable, setServerTable] = useState<RummyTile[][]>([]);
  // 턴 플레이어가 배치 중인 테이블(실시간 미리보기, 내 턴이 아닐 때 표시)
  const [liveTable, setLiveTable] = useState<RummyTile[][] | null>(null);
  // 턴 플레이어가 드는 중인 테이블 타일 — 상대 화면에서는 뒷면으로 보인다
  const [liveDragging, setLiveDragging] = useState<string | null>(null);
  const [serverRack, setServerRack] = useState<RummyTile[]>([]);
  // 내가 마지막으로 뽑은 타일(손패에서 강조)
  const [lastDrawnId, setLastDrawnId] = useState<string | null>(null);
  // 내가 지금 드래그 중인 타일(상대에게 뒷면 처리 요청용)
  const [dragging, setDragging] = useState<string | null>(null);
  const [poolCount, setPoolCount] = useState(0);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  // 내 턴 편집용 로컬 사본 — 한 객체로 묶어 드래그 이동을 원자적으로 처리한다
  const [work, setWork] = useState<{
    table: RummyTile[][];
    rack: RummyTile[];
    placed: Set<string>; // 이번 턴에 손패에서 낸 타일 (손으로 회수 가능)
    moved: boolean;
  }>(() => ({ table: [], rack: [], placed: new Set(), moved: false }));

  const dragRef = useRef<DragSource | null>(null);
  const submitPendingRef = useRef(false);
  const amAwayRef = useRef(false);

  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    amAwayRef.current = amAway;
    if (amAway) onAway();
  }, [amAway, onAway]);

  const handleDestroyed = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  const applyEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setPlayers(ev.players);
          setTurnMemberId(ev.turnMemberId);
          setServerTable(ev.table);
          setLiveTable(ev.liveTable ?? null);
          setLiveDragging(ev.liveDraggingId ?? null);
          setServerRack(ev.myRack);
          setLastDrawnId(ev.myLastDrawnId ?? null);
          setPoolCount(ev.poolCount);
          // 서버 상태가 바뀌었으므로 로컬 편집을 새 상태로 초기화
          setWork({
            table: ev.table.map((s) => [...s]),
            rack: [...ev.myRack],
            placed: new Set(),
            moved: false,
          });
          setPlayError(null);
          if (ev.status === "joining") {
            setResults(null);
            setPhase("joining");
          } else if (ev.status === "running") {
            setResults(null);
            setPhase("playing");
          } else {
            const res = ev.results ?? null;
            setResults(res);
            setPhase(res ? "result" : "lobby");
          }
          break;
        }
        case "no_match":
          break;
        case "match_started": {
          setResults(null);
          setNotice(null);
          if (amAwayRef.current) break;
          setPhase("joining");
          // 합류 창(8초) 안에 응답한 순서대로 2~4명 (이후는 관전)
          void fetch("/api/rummy/join", { method: "POST" }).catch(
            () => undefined,
          );
          break;
        }
        case "match_cancelled": {
          setNotice("인원이 모이지 않아 판이 취소됐어요. (2명 이상 필요)");
          setPhase("lobby");
          break;
        }
        case "match_ended": {
          setResults(ev.results);
          setPhase("result");
          break;
        }
        case "live": {
          // 내가 보낸 미리보기는 무시(내 화면은 로컬 사본이 진실)
          if (ev.memberId !== myMemberId) {
            setLiveTable(ev.table);
            setLiveDragging(ev.dragging ?? null);
          }
          break;
        }
        case "lobby": {
          setLobbyMembers(ev.members);
          break;
        }
        default:
          break;
      }
    },
    [myMemberId],
  );

  useEffect(() => {
    const es = new EventSource("/api/rummy/stream");
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const ev = JSON.parse(e.data) as ServerEvent;
        if (ev.type === "group_destroyed") {
          es.close();
          void handleDestroyed();
          return;
        }
        applyEvent(ev);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects */
    };
    return () => es.close();
  }, [applyEvent, handleDestroyed]);

  const me = players.find((p) => p.memberId === myMemberId) ?? null;
  const isMyTurn =
    phase === "playing" && me != null && !me.resigned && turnMemberId === myMemberId;
  const dirty = work.moved;

  // 내 턴이 되면 탭이 백그라운드일 때 제목에 알림 표시
  useEffect(() => {
    if (isMyTurn) notifyTab();
  }, [isMyTurn]);

  // 내 턴 동안 배치 변경을 스로틀(300ms) 전송해 다른 사람이 실시간으로 보게 한다.
  // 한 번이라도 보냈으면 되돌리기/드래그 해제 같은 원복 상태도 전파한다.
  const liveSentAtRef = useRef(0);
  const liveSentRef = useRef(false);
  useEffect(() => {
    if (!isMyTurn) {
      liveSentRef.current = false;
      return;
    }
    if (!work.moved && dragging === null && !liveSentRef.current) return;
    const elapsed = Date.now() - liveSentAtRef.current;
    const timer = setTimeout(() => {
      liveSentAtRef.current = Date.now();
      liveSentRef.current = true;
      void fetch("/api/rummy/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: work.table.map((set) => set.map((t) => t.id)),
          dragging,
        }),
      }).catch(() => undefined);
    }, Math.max(0, 300 - elapsed));
    return () => clearTimeout(timer);
  }, [isMyTurn, work.moved, work.table, dragging]);

  // ---------- 드래그&드롭 ----------

  const onTileDragStart = useCallback(
    (tileId: string, from: "rack" | "table") =>
      (e: React.DragEvent) => {
        dragRef.current = { tileId, from };
        setDragging(tileId); // 상대 화면에서 이 타일을 뒷면 처리
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", tileId);
      },
    [],
  );

  // 드롭 없이 드래그가 취소돼도(ESC 등) 뒷면 처리를 해제한다
  const onTileDragEnd = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);

  // 타일을 현재 위치에서 빼내 대상 위치로 옮긴다(로컬 사본만 수정).
  const moveTile = useCallback((source: DragSource, target: DropTarget) => {
    setWork((prev) => {
      const table = prev.table.map((s) => [...s]);
      const rack = [...prev.rack];
      const placed = new Set(prev.placed);

      // 원위치에서 타일 제거 (세트 분할 판단을 위해 위치를 기억한다)
      let tile: RummyTile | undefined;
      let fromRack = false;
      let srcSet: RummyTile[] | null = null;
      let srcIdx = -1;
      for (const set of table) {
        const i = set.findIndex((t) => t.id === source.tileId);
        if (i >= 0) {
          tile = set.splice(i, 1)[0];
          srcSet = set;
          srcIdx = i;
          break;
        }
      }
      if (!tile) {
        const i = rack.findIndex((t) => t.id === source.tileId);
        if (i >= 0) {
          tile = rack.splice(i, 1)[0];
          fromRack = true;
        }
      }
      if (!tile) return prev;

      if (target.type === "rack") {
        // 테이블 타일은 이번 턴에 내가 낸 것만 손으로 회수 가능
        if (!fromRack && !placed.has(tile.id)) return prev;
        rack.push(tile);
        placed.delete(tile.id);
      } else {
        if (fromRack) placed.add(tile.id);
        if (target.type === "new") {
          table.push([tile]);
        } else {
          const set = table[target.setIdx];
          if (!set) {
            table.push([tile]);
          } else {
            if (target.beforeTileId) {
              const i = set.findIndex((t) => t.id === target.beforeTileId);
              set.splice(i < 0 ? set.length : i, 0, tile);
            } else {
              set.push(tile);
            }
            // 숫자 타일을 내려놓으면 세트를 오름차순 자동 정렬
            // (조커를 직접 옮길 땐 의도한 자리를 존중해 정렬하지 않는다)
            if (!tile.joker) table[target.setIdx] = autoSortSet(set);
          }
        }
      }

      // 런 중간에서 타일을 빼면 그 자리에서 세트를 둘로 나눈다.
      // 예: 1,2,3,4,5,6에서 4를 빼면 1,2,3 / 5,6
      if (srcSet && srcIdx > 0 && srcIdx < srcSet.length) {
        const left = srcSet[srcIdx - 1];
        const right = srcSet[srcIdx];
        const nonJokers = srcSet.filter((t) => !t.joker);
        // 그룹(모두 같은 값)이거나 빼낸 자리 양옆이 여전히 이어지면 그대로 둔다
        const isGroup =
          nonJokers.length > 0 &&
          nonJokers.every((t) => t.value === nonJokers[0].value);
        const contiguous =
          !left.joker &&
          !right.joker &&
          left.color === right.color &&
          right.value === left.value + 1;
        if (!isGroup && !contiguous) {
          // 같은 세트에 다시 넣었거나(정렬로 교체됨) 세트가 사라졌으면 건너뛴다
          const k = table.indexOf(srcSet);
          if (k >= 0 && !srcSet.some((t) => t.id === tile!.id)) {
            table.splice(k, 1, srcSet.slice(0, srcIdx), srcSet.slice(srcIdx));
          }
        }
      }
      return {
        table: table.filter((s) => s.length > 0),
        rack,
        placed,
        moved: true,
      };
    });
  }, []);

  const onDrop = useCallback(
    (target: DropTarget) => (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const source = dragRef.current;
      dragRef.current = null;
      setDragging(null); // 내려놓으면 숫자 공개
      if (!source || !isMyTurn) return;
      moveTile(source, target);
    },
    [isMyTurn, moveTile],
  );

  const allowDrop = useCallback(
    (e: React.DragEvent) => {
      if (isMyTurn) e.preventDefault();
    },
    [isMyTurn],
  );

  // ---------- 액션 ----------

  const resetWork = useCallback(() => {
    setWork({
      table: serverTable.map((s) => [...s]),
      rack: [...serverRack],
      placed: new Set(),
      moved: false,
    });
    setPlayError(null);
  }, [serverTable, serverRack]);

  const submitTurn = useCallback(async () => {
    if (submitPendingRef.current) return;
    submitPendingRef.current = true;
    setPlayError(null);
    try {
      const res = await fetch("/api/rummy/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table: work.table.map((set) => set.map((t) => t.id)),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setPlayError(translatePlayError(data?.error));
      }
      // 성공 시 스냅샷이 와서 상태가 갱신된다
    } catch {
      setPlayError("연결 실패");
    } finally {
      submitPendingRef.current = false;
    }
  }, [work.table]);

  const drawTile = useCallback(() => {
    void fetch("/api/rummy/draw", { method: "POST" }).catch(() => undefined);
  }, []);

  const resignMatch = useCallback(() => {
    void fetch("/api/rummy/resign", { method: "POST" }).catch(() => undefined);
  }, []);

  const startMatch = useCallback(async () => {
    setStartError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/rummy/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStartError(translateStartError(data?.error));
      }
    } catch {
      setStartError("연결 실패");
    }
  }, []);

  const toggleReady = useCallback((ready: boolean) => {
    void fetch("/api/rummy/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  // 첫 등록 안내: 아직 등록 전이면 이번에 낸 새 세트 점수 합을 보여준다
  const meldPoints = useMemo(() => {
    if (!me || me.hasMelded || work.placed.size === 0) return null;
    let points = 0;
    for (const set of work.table) {
      if (set.every((t) => work.placed.has(t.id))) {
        const v = validateSet(set);
        if (v.ok) points += v.points;
      }
    }
    return points;
  }, [me, work.placed, work.table]);

  const myRackPenalty = useMemo(() => rackPenalty(work.rack), [work.rack]);

  return (
    <div className="flex flex-col gap-3 w-full pt-4 pb-8">
      {(phase === "playing" || phase === "joining" || phase === "result") && (
        <PlayersBar
          players={players}
          turnMemberId={turnMemberId}
          myMemberId={myMemberId}
          poolCount={poolCount}
          joining={phase === "joining"}
        />
      )}

      {(phase === "playing" || phase === "result") && (
        <TableArea
          table={isMyTurn ? work.table : (liveTable ?? serverTable)}
          editable={isMyTurn}
          placedIds={work.placed}
          hiddenTileId={isMyTurn ? null : liveDragging}
          onTileDragStart={onTileDragStart}
          onTileDragEnd={onTileDragEnd}
          onDrop={onDrop}
          allowDrop={allowDrop}
        />
      )}

      {phase === "playing" && me && !me.resigned && (
        <>
          <RackArea
            rack={isMyTurn ? work.rack : serverRack}
            editable={isMyTurn}
            penalty={myRackPenalty}
            drawnId={lastDrawnId}
            onTileDragStart={onTileDragStart}
            onTileDragEnd={onTileDragEnd}
            onDrop={onDrop}
            allowDrop={allowDrop}
          />
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {isMyTurn ? (
              <>
                {meldPoints != null && (
                  <span
                    className={
                      "text-[12px] tabular-nums " +
                      (meldPoints >= INITIAL_MELD_POINTS
                        ? "text-[var(--sheet-green)] font-medium"
                        : "text-[var(--sheet-muted)]")
                    }
                  >
                    첫 등록 {meldPoints}/{INITIAL_MELD_POINTS}점
                  </span>
                )}
                <button
                  type="button"
                  onClick={submitTurn}
                  disabled={work.placed.size === 0}
                  className="px-4 py-1.5 rounded bg-[var(--sheet-active)] text-white text-[13px] font-medium hover:brightness-95 disabled:opacity-50"
                >
                  턴 종료
                </button>
                <button
                  type="button"
                  onClick={drawTile}
                  disabled={dirty}
                  title={dirty ? "되돌리기 후 뽑을 수 있어요" : undefined}
                  className="px-4 py-1.5 rounded border border-[var(--sheet-cell-border)] text-[13px] hover:bg-black/5 disabled:opacity-50"
                >
                  {poolCount > 0 ? `타일 뽑기 (${poolCount})` : "패스"}
                </button>
                <button
                  type="button"
                  onClick={resetWork}
                  disabled={!dirty}
                  className="px-4 py-1.5 rounded border border-[var(--sheet-cell-border)] text-[13px] text-[var(--sheet-muted)] hover:bg-black/5 disabled:opacity-50"
                >
                  되돌리기
                </button>
              </>
            ) : (
              <span className="text-[13px] text-[var(--sheet-muted)]">
                {players.find((p) => p.memberId === turnMemberId)?.nickname ??
                  "?"}
                {liveTable ? "이(가) 타일을 배치하는 중..." : "의 차례를 기다리는 중..."}
              </span>
            )}
            <button
              type="button"
              onClick={resignMatch}
              className="px-3 py-1.5 rounded border border-[var(--sheet-cell-border)] text-[12px] text-[var(--sheet-muted)] hover:bg-black/5"
            >
              기권
            </button>
          </div>
          {playError && (
            <div className="text-center text-[13px] text-[#d93025]">
              {playError}
            </div>
          )}
        </>
      )}

      {phase === "playing" && (!me || me.resigned) && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
          {me?.resigned ? "기권했어요 — " : ""}관전 중이에요. 판이 끝나면 다음
          판에 참여할 수 있어요.
        </div>
      )}

      {phase === "joining" && (
        <div className="text-center text-[13px] text-[var(--sheet-muted)]">
          참가자를 모으는 중... (2~4명, 잠시 후 타일이 분배돼요)
        </div>
      )}

      {phase === "result" && results && (
        <ResultCard results={results} myMemberId={myMemberId} />
      )}

      {(phase === "lobby" || phase === "result") && (
        <LobbyCard
          title={phase === "result" ? "다시 하기" : "루미큐브"}
          description={
            phase === "result"
              ? "다음 판을 준비하세요."
              : "숫자 타일로 그룹(같은 수)·런(연속 수)을 만들어 손을 먼저 비우면 승리!\n첫 등록은 30점 이상, 방장이 시작하면 2~4명이 함께해요."
          }
          notice={notice}
          members={lobbyMembers}
          myMemberId={myMemberId}
          isOwner={isOwner}
          onStart={startMatch}
          onReady={toggleReady}
          startError={startError}
          requiresOpponent
        />
      )}
      <span className="sr-only">{myNickname}</span>
    </div>
  );
}

function translateStartError(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "그룹에 다시 입장해야 해요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    case "forbidden":
      return "게임 시작은 방장만 할 수 있어요.";
    case "need_opponent":
      return "루미큐브는 2명 이상이어야 시작할 수 있어요.";
    case "not_ready":
      return "모든 참가자가 준비해야 시작할 수 있어요.";
    default:
      return "시작에 실패했어요.";
  }
}

function translatePlayError(code: string | undefined): string {
  switch (code) {
    case "invalid_set":
      return "잘못된 세트가 있어요. 그룹(같은 수·다른 색 3~4장) 또는 런(같은 색 연속 3장+)이어야 해요.";
    case "first_meld_under_30":
      return "첫 등록은 새 세트 합계 30점 이상이어야 해요.";
    case "first_meld_table_touched":
      return "첫 등록 전에는 테이블의 기존 세트를 건드릴 수 없어요.";
    case "no_tiles_played":
      return "손패에서 타일을 하나 이상 내야 해요. 낼 게 없으면 타일을 뽑으세요.";
    case "not_your_turn":
      return "내 차례가 아니에요.";
    case "table_tile_missing":
      return "테이블의 타일은 손으로 가져올 수 없어요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    default:
      return "제출에 실패했어요. 배치를 확인해주세요.";
  }
}

function PlayersBar({
  players,
  turnMemberId,
  myMemberId,
  poolCount,
  joining,
}: {
  players: PlayerView[];
  turnMemberId: string | null;
  myMemberId: string;
  poolCount: number;
  joining: boolean;
}) {
  return (
    <div className="flex items-stretch border border-[var(--sheet-cell-border)] bg-white overflow-x-auto">
      {players.map((p) => {
        const isTurn = p.memberId === turnMemberId;
        const isMe = p.memberId === myMemberId;
        return (
          <div
            key={p.memberId}
            className={
              "flex items-center gap-2 px-3 py-2 border-r border-[var(--sheet-cell-border)] text-[13px] whitespace-nowrap " +
              (isTurn ? "bg-[var(--sheet-active-bg)] " : "") +
              (p.resigned ? "opacity-50" : "")
            }
          >
            {isTurn && (
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--sheet-active)]" />
            )}
            <span className={isMe ? "font-medium" : ""}>
              {p.nickname}
              {isMe ? " (나)" : ""}
            </span>
            <span className="text-[var(--sheet-muted)] tabular-nums">
              {p.resigned ? "기권" : `${p.rackCount}장`}
            </span>
            {p.hasMelded && !p.resigned && (
              <span className="text-[10px] text-[var(--sheet-green)]">✓</span>
            )}
          </div>
        );
      })}
      <div className="flex-1" />
      <div className="flex items-center px-3 text-[12px] text-[var(--sheet-muted)] whitespace-nowrap">
        {joining ? "모집 중..." : `더미 ${poolCount}장`}
      </div>
    </div>
  );
}

function Tile({
  tile,
  draggable,
  highlight,
  drawn,
  faceDown,
  onDragStart,
  onDragEnd,
}: {
  tile: RummyTile;
  draggable: boolean;
  highlight?: boolean;
  drawn?: boolean; // 방금 뽑은 타일(초록 강조)
  faceDown?: boolean; // 상대가 드는 중인 타일 — 숫자 숨김
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={
        "w-8 h-11 rounded border grid place-items-center text-[16px] font-semibold select-none shadow-sm " +
        (faceDown ? "bg-[#dadce0] " : "bg-white ") +
        (highlight
          ? "border-[var(--sheet-active)] ring-1 ring-[var(--sheet-active)] "
          : drawn
            ? "border-[var(--sheet-green)] ring-1 ring-[var(--sheet-green)] "
            : "border-[var(--sheet-cell-border)] ") +
        (draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default")
      }
      style={{
        color: faceDown
          ? undefined
          : tile.joker
            ? JOKER_COLOR
            : TILE_COLORS[tile.color],
      }}
    >
      {faceDown ? "" : tile.joker ? "★" : tile.value}
    </div>
  );
}

function TableArea({
  table,
  editable,
  placedIds,
  hiddenTileId,
  onTileDragStart,
  onTileDragEnd,
  onDrop,
  allowDrop,
}: {
  table: RummyTile[][];
  editable: boolean;
  placedIds: Set<string>;
  hiddenTileId?: string | null; // 턴 플레이어가 드는 중인 타일 — 뒷면 처리
  onTileDragStart: (
    tileId: string,
    from: "rack" | "table",
  ) => (e: React.DragEvent) => void;
  onTileDragEnd: () => void;
  onDrop: (target: DropTarget) => (e: React.DragEvent) => void;
  allowDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div className="min-h-[220px] p-3 border border-[var(--sheet-cell-border)] bg-white flex flex-wrap content-start gap-3">
      {table.map((set, setIdx) => {
        const valid = validateSet(set).ok;
        return (
          <div
            key={set.map((t) => t.id).join("-")}
            onDragOver={allowDrop}
            onDrop={onDrop({ type: "set", setIdx })}
            className={
              "flex gap-0.5 p-1 rounded border " +
              (valid
                ? "border-transparent"
                : "border-dashed border-[#d93025] bg-[#d93025]/5")
            }
          >
            {set.map((t) => (
              <div
                key={t.id}
                onDragOver={allowDrop}
                onDrop={onDrop({ type: "set", setIdx, beforeTileId: t.id })}
              >
                <Tile
                  tile={t}
                  draggable={editable}
                  highlight={editable && placedIds.has(t.id)}
                  faceDown={t.id === hiddenTileId}
                  onDragStart={onTileDragStart(t.id, "table")}
                  onDragEnd={onTileDragEnd}
                />
              </div>
            ))}
          </div>
        );
      })}
      {editable && (
        <div
          onDragOver={allowDrop}
          onDrop={onDrop({ type: "new" })}
          className="w-24 h-[52px] rounded border border-dashed border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
        >
          + 새 세트
        </div>
      )}
      {table.length === 0 && !editable && (
        <div className="w-full text-center text-[12px] text-[var(--sheet-muted)] py-8">
          아직 테이블에 등록된 세트가 없어요.
        </div>
      )}
    </div>
  );
}

function RackArea({
  rack,
  editable,
  penalty,
  drawnId,
  onTileDragStart,
  onTileDragEnd,
  onDrop,
  allowDrop,
}: {
  rack: RummyTile[];
  editable: boolean;
  penalty: number;
  drawnId?: string | null; // 방금 뽑은 타일 강조
  onTileDragStart: (
    tileId: string,
    from: "rack" | "table",
  ) => (e: React.DragEvent) => void;
  onTileDragEnd: () => void;
  onDrop: (target: DropTarget) => (e: React.DragEvent) => void;
  allowDrop: (e: React.DragEvent) => void;
}) {
  // 손패 정렬: 색 → 숫자 (조커는 끝)
  const sorted = [...rack].sort((a, b) => {
    if (a.joker !== b.joker) return a.joker ? 1 : -1;
    return a.color - b.color || a.value - b.value;
  });
  return (
    <div
      onDragOver={allowDrop}
      onDrop={onDrop({ type: "rack" })}
      className="p-3 border border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-[var(--sheet-muted)] uppercase tracking-wide">
          내 손패 {rack.length}장
        </span>
        <span className="text-[11px] text-[var(--sheet-muted)] tabular-nums">
          남은 합 {penalty}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 min-h-[48px]">
        {sorted.map((t) => (
          <Tile
            key={t.id}
            tile={t}
            draggable={editable}
            drawn={t.id === drawnId}
            onDragStart={onTileDragStart(t.id, "rack")}
            onDragEnd={onTileDragEnd}
          />
        ))}
      </div>
    </div>
  );
}

function ResultCard({
  results,
  myMemberId,
}: {
  results: MatchResult[];
  myMemberId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 border border-[var(--sheet-cell-border)] bg-white w-full">
      <h2 className="text-[18px] font-medium">결과</h2>
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="text-[var(--sheet-muted)]">
            <th className="px-2 py-1 text-left">순위</th>
            <th className="px-2 py-1 text-left">닉네임</th>
            <th className="px-2 py-1 text-right">남은 합</th>
            <th className="px-2 py-1 text-right">점수</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const isMe = r.memberId === myMemberId;
            return (
              <tr
                key={r.memberId}
                className={isMe ? "text-[var(--sheet-active)] font-medium" : ""}
              >
                <td className="px-2 py-1 tabular-nums">
                  {r.rank === 1 ? "🏆 1" : r.rank}
                </td>
                <td className="px-2 py-1">
                  {r.nickname}
                  {isMe ? " (나)" : ""}
                </td>
                <td className="px-2 py-1 tabular-nums text-right">
                  {r.remaining}
                </td>
                <td className="px-2 py-1 tabular-nums text-right">{r.score}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
