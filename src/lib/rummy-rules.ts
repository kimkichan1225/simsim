// 루미큐브 타일/세트 룰 — 서버(rummy.ts)와 클라이언트(RummyGame)가 공유하는 순수 로직

export type RummyTile = {
  id: string;
  color: number; // 0~3 (조커는 -1)
  value: number; // 1~13 (조커는 0)
  joker: boolean;
};

export const RUMMY_COLORS = 4;
export const JOKER_PENALTY = 30; // 손에 남은 조커 벌점
export const INITIAL_MELD_POINTS = 30;

// 세트(주어진 배치 순서) 유효성 검사 + 점수(조커는 대체값으로 계산)
export function validateSet(tiles: RummyTile[]): {
  ok: boolean;
  points: number;
} {
  if (tiles.length < 3) return { ok: false, points: 0 };
  const nonJokers = tiles.filter((t) => !t.joker);
  // 조커만으로는 값을 특정할 수 없다
  if (nonJokers.length === 0) return { ok: false, points: 0 };

  // 그룹: 3~4장, 같은 값, (비조커끼리) 색 중복 없음
  if (tiles.length <= 4) {
    const v = nonJokers[0].value;
    const sameValue = nonJokers.every((t) => t.value === v);
    const colors = new Set(nonJokers.map((t) => t.color));
    if (sameValue && colors.size === nonJokers.length) {
      return { ok: true, points: v * tiles.length };
    }
  }

  // 런: 같은 색 연속(배치 순서 기준, 조커가 빈 자리를 채운다)
  const color = nonJokers[0].color;
  if (!nonJokers.every((t) => t.color === color)) {
    return { ok: false, points: 0 };
  }
  const firstIdx = tiles.findIndex((t) => !t.joker);
  const startValue = tiles[firstIdx].value - firstIdx;
  if (startValue < 1 || startValue + tiles.length - 1 > 13) {
    return { ok: false, points: 0 };
  }
  let points = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    const expect = startValue + i;
    if (!tiles[i].joker && tiles[i].value !== expect) {
      return { ok: false, points: 0 };
    }
    points += expect;
  }
  return { ok: true, points };
}

export function rackPenalty(rack: Iterable<RummyTile>): number {
  let sum = 0;
  for (const t of rack) sum += t.joker ? JOKER_PENALTY : t.value;
  return sum;
}
