export type TypingMetrics = {
  wpm: number;
  accuracy: number;
  charsCorrect: number;
  charsIncorrect: number;
};

const KO_CHARS_PER_WORD = 2.5;
const EN_CHARS_PER_WORD = 5;

export function computeMetrics(input: {
  expected: string;
  actual: string;
  elapsedMs: number;
  lang: "ko" | "en";
}): TypingMetrics {
  const { expected, actual, elapsedMs, lang } = input;
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

  const totalKeyed = correct + incorrect;
  const accuracy = totalKeyed === 0 ? 1 : correct / totalKeyed;

  const minutes = elapsedMs / 60000;
  const charsPerWord = lang === "ko" ? KO_CHARS_PER_WORD : EN_CHARS_PER_WORD;
  const wpm = minutes > 0 ? correct / charsPerWord / minutes : 0;

  return {
    wpm,
    accuracy,
    charsCorrect: correct,
    charsIncorrect: incorrect,
  };
}

export function diffChars(
  expected: string,
  actual: string,
): Array<"ok" | "bad" | "pending"> {
  const out: Array<"ok" | "bad" | "pending"> = [];
  for (let i = 0; i < expected.length; i++) {
    if (i >= actual.length) {
      out.push("pending");
    } else if (expected[i] === actual[i]) {
      out.push("ok");
    } else {
      out.push("bad");
    }
  }
  return out;
}
