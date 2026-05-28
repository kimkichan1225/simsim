const MAX_CHARS_PER_SECOND = 20;
const MIN_DURATION_SEC = 30;
const MAX_DURATION_SEC = 90;
const VALID_MODES = new Set(["60s"]);
const VALID_LANGS = new Set(["ko", "en", "mixed"]);

export type VerifiedRun = {
  mode: string;
  language: string;
  wpm: number;
  accuracy: number;
  durationSec: number;
  charsCorrect: number;
  charsIncorrect: number;
  startedAt: Date;
  finishedAt: Date;
};

export type RawRun = {
  mode: string;
  language: string;
  charsCorrect: number;
  charsIncorrect: number;
  serverStartedAt: number;
  finishedAt: number;
};

export type VerifyError = { error: string };

const CHARS_PER_WORD: Record<string, number> = {
  ko: 2.5,
  en: 5,
  mixed: 3.5,
};

export function verifyRun(raw: RawRun): VerifiedRun | VerifyError {
  if (
    !Number.isFinite(raw.charsCorrect) ||
    !Number.isFinite(raw.charsIncorrect) ||
    !Number.isFinite(raw.serverStartedAt) ||
    !Number.isFinite(raw.finishedAt)
  ) {
    return { error: "non_finite" };
  }
  if (raw.charsCorrect < 0 || raw.charsIncorrect < 0) {
    return { error: "negative_chars" };
  }
  if (!VALID_MODES.has(raw.mode)) {
    return { error: "invalid_mode" };
  }
  if (!VALID_LANGS.has(raw.language)) {
    return { error: "invalid_language" };
  }
  if (raw.finishedAt <= raw.serverStartedAt) {
    return { error: "bad_time_range" };
  }
  const durationSec = (raw.finishedAt - raw.serverStartedAt) / 1000;
  if (durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
    return { error: "duration_out_of_range" };
  }
  const totalChars = raw.charsCorrect + raw.charsIncorrect;
  if (totalChars > durationSec * MAX_CHARS_PER_SECOND) {
    return { error: "impossible_throughput" };
  }

  const cpw = CHARS_PER_WORD[raw.language] ?? CHARS_PER_WORD.mixed;
  const minutes = durationSec / 60;
  const wpm = minutes > 0 ? raw.charsCorrect / cpw / minutes : 0;
  const accuracy = totalChars === 0 ? 1 : raw.charsCorrect / totalChars;

  return {
    mode: raw.mode,
    language: raw.language,
    wpm,
    accuracy,
    durationSec: Math.round(durationSec),
    charsCorrect: raw.charsCorrect,
    charsIncorrect: raw.charsIncorrect,
    startedAt: new Date(raw.serverStartedAt),
    finishedAt: new Date(raw.finishedAt),
  };
}

export { CHARS_PER_WORD };
