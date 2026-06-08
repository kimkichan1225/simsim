// 섯다 화투 카드·족보 순수 로직 — 서버(sutda.ts)와 클라(SutdaGame)가 공유한다.
// 광은 1·3·8월. 특수패는 패 종류(광·열끗·띠)까지 일치해야 한다.

export type CardKind = "gwang" | "yeol" | "tti"; // 광·열끗·띠
export type HwatuCard = { id: string; month: number; kind: CardKind };

// 쇼다운에서 상황(상대 패)에 따라 서열이 바뀌는 특수패가 있어 카테고리로 분리한다.
export type HandCategory =
  | { t: "g38" } // 38광땡
  | { t: "gwang" } // 13/18광땡
  | { t: "ddaeng"; v: number } // 1~10땡(10=장땡)
  | { t: "amhaeng" } // 암행어사
  | { t: "ddangjabi" } // 땡잡이
  | { t: "menggusa" } // 멍텅구리구사
  | { t: "gusa" } // 구사
  | { t: "special"; r: number; name: string } // 알리/독사/구삥/장삥/장사/세륙
  | { t: "kkut"; v: number }; // 0~9끗

// 섯다 20장 구성(피 제외). 광은 1·3·8월.
export const DECK_SPEC: [number, CardKind][] = [
  [1, "gwang"], [1, "tti"],
  [2, "yeol"], [2, "tti"],
  [3, "gwang"], [3, "tti"],
  [4, "yeol"], [4, "tti"],
  [5, "yeol"], [5, "tti"],
  [6, "yeol"], [6, "tti"],
  [7, "yeol"], [7, "tti"],
  [8, "gwang"], [8, "yeol"],
  [9, "yeol"], [9, "tti"],
  [10, "yeol"], [10, "tti"],
];

const SPECIALS: Record<string, [number, string]> = {
  "1,2": [780, "알리"],
  "1,4": [770, "독사"],
  "1,9": [760, "구삥"],
  "1,10": [750, "장삥"],
  "4,10": [740, "장사"],
  "4,6": [730, "세륙"],
};

function isPair(
  a: HwatuCard,
  b: HwatuCard,
  m1: number,
  k1: CardKind,
  m2: number,
  k2: CardKind,
): boolean {
  return (
    (a.month === m1 && a.kind === k1 && b.month === m2 && b.kind === k2) ||
    (a.month === m2 && a.kind === k2 && b.month === m1 && b.kind === k1)
  );
}

// 두 장의 족보. name은 화면 표시용.
export function evaluate2(
  a: HwatuCard,
  b: HwatuCard,
): { cat: HandCategory; name: string } {
  const lo = Math.min(a.month, b.month);
  const hi = Math.max(a.month, b.month);

  // 광땡(둘 다 광)
  if (a.kind === "gwang" && b.kind === "gwang") {
    if (lo === 3 && hi === 8) return { cat: { t: "g38" }, name: "38광땡" };
    return {
      cat: { t: "gwang" },
      name: lo === 1 && hi === 3 ? "13광땡" : "18광땡",
    };
  }
  // 땡(같은 월)
  if (a.month === b.month) {
    const v = a.month;
    return { cat: { t: "ddaeng", v }, name: v === 10 ? "장땡" : `${v}땡` };
  }
  // 특수패(패 종류까지 일치)
  if (isPair(a, b, 3, "gwang", 7, "yeol")) {
    return { cat: { t: "ddangjabi" }, name: "땡잡이" };
  }
  if (isPair(a, b, 4, "yeol", 7, "yeol")) {
    return { cat: { t: "amhaeng" }, name: "암행어사" };
  }
  if (isPair(a, b, 4, "yeol", 9, "yeol")) {
    return { cat: { t: "menggusa" }, name: "멍텅구리구사" };
  }
  // 구사(4·9 — 멍구사 아닌 나머지)
  if (lo === 4 && hi === 9) return { cat: { t: "gusa" }, name: "구사" };
  // 특수 조합(월)
  const sp = SPECIALS[`${lo},${hi}`];
  if (sp) return { cat: { t: "special", r: sp[0], name: sp[1] }, name: sp[1] };
  // 끗수
  const kkut = (a.month + b.month) % 10;
  const name = kkut === 9 ? "갑오" : kkut === 0 ? "망통" : `${kkut}끗`;
  return { cat: { t: "kkut", v: kkut }, name };
}

// 상대를 고려하지 않은 대략 서열(미리보기·정렬용). 특수패는 발동 가정 최대치.
export function soloRank(cat: HandCategory): number {
  switch (cat.t) {
    case "g38":
      return 1000;
    case "amhaeng":
      return 950;
    case "gwang":
      return 900;
    case "ddaeng":
      return 800 + cat.v;
    case "ddangjabi":
      return 809.5;
    case "special":
      return cat.r;
    case "menggusa":
    case "gusa":
      return 3;
    case "kkut":
      return cat.v;
  }
}

// 3장 중 가장 높은(단순 서열) 2장 — 실시간 미리보기/자동 선택용.
export function bestTwoOf(cards: HwatuCard[]): {
  pick: [number, number];
  name: string;
} {
  let best = -Infinity;
  let pick: [number, number] = [0, 1];
  let name = "-";
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      const ev = evaluate2(cards[i], cards[j]);
      const r = soloRank(ev.cat);
      if (r > best) {
        best = r;
        pick = [i, j];
        name = ev.name;
      }
    }
  }
  return { pick, name };
}
