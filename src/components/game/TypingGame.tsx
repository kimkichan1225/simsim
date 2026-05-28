"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { pickPhrase, type Phrase } from "@/lib/words";
import { diffChars } from "@/lib/typing";

type Phase = "idle" | "starting" | "playing" | "done" | "submitting";

const DURATION_SEC = 60;
const CHARS_PER_WORD_MIXED = 3.5;

export type FinalResult = {
  runId: string;
  mode: string;
  language: string;
  wpm: number;
  accuracy: number;
  charsCorrect: number;
  charsIncorrect: number;
  durationSec: number;
  phrases: number;
};

export function TypingGame({
  onSubmitResult,
}: {
  onSubmitResult?: (result: FinalResult) => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [phrase, setPhrase] = useState<Phrase>(() => pickPhrase());
  const [input, setInput] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phraseCount, setPhraseCount] = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalIncorrect, setTotalIncorrect] = useState(0);
  const [finalResult, setFinalResult] = useState<FinalResult | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const runIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const advanceLockRef = useRef(false);
  const finishedRef = useRef(false);

  const remainingSec = useMemo(() => {
    if (phase !== "playing" || startedAt === null) return DURATION_SEC;
    return Math.max(0, Math.ceil((DURATION_SEC * 1000 - elapsedMs) / 1000));
  }, [phase, startedAt, elapsedMs]);

  const liveMetrics = useMemo(() => {
    if (phase === "idle" || phase === "starting") {
      return { wpm: 0, accuracy: 1, correct: 0, incorrect: 0 };
    }
    const partial = countChars(phrase.text, input);
    const correct = totalCorrect + partial.correct;
    const incorrect = totalIncorrect + partial.incorrect;
    const totalKeyed = correct + incorrect;
    const baseElapsed = phase === "done" || phase === "submitting" ? DURATION_SEC * 1000 : Math.max(elapsedMs, 1);
    const minutes = baseElapsed / 60000;
    const wpm = minutes > 0 ? correct / CHARS_PER_WORD_MIXED / minutes : 0;
    const accuracy = totalKeyed === 0 ? 1 : correct / totalKeyed;
    return { wpm, accuracy, correct, incorrect };
  }, [phase, elapsedMs, input, phrase, totalCorrect, totalIncorrect]);

  useEffect(() => {
    if (phase !== "playing" || startedAt === null) return;
    const id = setInterval(() => {
      const e = Date.now() - startedAt;
      if (e >= DURATION_SEC * 1000) {
        setElapsedMs(DURATION_SEC * 1000);
        setPhase("done");
      } else {
        setElapsedMs(e);
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  useEffect(() => {
    if (phase !== "done" || finishedRef.current) return;
    finishedRef.current = true;
    const partial = countChars(phrase.text, input);
    const correct = totalCorrect + partial.correct;
    const incorrect = totalIncorrect + partial.incorrect;
    const totalKeyed = correct + incorrect;
    const minutes = DURATION_SEC / 60;
    const wpm = minutes > 0 ? correct / CHARS_PER_WORD_MIXED / minutes : 0;
    const accuracy = totalKeyed === 0 ? 1 : correct / totalKeyed;
    const runId = runIdRef.current;
    if (!runId) {
      setFinalResult({
        runId: "",
        mode: "60s",
        language: "mixed",
        wpm,
        accuracy,
        charsCorrect: correct,
        charsIncorrect: incorrect,
        durationSec: DURATION_SEC,
        phrases: phraseCount,
      });
      return;
    }
    const result: FinalResult = {
      runId,
      mode: "60s",
      language: "mixed",
      wpm,
      accuracy,
      charsCorrect: correct,
      charsIncorrect: incorrect,
      durationSec: DURATION_SEC,
      phrases: phraseCount,
    };
    setFinalResult(result);
    setPhase("submitting");
    Promise.resolve(onSubmitResult?.(result)).finally(() => {
      setPhase("done");
    });
  }, [phase, phrase, input, totalCorrect, totalIncorrect, phraseCount, onSubmitResult]);

  const startGame = useCallback(async () => {
    setStartError(null);
    setPhase("starting");
    try {
      const res = await fetch("/api/game/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setStartError(translateStartError(data?.error));
        setPhase("idle");
        return;
      }
      const data = (await res.json()) as {
        runId: string;
        serverStartedAt: number;
      };
      runIdRef.current = data.runId;
      finishedRef.current = false;
      advanceLockRef.current = false;
      composingRef.current = false;
      setPhrase(pickPhrase());
      setInput("");
      setStartedAt(Date.now());
      setElapsedMs(0);
      setPhraseCount(0);
      setTotalCorrect(0);
      setTotalIncorrect(0);
      setFinalResult(null);
      setPhase("playing");
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setStartError("연결에 실패했어요.");
      setPhase("idle");
    }
  }, []);

  const resetToIdle = useCallback(() => {
    setPhase("idle");
    setStartedAt(null);
    setElapsedMs(0);
    setInput("");
    setPhrase(pickPhrase());
    setFinalResult(null);
    runIdRef.current = null;
    finishedRef.current = false;
  }, []);

  const tryAdvance = useCallback(
    (actualValue: string) => {
      if (advanceLockRef.current) return;
      if (actualValue !== phrase.text) return;
      advanceLockRef.current = true;
      const m = countChars(phrase.text, actualValue);
      setTotalCorrect((v) => v + m.correct);
      setTotalIncorrect((v) => v + m.incorrect);
      setPhraseCount((v) => v + 1);
      setPhrase((prev) => pickPhrase(prev));
      setInput("");
      setTimeout(() => {
        advanceLockRef.current = false;
      }, 0);
    },
    [phrase],
  );

  function onInputChange(value: string) {
    if (phase !== "playing") return;
    setInput(value);
    if (composingRef.current) return;
    if (value === phrase.text) tryAdvance(value);
  }

  function onCompositionStart() {
    composingRef.current = true;
  }

  function onCompositionEnd(value: string) {
    composingRef.current = false;
    if (phase !== "playing") return;
    setInput(value);
    if (value === phrase.text) tryAdvance(value);
  }

  return (
    <div className="flex flex-col items-center w-full max-w-3xl mx-auto pt-12 pb-8">
      <MetricsRow
        timeSec={remainingSec}
        wpm={liveMetrics.wpm}
        accuracy={liveMetrics.accuracy}
        phrases={phraseCount}
      />

      {(phase === "idle" || phase === "starting") && (
        <IdleBoard
          onStart={startGame}
          sample={phrase}
          loading={phase === "starting"}
          error={startError}
        />
      )}
      {phase === "playing" && (
        <PlayingBoard
          phrase={phrase}
          input={input}
          inputRef={inputRef}
          onChange={onInputChange}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(e) =>
            onCompositionEnd((e.target as HTMLInputElement).value)
          }
        />
      )}
      {(phase === "done" || phase === "submitting") && finalResult && (
        <ResultBoard
          result={finalResult}
          submitting={phase === "submitting"}
          onRestart={startGame}
          onClose={resetToIdle}
        />
      )}
    </div>
  );
}

function countChars(expected: string, actual: string) {
  let correct = 0;
  let incorrect = 0;
  const len = Math.min(expected.length, actual.length);
  for (let i = 0; i < len; i++) {
    if (expected[i] === actual[i]) correct += 1;
    else incorrect += 1;
  }
  if (actual.length > expected.length) {
    incorrect += actual.length - expected.length;
  }
  return { correct, incorrect };
}

function translateStartError(code: string | undefined): string {
  switch (code) {
    case "unauthorized":
      return "그룹에 다시 입장해야 해요.";
    case "rate_limited":
      return "잠시 후 다시 시도해주세요.";
    default:
      return "시작에 실패했어요.";
  }
}

function MetricsRow({
  timeSec,
  wpm,
  accuracy,
  phrases,
}: {
  timeSec: number;
  wpm: number;
  accuracy: number;
  phrases: number;
}) {
  const Cell = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col items-center min-w-[88px] px-3 py-1.5 border border-[var(--sheet-cell-border)] bg-white">
      <span className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
        {label}
      </span>
      <span className="text-[18px] tabular-nums text-[var(--sheet-fg)]">
        {value}
      </span>
    </div>
  );
  return (
    <div className="flex items-center gap-0 mb-6 -ml-px">
      <Cell label="남은 시간" value={`${timeSec}s`} />
      <Cell label="WPM" value={wpm.toFixed(0)} />
      <Cell label="정확도" value={`${Math.round(accuracy * 100)}%`} />
      <Cell label="문장" value={String(phrases)} />
    </div>
  );
}

function IdleBoard({
  onStart,
  sample,
  loading,
  error,
}: {
  onStart: () => void;
  sample: Phrase;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-white border border-[var(--sheet-cell-border)] w-full">
      <p className="text-[15px] text-[var(--sheet-muted)] text-center">
        시작 버튼을 누르면 60초 타이핑이 시작됩니다.
        <br />한국어와 영어 문장이 섞여 나옵니다.
      </p>
      <p className="text-[20px] text-[var(--sheet-fg)] font-medium text-center">
        {sample.text}
      </p>
      {error && <div className="text-[13px] text-[#d93025]">{error}</div>}
      <button
        type="button"
        onClick={onStart}
        disabled={loading}
        className="px-6 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium disabled:opacity-60"
      >
        {loading ? "준비 중..." : "시작"}
      </button>
    </div>
  );
}

function PlayingBoard({
  phrase,
  input,
  inputRef,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  phrase: Phrase;
  input: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => void;
}) {
  const diff = diffChars(phrase.text, input);
  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-white border border-[var(--sheet-cell-border)] w-full">
      <div className="text-[24px] leading-9 text-center max-w-2xl font-medium tracking-tight">
        {phrase.text.split("").map((ch, i) => {
          const state = diff[i];
          const cls =
            state === "ok"
              ? "text-[var(--sheet-fg)]"
              : state === "bad"
                ? "text-[#d93025] underline decoration-[#d93025]"
                : "text-[#bdc1c6]";
          return (
            <span key={i} className={cls}>
              {ch}
            </span>
          );
        })}
      </div>
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
        className="w-full max-w-2xl px-3 py-2 border border-[var(--sheet-active)] outline-none text-[18px] bg-[var(--sheet-active-bg)]"
        placeholder="여기에 입력..."
      />
      <div className="text-[11px] text-[var(--sheet-muted)]">
        Ctrl+B로 즉시 시트 홈으로 이동
      </div>
    </div>
  );
}

function ResultBoard({
  result,
  submitting,
  onRestart,
  onClose,
}: {
  result: FinalResult;
  submitting: boolean;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 bg-white border border-[var(--sheet-cell-border)] w-full">
      <h2 className="text-[20px] font-medium">결과</h2>
      <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[14px]">
        <span className="text-[var(--sheet-muted)]">WPM</span>
        <span className="tabular-nums text-right">{result.wpm.toFixed(1)}</span>
        <span className="text-[var(--sheet-muted)]">정확도</span>
        <span className="tabular-nums text-right">
          {Math.round(result.accuracy * 100)}%
        </span>
        <span className="text-[var(--sheet-muted)]">완성한 문장</span>
        <span className="tabular-nums text-right">{result.phrases}</span>
        <span className="text-[var(--sheet-muted)]">맞은 문자</span>
        <span className="tabular-nums text-right">{result.charsCorrect}</span>
        <span className="text-[var(--sheet-muted)]">틀린 문자</span>
        <span className="tabular-nums text-right">{result.charsIncorrect}</span>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          onClick={onRestart}
          disabled={submitting}
          className="px-4 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium disabled:opacity-60"
        >
          {submitting ? "저장 중..." : "다시 시작"}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="px-4 py-2 rounded border border-[var(--sheet-border)] text-[14px] disabled:opacity-60"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
