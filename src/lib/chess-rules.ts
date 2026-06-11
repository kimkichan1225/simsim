// 체스 규칙 — 순수 함수 모듈(서버 lib/chess.ts·클라 ChessGame.tsx 공용).
// 보드 표기: row-major 64칸의 단일 문자.
//   백 대문자 P N B R Q K, 흑 소문자 p n b r q k, 빈칸 ".".
//   row 0 = 8랭크(흑 진영 뒤), row 7 = 1랭크(백 진영 뒤). 백 폰은 위(row 감소)로 전진.

export const CHESS_SIZE = 8;
export const CHESS_CELLS = CHESS_SIZE * CHESS_SIZE;

export type PieceColor = 1 | 2; // 1=백, 2=흑

export type CastlingRights = {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
};

export type Move = {
  from: number;
  to: number;
  promotion?: "Q" | "R" | "B" | "N";
};

export function colorOf(ch: string): 0 | PieceColor {
  if (ch === ".") return 0;
  return ch === ch.toUpperCase() ? 1 : 2;
}

export function typeOf(ch: string): string {
  return ch === "." ? "" : ch.toUpperCase();
}

function rc(idx: number): [number, number] {
  return [Math.floor(idx / CHESS_SIZE), idx % CHESS_SIZE];
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < CHESS_SIZE && c >= 0 && c < CHESS_SIZE;
}

const ROOK_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const BISHOP_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const KING_DIRS: ReadonlyArray<readonly [number, number]> = [
  ...ROOK_DIRS,
  ...BISHOP_DIRS,
];
const KNIGHT_HOPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

export function initialBoard(): string[] {
  return [
    "r", "n", "b", "q", "k", "b", "n", "r",
    "p", "p", "p", "p", "p", "p", "p", "p",
    ".", ".", ".", ".", ".", ".", ".", ".",
    ".", ".", ".", ".", ".", ".", ".", ".",
    ".", ".", ".", ".", ".", ".", ".", ".",
    ".", ".", ".", ".", ".", ".", ".", ".",
    "P", "P", "P", "P", "P", "P", "P", "P",
    "R", "N", "B", "Q", "K", "B", "N", "R",
  ];
}

// 특정 칸이 byColor에게 공격받는지(킹 안전 판정용)
export function isAttacked(
  board: string[],
  target: number,
  byColor: PieceColor,
): boolean {
  const [tr, tc] = rc(target);

  // 폰: 백 폰(1)은 위로 전진→아래쪽 대각에서 공격, 흑 폰(2)은 위쪽 대각에서 공격
  const pawnRow = byColor === 1 ? tr + 1 : tr - 1;
  for (const dc of [-1, 1]) {
    if (inBounds(pawnRow, tc + dc)) {
      const ch = board[pawnRow * CHESS_SIZE + (tc + dc)];
      if (colorOf(ch) === byColor && typeOf(ch) === "P") return true;
    }
  }

  // 나이트
  for (const [dr, dc] of KNIGHT_HOPS) {
    const r = tr + dr;
    const c = tc + dc;
    if (!inBounds(r, c)) continue;
    const ch = board[r * CHESS_SIZE + c];
    if (colorOf(ch) === byColor && typeOf(ch) === "N") return true;
  }

  // 킹(인접)
  for (const [dr, dc] of KING_DIRS) {
    const r = tr + dr;
    const c = tc + dc;
    if (!inBounds(r, c)) continue;
    const ch = board[r * CHESS_SIZE + c];
    if (colorOf(ch) === byColor && typeOf(ch) === "K") return true;
  }

  // 슬라이더(룩/퀸 직선, 비숍/퀸 대각)
  for (const [dr, dc] of ROOK_DIRS) {
    let r = tr + dr;
    let c = tc + dc;
    while (inBounds(r, c)) {
      const ch = board[r * CHESS_SIZE + c];
      if (ch !== ".") {
        if (colorOf(ch) === byColor && (typeOf(ch) === "R" || typeOf(ch) === "Q")) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  for (const [dr, dc] of BISHOP_DIRS) {
    let r = tr + dr;
    let c = tc + dc;
    while (inBounds(r, c)) {
      const ch = board[r * CHESS_SIZE + c];
      if (ch !== ".") {
        if (colorOf(ch) === byColor && (typeOf(ch) === "B" || typeOf(ch) === "Q")) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return false;
}

export function findKing(board: string[], color: PieceColor): number {
  const king = color === 1 ? "K" : "k";
  for (let i = 0; i < CHESS_CELLS; i++) if (board[i] === king) return i;
  return -1;
}

export function inCheck(board: string[], color: PieceColor): boolean {
  const k = findKing(board, color);
  if (k < 0) return false;
  return isAttacked(board, k, color === 1 ? 2 : 1);
}

// 한 칸 기물의 의사합법 이동(킹 안전·캐슬링 제외). 프로모션은 같은 to를 4수로 펼친다.
export function pseudoMovesFrom(
  board: string[],
  idx: number,
  epTarget: number | null,
): Move[] {
  const ch = board[idx];
  const color = colorOf(ch);
  if (color === 0) return [];
  const type = typeOf(ch);
  const [r, c] = rc(idx);
  const out: Move[] = [];

  const pushTo = (to: number) => out.push({ from: idx, to });
  const promoRow = color === 1 ? 0 : 7;
  const pushPawnTo = (to: number) => {
    if (Math.floor(to / CHESS_SIZE) === promoRow) {
      for (const p of ["Q", "R", "B", "N"] as const) {
        out.push({ from: idx, to, promotion: p });
      }
    } else {
      pushTo(to);
    }
  };

  if (type === "P") {
    const fwd = color === 1 ? -1 : 1;
    const startRow = color === 1 ? 6 : 1;
    if (inBounds(r + fwd, c) && board[(r + fwd) * CHESS_SIZE + c] === ".") {
      pushPawnTo((r + fwd) * CHESS_SIZE + c);
      if (r === startRow && board[(r + 2 * fwd) * CHESS_SIZE + c] === ".") {
        pushTo((r + 2 * fwd) * CHESS_SIZE + c);
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + fwd;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const to = nr * CHESS_SIZE + nc;
      const tch = board[to];
      if (tch !== "." && colorOf(tch) !== color) {
        pushPawnTo(to);
      } else if (to === epTarget) {
        pushTo(to);
      }
    }
    return out;
  }

  if (type === "N") {
    for (const [dr, dc] of KNIGHT_HOPS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const to = nr * CHESS_SIZE + nc;
      if (colorOf(board[to]) !== color) pushTo(to);
    }
    return out;
  }

  if (type === "K") {
    for (const [dr, dc] of KING_DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const to = nr * CHESS_SIZE + nc;
      if (colorOf(board[to]) !== color) pushTo(to);
    }
    return out;
  }

  const dirs = type === "R" ? ROOK_DIRS : type === "B" ? BISHOP_DIRS : KING_DIRS;
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const to = nr * CHESS_SIZE + nc;
      const tch = board[to];
      if (tch === ".") {
        pushTo(to);
      } else {
        if (colorOf(tch) !== color) pushTo(to);
        break;
      }
      nr += dr;
      nc += dc;
    }
  }
  return out;
}

// 한 수를 새 보드에 적용(앙파상·캐슬링·프로모션 반영). 상태 갱신은 호출측.
export function applyToBoard(board: string[], move: Move): string[] {
  const next = board.slice();
  const piece = next[move.from];
  const color = colorOf(piece);
  const type = typeOf(piece);
  next[move.from] = ".";

  // 앙파상 캡처
  if (
    type === "P" &&
    move.from % CHESS_SIZE !== move.to % CHESS_SIZE &&
    board[move.to] === "."
  ) {
    const capRow = Math.floor(move.from / CHESS_SIZE);
    const capCol = move.to % CHESS_SIZE;
    next[capRow * CHESS_SIZE + capCol] = ".";
  }

  // 프로모션
  if (
    type === "P" &&
    (Math.floor(move.to / CHESS_SIZE) === 0 || Math.floor(move.to / CHESS_SIZE) === 7)
  ) {
    const p = move.promotion ?? "Q";
    next[move.to] = color === 1 ? p : p.toLowerCase();
  } else {
    next[move.to] = piece;
  }

  // 캐슬링: 킹 두 칸 이동 시 룩도 옮긴다
  if (
    type === "K" &&
    Math.abs((move.to % CHESS_SIZE) - (move.from % CHESS_SIZE)) === 2
  ) {
    const row = Math.floor(move.from / CHESS_SIZE);
    if (move.to % CHESS_SIZE === 6) {
      next[row * CHESS_SIZE + 5] = next[row * CHESS_SIZE + 7];
      next[row * CHESS_SIZE + 7] = ".";
    } else if (move.to % CHESS_SIZE === 2) {
      next[row * CHESS_SIZE + 3] = next[row * CHESS_SIZE + 0];
      next[row * CHESS_SIZE + 0] = ".";
    }
  }
  return next;
}

// 캐슬링 후보 수(킹 안전·통과칸 안전 검증 포함)
export function castlingMoves(
  board: string[],
  color: PieceColor,
  castling: CastlingRights,
): Move[] {
  const out: Move[] = [];
  const row = color === 1 ? 7 : 0;
  const enemy: PieceColor = color === 1 ? 2 : 1;
  const kingIdx = row * CHESS_SIZE + 4;
  if (board[kingIdx] !== (color === 1 ? "K" : "k")) return out;
  if (isAttacked(board, kingIdx, enemy)) return out;

  const kSide = color === 1 ? castling.wK : castling.bK;
  const qSide = color === 1 ? castling.wQ : castling.bQ;

  if (
    kSide &&
    board[row * CHESS_SIZE + 5] === "." &&
    board[row * CHESS_SIZE + 6] === "." &&
    board[row * CHESS_SIZE + 7] === (color === 1 ? "R" : "r") &&
    !isAttacked(board, row * CHESS_SIZE + 5, enemy) &&
    !isAttacked(board, row * CHESS_SIZE + 6, enemy)
  ) {
    out.push({ from: kingIdx, to: row * CHESS_SIZE + 6 });
  }
  if (
    qSide &&
    board[row * CHESS_SIZE + 1] === "." &&
    board[row * CHESS_SIZE + 2] === "." &&
    board[row * CHESS_SIZE + 3] === "." &&
    board[row * CHESS_SIZE + 0] === (color === 1 ? "R" : "r") &&
    !isAttacked(board, row * CHESS_SIZE + 3, enemy) &&
    !isAttacked(board, row * CHESS_SIZE + 2, enemy)
  ) {
    out.push({ from: kingIdx, to: row * CHESS_SIZE + 2 });
  }
  return out;
}

// 해당 색의 모든 합법 수(킹이 잡히지 않는 수만)
export function legalMoves(
  board: string[],
  color: PieceColor,
  castling: CastlingRights,
  epTarget: number | null,
): Move[] {
  const out: Move[] = [];
  for (let i = 0; i < CHESS_CELLS; i++) {
    if (colorOf(board[i]) !== color) continue;
    for (const mv of pseudoMovesFrom(board, i, epTarget)) {
      const after = applyToBoard(board, mv);
      if (!inCheck(after, color)) out.push(mv);
    }
  }
  out.push(...castlingMoves(board, color, castling));
  return out;
}

// 기물 부족 무승부(간단 버전: K vs K, K vs K+단일 마이너)
export function insufficientMaterial(board: string[]): boolean {
  const pieces = board.filter((ch) => ch !== "." && typeOf(ch) !== "K");
  if (pieces.length === 0) return true;
  if (
    pieces.length === 1 &&
    (typeOf(pieces[0]) === "B" || typeOf(pieces[0]) === "N")
  ) {
    return true;
  }
  return false;
}
