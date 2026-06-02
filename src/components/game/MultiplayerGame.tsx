"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Participant = {
  memberId: string;
  nickname: string;
  score: number;
};

type ActiveWord = {
  id: string;
  text: string;
  lang: "ko" | "en";
  points: number;
};

type GameResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
};

type GameStatus = "idle" | "running" | "ended";

type Snapshot = {
  type: "snapshot";
  gameId: string;
  startedAt: number;
  endsAt: number;
  status: "running" | "ended";
  participants: Participant[];
  activeWords: ActiveWord[];
  results?: GameResult[];
};

type ServerEvent =
  | Snapshot
  | { type: "no_game" }
  | { type: "participant_joined"; memberId: string; nickname: string }
  | {
      type: "word_claimed";
      wordId: string;
      byMemberId: string;
      points: number;
      newScore: number;
    }
  | { type: "word_spawned"; word: ActiveWord }
  | { type: "game_ended"; results: GameResult[] }
  | { type: "group_destroyed" };

type State = {
  status: GameStatus;
  gameId: string | null;
  startedAt: number | null;
  endsAt: number | null;
  participants: Participant[];
  activeWords: ActiveWord[];
  results: GameResult[] | null;
  flash: { memberId: string; nickname: string; points: number; at: number } | null;
};

const initialState: State = {
  status: "idle",
  gameId: null,
  startedAt: null,
  endsAt: null,
  participants: [],
  activeWords: [],
  results: null,
  flash: null,
};

export function MultiplayerGame({
  myMemberId,
  myNickname,
  isOwner,
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(initialState);
  const [input, setInput] = useState("");
  const [activeWordId, setActiveWordId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [startError, setStartError] = useState<string | null>(null);

  const composingRef = useRef(false);
  const claimingRef = useRef<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  // 자동 참여를 게임당 한 번만 호출하기 위한 추적 ref
  const joinedGameIdRef = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const activeWordIdRef = useRef(activeWordId);
  activeWordIdRef.current = activeWordId;

  const applyEvent = useCallback((ev: ServerEvent) => {
    setState((prev) => {
      switch (ev.type) {
        case "snapshot": {
          return {
            ...prev,
            status: ev.status,
            gameId: ev.gameId,
            startedAt: ev.startedAt,
            endsAt: ev.endsAt,
            participants: ev.participants,
            activeWords: ev.activeWords,
            results:
              ev.status === "ended"
                ? (ev.results ?? prev.results)
                : null,
          };
        }
        case "no_game":
          return { ...initialState };
        case "participant_joined": {
          if (prev.participants.some((p) => p.memberId === ev.memberId)) {
            return prev;
          }
          return {
            ...prev,
            participants: [
              ...prev.participants,
              { memberId: ev.memberId, nickname: ev.nickname, score: 0 },
            ],
          };
        }
        case "word_claimed": {
          const nextParticipants = prev.participants.map((p) =>
            p.memberId === ev.byMemberId ? { ...p, score: ev.newScore } : p,
          );
          const claimedWord = prev.activeWords.find((w) => w.id === ev.wordId);
          const nextWords = prev.activeWords.filter((w) => w.id !== ev.wordId);
          const claimerNickname =
            nextParticipants.find((p) => p.memberId === ev.byMemberId)?.nickname ??
            "?";
          return {
            ...prev,
            participants: nextParticipants,
            activeWords: nextWords,
            flash: claimedWord
              ? {
                  memberId: ev.byMemberId,
                  nickname: claimerNickname,
                  points: ev.points,
                  at: Date.now(),
                }
              : prev.flash,
          };
        }
        case "word_spawned": {
          if (prev.activeWords.some((w) => w.id === ev.word.id)) return prev;
          return { ...prev, activeWords: [...prev.activeWords, ev.word] };
        }
        case "game_ended":
          return {
            ...prev,
            status: "ended",
            results: ev.results,
            activeWords: [],
          };
        default:
          return prev;
      }
    });
  }, []);

  // 방 폭파 시: 세션 정리 후 입장 화면으로 돌아간다.
  const handleDestroyed = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  // SSE 연결
  useEffect(() => {
    const es = new EventSource("/api/play/stream");
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

  // 진행 중인 게임에 내가 아직 참가자가 아니면 자동으로 합류한다(시작은 방장만).
  useEffect(() => {
    if (state.status !== "running" || !state.gameId) return;
    const amParticipant = state.participants.some(
      (p) => p.memberId === myMemberId,
    );
    if (amParticipant) {
      joinedGameIdRef.current = state.gameId;
      return;
    }
    if (joinedGameIdRef.current === state.gameId) return;
    joinedGameIdRef.current = state.gameId;
    void fetch("/api/play/join", { method: "POST" }).catch(() => {
      // 실패 시 다음 스냅샷에서 재시도할 수 있도록 추적값을 되돌린다.
      joinedGameIdRef.current = null;
    });
  }, [state.status, state.gameId, state.participants, myMemberId]);

  // UI 클럭 (남은 시간)
  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [state.status]);

  // 게임 상태 전환 시 입력 초기화
  useEffect(() => {
    if (state.status !== "running") {
      setInput("");
      setActiveWordId(null);
    }
  }, [state.status]);

  // 활성 단어가 사라지면 입력 초기화
  useEffect(() => {
    if (!activeWordId) return;
    if (!state.activeWords.some((w) => w.id === activeWordId)) {
      setInput("");
      setActiveWordId(null);
    }
  }, [activeWordId, state.activeWords]);

  // 게임 시작 시 입력에 포커스
  useEffect(() => {
    if (state.status === "running") {
      inputRef.current?.focus();
    }
  }, [state.status]);

  const remainingSec = useMemo(() => {
    if (state.status !== "running" || state.endsAt == null) return 0;
    return Math.max(0, Math.ceil((state.endsAt - now) / 1000));
  }, [state.status, state.endsAt, now]);

  const sortedParticipants = useMemo(
    () => [...state.participants].sort((a, b) => b.score - a.score),
    [state.participants],
  );

  const startGame = useCallback(async () => {
    setStartError(null);
    try {
      const res = await fetch("/api/play/start", { method: "POST" });
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

  const tryClaim = useCallback(async (wordId: string, text: string) => {
    if (claimingRef.current.has(wordId)) return;
    claimingRef.current.add(wordId);
    try {
      await fetch("/api/play/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wordId, text }),
      });
    } catch {
      /* ignore */
    } finally {
      claimingRef.current.delete(wordId);
      setInput("");
      setActiveWordId(null);
    }
  }, []);

  const matchAndMaybeClaim = useCallback(
    (value: string) => {
      if (value.length === 0) {
        setActiveWordId(null);
        return;
      }
      const words = stateRef.current.activeWords;
      const currentActiveId = activeWordIdRef.current;
      if (currentActiveId) {
        const w = words.find((it) => it.id === currentActiveId);
        if (w && w.text.startsWith(value)) {
          if (w.text === value) void tryClaim(w.id, value);
          return;
        }
      }
      const candidates = words.filter((w) => w.text.startsWith(value));
      if (candidates.length === 0) {
        setActiveWordId(null);
        return;
      }
      candidates.sort((a, b) => a.text.length - b.text.length);
      const chosen = candidates[0];
      setActiveWordId(chosen.id);
      if (chosen.text === value) void tryClaim(chosen.id, value);
    },
    [tryClaim],
  );

  function onInputChange(value: string) {
    if (state.status !== "running") return;
    setInput(value);
    if (composingRef.current) return;
    matchAndMaybeClaim(value);
  }

  function onCompositionStart() {
    composingRef.current = true;
  }

  function onCompositionEnd(e: React.CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    if (state.status !== "running") return;
    const value = (e.target as HTMLInputElement).value;
    setInput(value);
    matchAndMaybeClaim(value);
  }

  const myScore =
    sortedParticipants.find((p) => p.memberId === myMemberId)?.score ?? 0;

  return (
    <div className="flex flex-col gap-4 w-full pt-4 pb-8">
      <Scoreboard
        participants={sortedParticipants}
        myMemberId={myMemberId}
        remainingSec={remainingSec}
        status={state.status}
        myScore={myScore}
        myNickname={myNickname}
      />
      <WordField
        words={state.activeWords}
        activeWordId={activeWordId}
        input={input}
        status={state.status}
      />
      <FlashLine flash={state.flash} myMemberId={myMemberId} now={now} />
      {state.status === "idle" &&
        (isOwner ? (
          <StartCard onStart={startGame} error={startError} />
        ) : (
          <WaitingCard />
        ))}
      {state.status === "running" && (
        <InputArea
          input={input}
          inputRef={inputRef}
          onChange={onInputChange}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
        />
      )}
      {state.status === "ended" && state.results && (
        <ResultCard
          results={state.results}
          myMemberId={myMemberId}
          onRestart={startGame}
          canRestart={isOwner}
        />
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
    default:
      return "시작에 실패했어요.";
  }
}

function Scoreboard({
  participants,
  myMemberId,
  remainingSec,
  status,
  myScore,
  myNickname,
}: {
  participants: Participant[];
  myMemberId: string;
  remainingSec: number;
  status: GameStatus;
  myScore: number;
  myNickname: string;
}) {
  return (
    <div className="flex items-stretch gap-0 border border-[var(--sheet-cell-border)] bg-white">
      <div className="flex flex-col items-center min-w-[100px] px-3 py-2 border-r border-[var(--sheet-cell-border)]">
        <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
          남은 시간
        </span>
        <span className="text-[20px] tabular-nums">
          {status === "running" ? `${remainingSec}s` : "—"}
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
          {participants.length === 0 && (
            <span className="text-[12px] text-[var(--sheet-muted)]">
              참가자 없음 — 게임을 시작하세요
            </span>
          )}
          {participants.map((p, i) => {
            const isMe = p.memberId === myMemberId;
            const label = isMe ? `${p.nickname} (나)` : p.nickname;
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

function WordField({
  words,
  activeWordId,
  input,
  status,
}: {
  words: ActiveWord[];
  activeWordId: string | null;
  input: string;
  status: GameStatus;
}) {
  if (status !== "running" && words.length === 0) {
    return (
      <div className="grid grid-cols-4 gap-2 min-h-[260px] p-4 border border-[var(--sheet-cell-border)] bg-white">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-16 border border-dashed border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]"
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-2 min-h-[260px] p-4 border border-[var(--sheet-cell-border)] bg-white">
      {words.map((w) => {
        const isActive = w.id === activeWordId;
        const matchedPrefix = isActive ? input : "";
        const remaining = isActive ? w.text.slice(input.length) : w.text;
        return (
          <div
            key={w.id}
            className={
              "relative h-16 px-3 py-2 border bg-white flex items-center justify-center text-center select-none " +
              (isActive
                ? "border-[var(--sheet-active)] ring-2 ring-[var(--sheet-active)] ring-offset-0"
                : "border-[var(--sheet-cell-border)]")
            }
          >
            <span className="absolute top-1 left-2 text-[10px] text-[var(--sheet-muted)]">
              +{w.points}
            </span>
            <span className="text-[18px] font-medium tracking-tight">
              {matchedPrefix && (
                <span className="text-[var(--sheet-green)]">
                  {matchedPrefix}
                </span>
              )}
              <span className={isActive ? "text-[var(--sheet-fg)]" : "text-[var(--sheet-fg)]"}>
                {remaining}
              </span>
            </span>
          </div>
        );
      })}
      {Array.from({ length: Math.max(0, 8 - words.length) }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="h-16 border border-dashed border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]"
        />
      ))}
    </div>
  );
}

function FlashLine({
  flash,
  myMemberId,
  now,
}: {
  flash: State["flash"];
  myMemberId: string;
  now: number;
}) {
  if (!flash) {
    return <div className="h-5" />;
  }
  if (now - flash.at > 2000) {
    return <div className="h-5" />;
  }
  const isMe = flash.memberId === myMemberId;
  return (
    <div
      className={
        "h-5 text-center text-[12px] " +
        (isMe ? "text-[var(--sheet-green)]" : "text-[var(--sheet-muted)]")
      }
    >
      {isMe
        ? `+${flash.points}점 획득`
        : `${flash.nickname}이(가) +${flash.points}점`}
    </div>
  );
}

function WaitingCard() {
  return (
    <div className="flex flex-col items-center gap-3 p-6 border border-[var(--sheet-cell-border)] bg-white">
      <p className="text-[13px] text-[var(--sheet-muted)] text-center">
        방장이 게임을 시작하기를 기다리는 중이에요.
        <br />
        시작되면 자동으로 참여됩니다.
      </p>
    </div>
  );
}

function StartCard({
  onStart,
  error,
}: {
  onStart: () => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 border border-[var(--sheet-cell-border)] bg-white">
      <p className="text-[13px] text-[var(--sheet-muted)] text-center">
        시작하면 30초 동안 단어 줍기 대결이 시작됩니다.
        <br />같은 그룹의 다른 사람들도 자동으로 참여할 수 있어요.
      </p>
      {error && <div className="text-[13px] text-[#d93025]">{error}</div>}
      <button
        type="button"
        onClick={onStart}
        className="px-5 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium"
      >
        시작
      </button>
    </div>
  );
}

function InputArea({
  input,
  inputRef,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  input: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-1 items-center">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full max-w-md px-3 py-2 border border-[var(--sheet-active)] outline-none text-[18px] bg-[var(--sheet-active-bg)] text-center tabular-nums"
        placeholder="셀에 보이는 단어를 빠르게 입력하세요"
      />
      <div className="text-[11px] text-[var(--sheet-muted)]">
        Ctrl+B로 즉시 시트 홈으로 이동
      </div>
    </div>
  );
}

function ResultCard({
  results,
  myMemberId,
  onRestart,
  canRestart,
}: {
  results: GameResult[];
  myMemberId: string;
  onRestart: () => void;
  canRestart: boolean;
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
      {canRestart ? (
        <button
          type="button"
          onClick={onRestart}
          className="mt-2 px-4 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium"
        >
          다시 시작
        </button>
      ) : (
        <p className="mt-2 text-[12px] text-[var(--sheet-muted)]">
          방장이 다시 시작할 수 있어요.
        </p>
      )}
    </div>
  );
}
