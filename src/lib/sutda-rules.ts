// LA섯다 카드·족보 순수 로직 — 서버(sutda.ts)와 클라(SutdaGame)가 공유한다.
// 트럼프 ♠스페이드·♦다이아 A(1)~10, 총 20장. 광 = ♠A·♠3·♠8.
// 특수패는 ♠스페이드끼리의 조합이어야 한다.

export type Suit = "spade" | "diamond";
// num: 1=A, 2~10
export type SutdaCard = { id: string; num: number; suit: Suit };

// 쇼다운에서 상황(상대 패)에 따라 서열이 바뀌는 특수패가 있어 카테고리로 분리한다.
export type HandCategory =
  | { t: "g38" } // 삼팔광땡
  | { t: "gwang" } // 일팔·일삼광땡
  | { t: "ddaeng"; v: number } // 1~10땡(10=장땡)
  | { t: "amhaeng" } // 47암행어사
  | { t: "ddangjabi" } // 37땡잡이
  | { t: "menggusa" } // 멍텅구리구사
  | { t: "gusa" } // 구사
  | { t: "special"; r: number; name: string } // 알리/독사/구삥/장삥/장사/세륙
  | { t: "kkut"; v: number }; // 0~9끗

// 20장 구성 — ♠ A~10, ♦ A~10
export const DECK_SPEC: [number, Suit][] = [
  [1, "spade"], [2, "spade"], [3, "spade"], [4, "spade"], [5, "spade"],
  [6, "spade"], [7, "spade"], [8, "spade"], [9, "spade"], [10, "spade"],
  [1, "diamond"], [2, "diamond"], [3, "diamond"], [4, "diamond"], [5, "diamond"],
  [6, "diamond"], [7, "diamond"], [8, "diamond"], [9, "diamond"], [10, "diamond"],
];

// 광 = ♠ A·3·8
export function isGwang(c: SutdaCard): boolean {
  return c.suit === "spade" && (c.num === 1 || c.num === 3 || c.num === 8);
}

const SPECIALS: Record<string, [number, string]> = {
  "1,2": [780, "알리"],
  "1,4": [770, "독사"],
  "1,9": [760, "구삥"],
  "1,10": [750, "장삥"],
  "4,10": [740, "장사"],
  "4,6": [730, "세륙"],
};

// 두 장의 족보. name은 화면 표시용.
export function evaluate2(
  a: SutdaCard,
  b: SutdaCard,
): { cat: HandCategory; name: string } {
  const lo = Math.min(a.num, b.num);
  const hi = Math.max(a.num, b.num);

  // 광땡(둘 다 광 ♠A·3·8)
  if (isGwang(a) && isGwang(b)) {
    if (lo === 3 && hi === 8) return { cat: { t: "g38" }, name: "삼팔광땡" };
    if (lo === 1 && hi === 8) return { cat: { t: "gwang" }, name: "일팔광땡" };
    return { cat: { t: "gwang" }, name: "일삼광땡" }; // {1,3}
  }
  // 땡(같은 숫자)
  if (a.num === b.num) {
    const v = a.num;
    return { cat: { t: "ddaeng", v }, name: v === 10 ? "장땡" : `${v}땡` };
  }
  // 특수패(♠끼리)
  if (a.suit === "spade" && b.suit === "spade") {
    if ((lo === 3 && hi === 7)) {
      return { cat: { t: "ddangjabi" }, name: "37땡잡이" };
    }
    if (lo === 4 && hi === 7) {
      return { cat: { t: "amhaeng" }, name: "47암행어사" };
    }
    if (lo === 4 && hi === 9) {
      return { cat: { t: "menggusa" }, name: "멍텅구리구사" };
    }
  }
  // 구사(4·9 — 멍구사 아닌 나머지)
  if (lo === 4 && hi === 9) return { cat: { t: "gusa" }, name: "구사" };
  // 특수 조합(숫자, 무늬 무관)
  const sp = SPECIALS[`${lo},${hi}`];
  if (sp) return { cat: { t: "special", r: sp[0], name: sp[1] }, name: sp[1] };
  // 끗수
  const kkut = (a.num + b.num) % 10;
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
export function bestTwoOf(cards: SutdaCard[]): {
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
