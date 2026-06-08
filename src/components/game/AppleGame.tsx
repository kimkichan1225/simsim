"use client";

// 사과게임(합 10 지우기) — 모두 같은 숫자판을 받고 각자 지우는 점수 대결.
// 드래그로 셀 범위를 선택하면 시트의 범위 선택처럼 보인다(위장).
// 범위 내 남은 숫자 합이 정확히 10이면 지워지고 지운 개수만큼 점수.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { useGameStream } from "@/lib/use-game-stream";

const ROWS = 10;
const COLS = 17;
const TARGET_SUM = 10;
// 셀 픽셀 크기 — 선택 오버레이 좌표 계산에 사용
const CELL_W = 32;
const CELL_H = 26;

const COL_LETTERS = "ABCDEFGHIJKLMNOPQ".split("");

type Player = {
  memberId: string;
  nickname: string;
  score: number;
  done: boolean; // 포기(중도 종료)
};

type MatchResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

type Snapshot = {
  type: "snapshot";
  matchId: string;
  status: "running" | "ended";
  startedAt: number;
  endsAt: number;
  board: number[];
  players: Player[];
  cleared: Record<string, number[]>;
  results?: MatchResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number; endsAt: number }
  | { type: "player_joined"; memberId: string; nickname: string }
  | { type: "player_done"; memberId: string }
  | { type: "cells_cleared"; memberId: string; cells: number[]; newScore: number }
  | { type: "match_ended"; results: MatchResult[] }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "playing" | "result";

type CellPos = { r: number; c: number };

type Selection = { anchor: CellPos; current: CellPos };

function rectOf(sel: Selection) {
  return {
    rMin: Math.min(sel.anchor.r, sel.current.r),
    rMax: Math.max(sel.anchor.r, sel.current.r),
    cMin: Math.min(sel.anchor.c, sel.current.c),
    cMax: Math.max(sel.anchor.c, sel.current.c),
  };
}

export function AppleGame({
  myMemberId,
  myNickname,
  isOwner,
  onAway,
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
  onAway: () => void; // 자리비움 판정 시 대기방 탭으로 이동
}) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [board, setBoard] = useState<number[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [clearedMine, setClearedMine] = useState<boolean[]>([]);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [matchRunning, setMatchRunning] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const draggingRef = useRef(false);
  // 합류 요청을 보낸 매치 ID — join 응답 전에 도착하는 스냅샷이
  // (아직 참가자 명단에 없다고) 대기실로 강등시키지 않도록 가드한다.
  const joinedMatchRef = useRef<string | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const boardRef = useRef<number[] | null>(null);
  const clearedRef = useRef<boolean[]>([]);
  const phaseRef = useRef<Phase>("lobby");
  const amAwayRef = useRef(false);
  const clearPendingRef = useRef(false);

  // 자리비움 판정 → 대기방 탭으로 이동(언마운트되면 로비에서도 빠진다).
  // 이동 전 잠깐의 틈에 대결에 자동 합류하지 않도록 ref 로도 보관한다.
  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  useEffect(() => {
    if (amAway) onAway();
  }, [amAway, onAway]);

  // 이벤트 핸들러(SSE/드래그 확정)가 최신 상태를 참조하도록 ref 동기화
  useEffect(() => {
    selectionRef.current = selection;
    boardRef.current = board;
    clearedRef.current = clearedMine;
    phaseRef.current = phase;
    amAwayRef.current = amAway;
  });

  const applyEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setEndsAt(ev.endsAt);
          setBoard(ev.board);
          setPlayers(ev.players);
          setMatchRunning(ev.status === "running");
          const mine = new Array<boolean>(ROWS * COLS).fill(false);
          for (const idx of ev.cleared[myMemberId] ?? []) mine[idx] = true;
          setClearedMine(mine);
          const myPlayer = ev.players.find((p) => p.memberId === myMemberId);
          if (ev.status === "running") {
            setResults(null);
            if (myPlayer) {
              // 재접속 복원: 참가자면 게임 화면, 포기했으면 대기실
              joinedMatchRef.current = ev.matchId;
              setPhase(myPlayer.done ? "lobby" : "playing");
            } else if (joinedMatchRef.current === ev.matchId) {
              // 방금 합류 요청을 보낸 매치 — player_joined가 곧 도착한다
              setPhase("playing");
            } else {
              setPhase("lobby");
            }
          } else {
            const res = ev.results ?? null;
            setResults(res);
            const inResults = res?.some((r) => r.memberId === myMemberId);
            setPhase(res && inResults ? "result" : "lobby");
          }
          break;
        }
        case "no_match": {
          setMatchRunning(false);
          break;
        }
        case "match_started": {
          setEndsAt(ev.endsAt);
          setBoard(null); // 보드는 이어지는 스냅샷으로 받는다
          setResults(null);
          setSelection(null);
          setMatchRunning(true);
          setClearedMine(new Array<boolean>(ROWS * COLS).fill(false));
          // 대기방(자리비움) 상태면 합류하지 않고 대기방에 머문다.
          if (amAwayRef.current) break;
          // 시작 시점에 이 탭에 있던 사람만 이 매치에 합류한다.
          joinedMatchRef.current = ev.matchId;
          void fetch("/api/apple/join", { method: "POST" })
            .then((res) => {
              if (res.ok) return;
              // 합류 실패(유예시간 초과 등) → 대기실로 되돌린다.
              if (joinedMatchRef.current === ev.matchId) {
                joinedMatchRef.current = null;
                setPhase("lobby");
              }
            })
            .catch(() => undefined);
          setPhase("playing");
          break;
        }
        case "player_joined": {
          setPlayers((prev) =>
            prev.some((p) => p.memberId === ev.memberId)
              ? prev
              : [
                  ...prev,
                  {
                    memberId: ev.memberId,
                    nickname: ev.nickname,
                    score: 0,
                    done: false,
                  },
                ],
          );
          break;
        }
        case "player_done": {
          setPlayers((prev) =>
            prev.map((p) =>
              p.memberId === ev.memberId ? { ...p, done: true } : p,
            ),
          );
          // 내가 포기 → 대기실로 (결과는 match_ended 때 표시)
          if (ev.memberId === myMemberId) {
            setSelection(null);
            setPhase("lobby");
          }
          break;
        }
        case "cells_cleared": {
          setPlayers((prev) =>
            prev.map((p) =>
              p.memberId === ev.memberId ? { ...p, score: ev.newScore } : p,
            ),
          );
          if (ev.memberId === myMemberId) {
            setClearedMine((prev) => {
              const next = [...prev];
              for (const idx of ev.cells) next[idx] = true;
              return next;
            });
          }
          break;
        }
        case "match_ended": {
          setMatchRunning(false);
          setResults(ev.results);
          setSelection(null);
          // 대결에 참여한 사람만 결과 화면, 대기 중이던 사람은 대기실로.
          const inResults = ev.results.some((r) => r.memberId === myMemberId);
          setPhase(inResults ? "result" : "lobby");
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

  // SSE 연결 (group_destroyed 처리·정리는 공용 훅이 담당)
  useGameStream<ServerEvent>("/api/apple/stream", applyEvent);

  // UI 클럭 (남은 시간)
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  const remainingSec = useMemo(() => {
    if (phase !== "playing" || endsAt == null) return 0;
    return Math.max(0, Math.ceil((endsAt - now) / 1000));
  }, [phase, endsAt, now]);

  // 선택 범위의 남은 숫자 합/개수 (시트 하단 상태줄처럼 표시)
  const selectionStat = useMemo(() => {
    if (!selection || !board) return { sum: 0, count: 0 };
    const { rMin, rMax, cMin, cMax } = rectOf(selection);
    let sum = 0;
    let count = 0;
    for (let r = rMin; r <= rMax; r += 1) {
      for (let c = cMin; c <= cMax; c += 1) {
        const idx = r * COLS + c;
        if (clearedMine[idx]) continue;
        sum += board[idx];
        count += 1;
      }
    }
    return { sum, count };
  }, [selection, board, clearedMine]);

  // 드래그 확정: 합이 10이면 서버에 지우기 요청(확정은 cells_cleared 수신 시)
  const commitSelection = useCallback(() => {
    const sel = selectionRef.current;
    const b = boardRef.current;
    setSelection(null);
    if (!sel || !b || phaseRef.current !== "playing") return;
    const { rMin, rMax, cMin, cMax } = rectOf(sel);
    let sum = 0;
    for (let r = rMin; r <= rMax; r += 1) {
      for (let c = cMin; c <= cMax; c += 1) {
        const idx = r * COLS + c;
        if (clearedRef.current[idx]) continue;
        sum += b[idx];
      }
    }
    if (sum !== TARGET_SUM) return;
    if (clearPendingRef.current) return;
    clearPendingRef.current = true;
    void fetch("/api/apple/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ r1: rMin, c1: cMin, r2: rMax, c2: cMax }),
    })
      .catch(() => undefined)
      .finally(() => {
        clearPendingRef.current = false;
      });
  }, []);

  // 드래그 중 마우스가 그리드 밖에서 떼져도 확정되도록 window에서 받는다.
  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      commitSelection();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [commitSelection]);

  const onCellDown = useCallback((r: number, c: number) => {
    if (phaseRef.current !== "playing") return;
    draggingRef.current = true;
    setSelection({ anchor: { r, c }, current: { r, c } });
  }, []);

  const onCellEnter = useCallback((r: number, c: number) => {
    if (!draggingRef.current) return;
    setSelection((prev) =>
      prev ? { anchor: prev.anchor, current: { r, c } } : prev,
    );
  }, []);

  const startMatch = useCallback(async () => {
    setStartError(null);
    try {
      const res = await fetch("/api/apple/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStartError(translateStartError(data?.error));
        return;
      }
    } catch {
      setStartError("연결 실패");
    }
  }, []);

  // 포기 — 점수는 그 시점으로 확정. 확정 처리는 player_done 수신 시.
  const giveUpMatch = useCallback(() => {
    void fetch("/api/apple/giveup", { method: "POST" }).catch(() => undefined);
  }, []);

  const toggleReady = useCallback((ready: boolean) => {
    void fetch("/api/apple/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );
  const me = players.find((p) => p.memberId === myMemberId);
  const myScore = me?.score ?? 0;
  const amDone = me?.done ?? false;

  return (
    <div className="flex flex-col gap-4 w-full pt-4 pb-8">
      <Scoreboard
        players={sortedPlayers}
        myMemberId={myMemberId}
        myNickname={myNickname}
        remainingSec={remainingSec}
        playing={phase === "playing"}
        myScore={myScore}
      />

      {phase === "playing" && board ? (
        <>
          <NumberGrid
            board={board}
            cleared={clearedMine}
            selection={selection}
            selectionStat={selectionStat}
            onCellDown={onCellDown}
            onCellEnter={onCellEnter}
          />
          <button
            type="button"
            onClick={giveUpMatch}
            className="self-center px-4 py-1.5 rounded border border-[var(--sheet-cell-border)] text-[12px] text-[var(--sheet-muted)] hover:bg-black/5"
          >
            그만하기 (점수 확정)
          </button>
        </>
      ) : (
        <EmptyGrid />
      )}

      {phase === "lobby" && (
        <LobbyCard
          title="사과게임"
          description={
            "드래그로 범위를 선택해 합이 10인 숫자들을 지우세요.\n모두 같은 판을 받고, 120초 동안 더 많이 지운 사람이 승리해요."
          }
          notice={
            matchRunning
              ? amDone
                ? "포기했어요. 진행 중인 대결이 끝나면 결과가 표시돼요."
                : "다른 멤버들이 대결 중이에요. 끝나면 다음 판에 참여할 수 있어요."
              : undefined
          }
          members={lobbyMembers}
          myMemberId={myMemberId}
          isOwner={isOwner}
          onStart={startMatch}
          onReady={toggleReady}
          startError={startError}
          canStart={!matchRunning}
        />
      )}

      {phase === "result" && results && (
        <>
          <ResultCard results={results} myMemberId={myMemberId} />
          <LobbyCard
            title="다시 하기"
            description="다음 라운드를 준비하세요."
            members={lobbyMembers}
            myMemberId={myMemberId}
            isOwner={isOwner}
            onStart={startMatch}
            onReady={toggleReady}
            startError={startError}
          />
        </>
      )}
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
    case "not_ready":
      return "모든 참가자가 준비해야 시작할 수 있어요.";
    default:
      return "시작에 실패했어요.";
  }
}

function Scoreboard({
  players,
  myMemberId,
  myNickname,
  remainingSec,
  playing,
  myScore,
}: {
  players: Player[];
  myMemberId: string;
  myNickname: string;
  remainingSec: number;
  playing: boolean;
  myScore: number;
}) {
  return (
    <div className="flex items-stretch gap-0 border border-[var(--sheet-cell-border)] bg-white">
      <div className="flex flex-col items-center min-w-[100px] px-3 py-2 border-r border-[var(--sheet-cell-border)]">
        <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
          남은 시간
        </span>
        <span className="text-[20px] tabular-nums">
          {playing ? `${remainingSec}s` : "—"}
        </span>
      </div>
      <div className="flex flex-col items-center min-w-[100px] px-3 py-2 border-r border-[var(--sheet-cell-border)]">
        <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
          내 점수
        </span>
        <span className="text-[20px] tabular-nums">{myScore}</span>
      </div>
      <div className="flex-1 px-3 py-1.5 overflow-x-auto">
        <div className="flex gap-2">
          {players.length === 0 && (
            <span className="text-[12px] text-[var(--sheet-muted)]">
              참가자 없음 — 게임을 시작하세요
            </span>
          )}
          {players.map((p, i) => {
            const isMe = p.memberId === myMemberId;
            const label =
              (isMe ? `${p.nickname} (나)` : p.nickname) +
              (p.done ? " · 포기" : "");
            return (
              <div
                key={p.memberId}
                className={
                  "flex items-center gap-2 px-2 py-1 rounded text-[12px] " +
                  (isMe
                    ? "bg-[var(--sheet-active-bg)] text-[var(--sheet-active)]"
                    : "bg-[var(--sheet-header-bg)] text-[var(--sheet-fg)]")
                }
              >
                <span className="font-medium">#{i + 1}</span>
                <span>{label}</span>
                <span className="tabular-nums">{p.score}</span>
              </div>
            );
          })}
        </div>
        <span className="sr-only">{myNickname}</span>
      </div>
    </div>
  );
}

function NumberGrid({
  board,
  cleared,
  selection,
  selectionStat,
  onCellDown,
  onCellEnter,
}: {
  board: number[];
  cleared: boolean[];
  selection: Selection | null;
  selectionStat: { sum: number; count: number };
  onCellDown: (r: number, c: number) => void;
  onCellEnter: (r: number, c: number) => void;
}) {
  const rect = selection ? rectOf(selection) : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="border border-[var(--sheet-cell-border)] bg-white select-none">
        {/* 열 머리글 (A~Q) — 시트 위장용 */}
        <div className="flex bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
          <div
            className="border-r border-[var(--sheet-cell-border)]"
            style={{ width: 28, height: 20 }}
          />
          {COL_LETTERS.map((l) => (
            <div
              key={l}
              style={{ width: CELL_W, height: 20 }}
              className="border-r border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
            >
              {l}
            </div>
          ))}
        </div>
        <div className="flex">
          {/* 행 번호 (1~10) */}
          <div className="flex flex-col bg-[var(--sheet-header-bg)]">
            {Array.from({ length: ROWS }).map((_, r) => (
              <div
                key={r}
                style={{ width: 28, height: CELL_H }}
                className="border-r border-b border-[var(--sheet-cell-border)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
              >
                {r + 1}
              </div>
            ))}
          </div>
          {/* 숫자판 + 선택 오버레이 */}
          <div className="relative">
            {Array.from({ length: ROWS }).map((_, r) => (
              <div key={r} className="flex">
                {Array.from({ length: COLS }).map((_, c) => {
                  const idx = r * COLS + c;
                  const inRect =
                    rect != null &&
                    r >= rect.rMin &&
                    r <= rect.rMax &&
                    c >= rect.cMin &&
                    c <= rect.cMax;
                  return (
                    <div
                      key={c}
                      style={{ width: CELL_W, height: CELL_H }}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        onCellDown(r, c);
                      }}
                      onMouseEnter={() => onCellEnter(r, c)}
                      className={
                        "border-r border-b border-[var(--sheet-cell-border)] grid place-items-center text-[13px] tabular-nums cursor-cell " +
                        (inRect
                          ? "bg-[var(--sheet-active-bg)] "
                          : "bg-white ") +
                        (cleared[idx]
                          ? "text-transparent"
                          : "text-[var(--sheet-fg)]")
                      }
                    >
                      {cleared[idx] ? "" : board[idx]}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* 시트 범위 선택 테두리 */}
            {rect && (
              <div
                className="absolute pointer-events-none border-2 border-[var(--sheet-active)]"
                style={{
                  left: rect.cMin * CELL_W,
                  top: rect.rMin * CELL_H,
                  width: (rect.cMax - rect.cMin + 1) * CELL_W,
                  height: (rect.rMax - rect.rMin + 1) * CELL_H,
                }}
              />
            )}
          </div>
        </div>
      </div>
      {/* 시트 하단 상태줄 흉내 — 선택 합계 */}
      <div className="w-full max-w-[600px] flex justify-end gap-4 text-[11px] text-[var(--sheet-muted)] tabular-nums">
        <span
          className={
            selection && selectionStat.sum === TARGET_SUM
              ? "text-[var(--sheet-green)] font-medium"
              : undefined
          }
        >
          합계: {selection ? selectionStat.sum : 0}
        </span>
        <span>개수: {selection ? selectionStat.count : 0}</span>
        <span>Ctrl+B로 즉시 시트 홈으로 이동</span>
      </div>
    </div>
  );
}

function EmptyGrid() {
  return (
    <div className="grid grid-cols-4 gap-2 min-h-[200px] p-4 border border-[var(--sheet-cell-border)] bg-white">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-16 border border-dashed border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]"
        />
      ))}
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
                <td className="px-2 py-1 tabular-nums">{r.rank}</td>
                <td className="px-2 py-1">
                  {r.nickname}
                  {isMe ? " (나)" : ""}
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
