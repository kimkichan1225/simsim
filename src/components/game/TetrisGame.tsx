"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LobbyCard, type LobbyMember } from "./LobbyCard";
import { useGameStream } from "@/lib/use-game-stream";

// ── 테트리스 상수 (3d-fit 게임 방식 포팅) ──
const COLS = 10;
const ROWS = 20;

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Cell = PieceType | "garbage" | null;
type Board = Cell[][];

const SHAPES: Record<PieceType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
};

// 셀 색상 — 스프레드시트 위장 컨셉에 맞춰 회색조(명도 차이)로만 구성.
// 조각은 진회색 3단계, 방해 줄은 연회색으로 구분.
const COLORS: Record<PieceType | "garbage", string> = {
  I: "#3c4043",
  J: "#3c4043",
  O: "#5f6368",
  Z: "#5f6368",
  T: "#70757a",
  L: "#70757a",
  S: "#80868b",
  garbage: "#bdc1c6",
};

const TYPES: PieceType[] = Object.keys(SHAPES) as PieceType[];
const LINE_SCORES = [0, 100, 300, 500, 800];

// ── 대결 공격 게이지 ──
const GAUGE_MAX = 100;
const GAUGE_TABLE = [0, 15, 35, 60, 100]; // 동시 클리어 줄 수 → 게이지
const GARBAGE_BONUS = 5; // 방해 줄 정리당 추가
const COMBO_BONUS = 5; // 콤보 단계당 추가
const ATTACK_LINES = 4; // 발사 시 보낼 방해 줄 수

const emptyBoard = (): Board =>
  Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));

// ── 7-bag(랜덤 제너레이터) ──
// 7종을 한 가방에 담아 섞고 하나씩 꺼낸다. 가방이 비면 새 가방을 채운다.
// → 7개마다 모든 블록이 정확히 한 번씩 등장하므로 장기 확률은 균등(1/7),
//   같은 블록 최대 연속 2번·최대 가뭄 12개로 극단적 운빨을 막는다.
const shuffle = (arr: PieceType[]): PieceType[] => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// 가방에서 한 조각을 꺼낸다(비어 있으면 새 가방을 채워 섞는다). bag 배열을 직접 변형.
const drawFromBag = (bag: PieceType[]): PieceType => {
  if (bag.length === 0) bag.push(...shuffle(TYPES));
  return bag.shift()!;
};

const rotateCW = (m: number[][]): number[][] => {
  const n = m.length;
  const w = m[0].length;
  const r = Array.from({ length: w }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < w; j++) r[j][n - 1 - i] = m[i][j];
  }
  return r;
};

const canPlace = (
  board: Board,
  shape: number[][],
  row: number,
  col: number,
): boolean => {
  for (let i = 0; i < shape.length; i++) {
    for (let j = 0; j < shape[i].length; j++) {
      if (!shape[i][j]) continue;
      const r = row + i;
      const c = col + j;
      if (c < 0 || c >= COLS || r >= ROWS) return false;
      if (r >= 0 && board[r][c]) return false;
    }
  }
  return true;
};

const dropInterval = (level: number) => Math.max(100, 800 - (level - 1) * 70);

// 열 머리글(A,B,C…)과 행 번호로 스프레드시트처럼 위장한다.
const COL_HEADERS = Array.from({ length: COLS }, (_, i) =>
  String.fromCharCode(65 + i),
);

type GameState = {
  board: Board;
  piece: { type: PieceType; shape: number[][]; row: number; col: number };
  next: PieceType;
  bag: PieceType[]; // 7-bag 잔여 조각
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  lines: number;
  level: number;
  combo: number;
  gauge: number;
  pendingGarbage: number;
  countdown: number;
  over: boolean;
  paused: boolean;
};

const CELL = 24;

// ── 게임 보드 (싱글/대결 공용 엔진) ──
// 대결 모드에서는 부모(SSE)가 ref/콜백을 개별 prop으로 내려준다.
function TetrisBoard({
  mode,
  onBack,
  pendingGarbageRef, // 수신한 방해 줄 누적(고정 시 정산)
  attackSeq, // 공격을 받을 때마다 증가 → 보드 플래시 트리거
  postBoard,
  postAttack,
  postOut,
}: {
  mode: "single" | "versus";
  onBack?: () => void;
  pendingGarbageRef?: React.RefObject<number>;
  attackSeq?: number;
  postBoard?: (board: Board, score: number) => void;
  postAttack?: (lines: number) => void;
  postOut?: (score: number) => void;
}) {
  const isVersus = mode === "versus";
  const [, force] = useReducer((x: number) => x + 1, 0);
  const g = useRef<GameState | null>(null);
  const [flash, setFlash] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const softDropRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCountdown = useCallback(() => {
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      if (!g.current) return;
      if (g.current.countdown > 0) {
        g.current.countdown -= 1;
        force();
      } else if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    }, 1000);
  }, []);

  const reset = useCallback(() => {
    const bag: PieceType[] = [];
    const t = drawFromBag(bag);
    g.current = {
      board: emptyBoard(),
      piece: {
        type: t,
        shape: SHAPES[t],
        row: 0,
        col: Math.floor((COLS - SHAPES[t][0].length) / 2),
      },
      next: drawFromBag(bag),
      bag,
      hold: null,
      canHold: true,
      score: 0,
      lines: 0,
      level: 1,
      combo: 0,
      gauge: 0,
      pendingGarbage: 0,
      countdown: 3,
      over: false,
      paused: false,
    };
    force();
    startCountdown();
  }, [startCountdown]);

  useEffect(
    () => () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    },
    [],
  );

  // 보드 하단에 방해 줄 n개 추가
  const addGarbage = useCallback((n: number) => {
    if (!g.current) return;
    const board = g.current.board;
    for (let k = 0; k < n; k++) {
      const hole = Math.floor(Math.random() * COLS);
      board.shift();
      const row = Array<Cell>(COLS).fill("garbage");
      row[hole] = null;
      board.push(row);
    }
  }, []);

  const lockPiece = useCallback(() => {
    const s = g.current;
    if (!s) return;
    const { board, piece } = s;
    piece.shape.forEach((rowArr, i) => {
      rowArr.forEach((v, j) => {
        if (!v) return;
        const r = piece.row + i;
        const c = piece.col + j;
        if (r >= 0) board[r][c] = piece.type;
      });
    });

    // 꽉 찬 줄 찾기
    const fullRows: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      if (board[r].every((cell) => cell)) fullRows.push(r);
    }
    const cleared = fullRows.length;
    const garbageCleared = fullRows.filter((r) =>
      board[r].some((c) => c === "garbage"),
    ).length;
    for (let i = fullRows.length - 1; i >= 0; i--) board.splice(fullRows[i], 1);
    for (let i = 0; i < cleared; i++) board.unshift(Array<Cell>(COLS).fill(null));

    if (cleared > 0) {
      s.lines += cleared;
      s.score += LINE_SCORES[cleared] * s.level;
      s.level = Math.floor(s.lines / 10) + 1;
      s.combo += 1;
    } else {
      s.combo = 0;
    }

    if (isVersus) {
      if (cleared > 0) {
        let gain = GAUGE_TABLE[cleared] || 0;
        gain += garbageCleared * GARBAGE_BONUS;
        gain += Math.max(0, s.combo - 1) * COMBO_BONUS;
        s.gauge += gain;
        while (s.gauge >= GAUGE_MAX) {
          s.gauge -= GAUGE_MAX;
          postAttack?.(ATTACK_LINES);
        }
      }
      // 수신한 방해 줄 정산 (상쇄 없음)
      const garbageRef = pendingGarbageRef;
      const incoming = (garbageRef?.current ?? 0) + s.pendingGarbage;
      if (incoming > 0) {
        addGarbage(incoming);
        s.pendingGarbage = 0;
        if (garbageRef) garbageRef.current = 0;
      }
    }

    // 다음 조각 스폰
    const type = s.next;
    const shape = SHAPES[type];
    const col = Math.floor((COLS - shape[0].length) / 2);
    if (!canPlace(board, shape, 0, col)) {
      s.over = true;
      if (isVersus) postOut?.(s.score);
    } else {
      s.piece = { type, shape, row: 0, col };
      s.next = drawFromBag(s.bag);
      s.canHold = true;
    }

    if (isVersus) postBoard?.(s.board, s.score);
  }, [isVersus, addGarbage, pendingGarbageRef, postAttack, postBoard, postOut]);

  const step = useCallback(() => {
    const s = g.current;
    if (!s || s.over || s.paused || s.countdown > 0) return;
    if (canPlace(s.board, s.piece.shape, s.piece.row + 1, s.piece.col)) {
      s.piece.row += 1;
    } else {
      lockPiece();
    }
    force();
  }, [lockPiece]);

  const move = useCallback((dx: number) => {
    const s = g.current;
    if (!s || s.over || s.paused || s.countdown > 0) return;
    if (canPlace(s.board, s.piece.shape, s.piece.row, s.piece.col + dx)) {
      s.piece.col += dx;
      force();
    }
  }, []);

  const rotate = useCallback(() => {
    const s = g.current;
    if (!s || s.over || s.paused || s.countdown > 0) return;
    const rotated = rotateCW(s.piece.shape);
    for (const dx of [0, -1, 1, -2, 2]) {
      if (canPlace(s.board, rotated, s.piece.row, s.piece.col + dx)) {
        s.piece.shape = rotated;
        s.piece.col += dx;
        force();
        return;
      }
    }
  }, []);

  const hardDrop = useCallback(() => {
    const s = g.current;
    if (!s || s.over || s.paused || s.countdown > 0) return;
    while (canPlace(s.board, s.piece.shape, s.piece.row + 1, s.piece.col))
      s.piece.row += 1;
    lockPiece();
    force();
  }, [lockPiece]);

  const hold = useCallback(() => {
    const s = g.current;
    if (!s || s.over || s.paused || s.countdown > 0 || !s.canHold) return;
    const cur = s.piece.type;
    const spawn = (type: PieceType) => ({
      type,
      shape: SHAPES[type],
      row: 0,
      col: Math.floor((COLS - SHAPES[type][0].length) / 2),
    });
    if (s.hold) {
      const swapped = s.hold;
      s.hold = cur;
      s.piece = spawn(swapped);
    } else {
      s.hold = cur;
      s.piece = spawn(s.next);
      s.next = drawFromBag(s.bag);
    }
    s.canHold = false;
    force();
  }, []);

  useEffect(() => {
    reset();
  }, [reset]);

  // 자동 낙하 타이머
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      step();
      const lvl = g.current ? g.current.level : 1;
      timer = setTimeout(tick, dropInterval(lvl));
    };
    timer = setTimeout(tick, dropInterval(1));
    return () => clearTimeout(timer);
  }, [step]);

  // 대결: 공격 수신 → 보드 플래시 (방해 줄 누적은 부모가 ref에 적립)
  useEffect(() => {
    if (!isVersus || !attackSeq || attackSeq <= 0) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 350);
    return () => clearTimeout(t);
  }, [isVersus, attackSeq]);

  // 소프트드롭(아래키 꾹) 중지
  const stopSoftDrop = useCallback(() => {
    if (softDropRef.current) {
      clearInterval(softDropRef.current);
      softDropRef.current = null;
    }
  }, []);

  // 키 입력
  // 조작: ←→ 이동 · Space 회전 · ↓ 소프트드롭(꾹) · 왼쪽 Ctrl 하드드롭 · C 홀드
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = g.current;
      if (!s) return;
      const k = e.key;
      if (k === "Escape") {
        if (!isVersus && onBack) onBack();
        return;
      }
      if (s.over) return;
      if (k === "p" || k === "P") {
        if (!isVersus) {
          s.paused = !s.paused;
          force();
        }
        return;
      }
      if (s.paused || s.countdown > 0) return;

      // 왼쪽 Ctrl = 하드드롭 (누르고 있어도 한 번만)
      if (e.code === "ControlLeft") {
        e.preventDefault();
        if (!e.repeat) hardDrop();
        return;
      }

      switch (k) {
        case "ArrowLeft":
          e.preventDefault();
          move(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          move(1);
          break;
        case "ArrowDown":
          e.preventDefault();
          // 꾹 누르면 일정 간격으로 계속 한 칸씩 내려가게 한다.
          if (!softDropRef.current) {
            step();
            softDropRef.current = setInterval(() => step(), 50);
          }
          break;
        case " ":
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          if (!e.repeat) rotate();
          break;
        case "c":
        case "C":
        case "Shift":
          e.preventDefault();
          if (!e.repeat) hold();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") stopSoftDrop();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      stopSoftDrop();
    };
  }, [move, rotate, step, hardDrop, hold, onBack, isVersus, stopSoftDrop]);

  const s = g.current;
  if (!s) return null;

  // 표시용 보드 = 고정 블록 + 고스트 + 현재 조각
  const display: (Cell | `ghost-${PieceType}`)[][] = s.board.map((row) =>
    row.slice(),
  );
  if (!s.over) {
    let ghostRow = s.piece.row;
    while (canPlace(s.board, s.piece.shape, ghostRow + 1, s.piece.col))
      ghostRow += 1;
    s.piece.shape.forEach((rowArr, i) => {
      rowArr.forEach((v, j) => {
        if (!v) return;
        const r = ghostRow + i;
        const c = s.piece.col + j;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS && !display[r][c]) {
          display[r][c] = `ghost-${s.piece.type}`;
        }
      });
    });
    s.piece.shape.forEach((rowArr, i) => {
      rowArr.forEach((v, j) => {
        if (!v) return;
        const r = s.piece.row + i;
        const c = s.piece.col + j;
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) display[r][c] = s.piece.type;
      });
    });
  }

  return (
    <div className="flex gap-4 items-start flex-wrap">
      <div className="inline-block">
        {/* 열 머리글 (A~J) */}
        <div className="flex">
          <div
            className="h-6 border-r border-b border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)]"
            style={{ width: 28 }}
          />
          {COL_HEADERS.map((h) => (
            <div
              key={h}
              className="h-6 border-r border-b border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
              style={{ width: CELL }}
            >
              {h}
            </div>
          ))}
        </div>

        <div
          className="relative"
          style={{
            boxShadow: flash
              ? "0 0 0 2px #5f6368, 0 0 16px 2px #5f636888"
              : undefined,
          }}
        >
          {display.map((row, i) => (
            <div key={i} className="flex">
              {/* 행 번호 */}
              <div
                className="border-r border-b border-[var(--sheet-cell-border)] bg-[var(--sheet-header-bg)] grid place-items-center text-[11px] text-[var(--sheet-muted)]"
                style={{ width: 28, height: CELL }}
              >
                {i + 1}
              </div>
              {row.map((cell, j) => {
                const ghost =
                  typeof cell === "string" && cell.startsWith("ghost-");
                const type = (
                  ghost ? (cell as string).slice(6) : cell
                ) as PieceType | "garbage" | null;
                return (
                  <div
                    key={j}
                    className="border-r border-b border-[var(--sheet-cell-border)]"
                    style={{
                      width: CELL,
                      height: CELL,
                      background: ghost
                        ? "transparent"
                        : type
                          ? COLORS[type]
                          : "#fff",
                      boxShadow:
                        ghost && type
                          ? `inset 0 0 0 2px ${COLORS[type as PieceType]}55`
                          : undefined,
                    }}
                  />
                );
              })}
            </div>
          ))}

          {s.countdown > 0 && (
            <Overlay>
              <div className="text-[64px] font-bold text-[var(--sheet-active)]">
                {s.countdown}
              </div>
            </Overlay>
          )}

          {(s.over || s.paused) && (
            <Overlay>
              {s.over ? (
                isVersus ? (
                  <div className="text-[16px] font-medium text-[var(--sheet-fg)]">
                    탈락 — 관전으로 전환 중…
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-[20px] font-medium text-[var(--sheet-fg)]">
                      게임 오버
                    </div>
                    <div className="text-[13px] text-[var(--sheet-muted)]">
                      점수 {s.score}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <PrimaryBtn onClick={reset}>다시 하기</PrimaryBtn>
                      {onBack && <GhostBtn onClick={onBack}>메뉴 (Esc)</GhostBtn>}
                    </div>
                  </div>
                )
              ) : (
                <div className="text-[16px] font-medium text-[var(--sheet-fg)]">
                  일시정지 (P)
                </div>
              )}
            </Overlay>
          )}
        </div>
      </div>

      {/* 사이드 패널 */}
      <div className="flex flex-col gap-2 min-w-[130px]">
        <Panel label="점수">
          <span className="text-[20px] font-medium tabular-nums">{s.score}</span>
        </Panel>
        <Panel label="줄 / 레벨">
          <span className="text-[18px] font-medium tabular-nums">
            {s.lines} / {s.level}
          </span>
        </Panel>
        <Panel label="홀드 (C)">
          <MiniPiece type={s.hold} dim={!s.canHold} />
        </Panel>
        <Panel label="다음">
          <MiniPiece type={s.next} />
        </Panel>
        {isVersus && (
          <Panel label="공격 게이지">
            <div className="w-full h-3 rounded bg-[var(--sheet-header-bg)] border border-[var(--sheet-cell-border)] overflow-hidden mt-1">
              <div
                className="h-full transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, s.gauge)}%`,
                  background:
                    s.gauge >= 80
                      ? "#3c4043"
                      : s.gauge >= 50
                        ? "#5f6368"
                        : "#9aa0a6",
                }}
              />
            </div>
          </Panel>
        )}
        <div className="text-[11px] text-[var(--sheet-muted)] leading-relaxed mt-1">
          ← → 이동 · Space 회전
          <br />↓ 소프트드롭(꾹) · 왼쪽 Ctrl 하드드롭
          <br />C 홀드
          {!isVersus && (
            <>
              <br />P 일시정지 · Esc 메뉴
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-white/85">
      {children}
    </div>
  );
}

function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border border-[var(--sheet-cell-border)] bg-white px-3 py-2">
      <div className="text-[10px] text-[var(--sheet-muted)] uppercase tracking-wide">
        {label}
      </div>
      {children}
    </div>
  );
}

function MiniPiece({
  type,
  dim,
}: {
  type: PieceType | null;
  dim?: boolean;
}) {
  const shape = type ? SHAPES[type] : [];
  return (
    <div
      className="flex flex-col gap-[2px] mt-1.5"
      style={{ opacity: dim ? 0.4 : 1 }}
    >
      {shape.map((row, i) => (
        <div key={i} className="flex gap-[2px]">
          {row.map((v, j) => (
            <div
              key={j}
              style={{
                width: 13,
                height: 13,
                background: v && type ? COLORS[type] : "transparent",
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// 상대 보드 미니뷰 (시트 셀 축소판)
// index/isTarget/onSelect: 대결 중 타겟 지정 UI · cellSize: 관전 모드에서 확대용
function MiniBoard({
  board,
  nickname,
  alive,
  score,
  cellSize,
  index,
  isTarget,
  onSelect,
}: {
  board: Board | null;
  nickname: string;
  alive: boolean;
  score: number;
  cellSize?: number;
  index?: number;
  isTarget?: boolean;
  onSelect?: () => void;
}) {
  const grid = board ?? emptyBoard();
  const C = cellSize ?? 8;
  return (
    <div
      className="flex flex-col items-center gap-1"
      onClick={onSelect}
      style={{ cursor: onSelect ? "pointer" : undefined }}
    >
      <div
        className="text-[11px] max-w-[120px] truncate"
        style={{
          color: isTarget ? "var(--sheet-active)" : "var(--sheet-fg)",
          fontWeight: isTarget ? 600 : undefined,
        }}
      >
        {alive ? "" : "💀 "}
        {isTarget ? "🎯 " : ""}
        {index != null ? `${index}. ` : ""}
        {nickname}
      </div>
      <div
        className="border border-[var(--sheet-cell-border)]"
        style={{
          opacity: alive ? 1 : 0.5,
          boxShadow: isTarget
            ? "0 0 0 2px var(--sheet-active)"
            : undefined,
        }}
      >
        {grid.map((row, i) => (
          <div key={i} className="flex">
            {row.map((cell, j) => (
              <div
                key={j}
                style={{
                  width: C,
                  height: C,
                  background: cell ? COLORS[cell] : "#fff",
                  borderRight: "1px solid var(--sheet-cell-border)",
                  borderBottom: "1px solid var(--sheet-cell-border)",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="text-[10px] text-[var(--sheet-muted)] tabular-nums">
        {score}
      </div>
    </div>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded bg-[var(--sheet-active)] text-white text-[14px] font-medium hover:brightness-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function GhostBtn({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded border border-[var(--sheet-cell-border)] text-[13px] text-[var(--sheet-fg)] hover:bg-black/5"
    >
      {children}
    </button>
  );
}

// ── SSE 이벤트 타입 (서버 lib/tetris.ts와 동기) ──
type PlayerView = {
  memberId: string;
  nickname: string;
  alive: boolean;
  score: number;
};
type TetrisResult = {
  memberId: string;
  nickname: string;
  score: number;
  rank: number;
  survived: boolean;
};
type TetrisEvent =
  | {
      type: "snapshot";
      matchId: string;
      status: "running" | "ended";
      startedAt: number;
      players: PlayerView[];
      boards: Record<string, Board>;
      results?: TetrisResult[];
    }
  | { type: "no_match" }
  | { type: "match_started"; matchId: string; startedAt: number }
  | { type: "player_joined"; memberId: string; nickname: string }
  | { type: "player_board"; memberId: string; board: Board }
  | {
      type: "player_attack";
      fromMemberId: string;
      targetMemberId: string;
      lines: number;
    }
  | { type: "player_out"; memberId: string; rank: number; score: number }
  | { type: "match_ended"; results: TetrisResult[] }
  | { type: "lobby"; members: LobbyMember[] }
  | { type: "group_destroyed" };

type Phase = "lobby" | "versus" | "result";

// ── 컨테이너: 대기실 → 대결 → 결과 (단어줍기와 동일한 흐름) ──
export function TetrisGame({
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
  const [matchId, setMatchId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [results, setResults] = useState<TetrisResult[] | null>(null);
  const [attackSeq, setAttackSeq] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);
  const [matchRunning, setMatchRunning] = useState(false); // 다른 사람이 대결 중인지
  const [amOut, setAmOut] = useState(false); // 내가 탈락 → 관전 모드
  const [targetId, setTargetIdState] = useState<string | null>(null); // 공격 타겟

  const pendingGarbageRef = useRef(0);
  const joinedMatchRef = useRef<string | null>(null);
  // 공격 발사 콜백(postAttack)이 최신 타겟을 참조하도록 ref로도 보관
  const targetIdRef = useRef<string | null>(null);

  // 자리비움 판정 → 대기방 탭으로 이동(언마운트되면 로비에서도 빠진다).
  // 이동 전 잠깐의 틈에 대결에 자동 합류하지 않도록 ref 로도 보관한다.
  const amAway =
    lobbyMembers.find((m) => m.memberId === myMemberId)?.away ?? false;
  const amAwayRef = useRef(false);
  amAwayRef.current = amAway;
  useEffect(() => {
    if (amAway) onAway();
  }, [amAway, onAway]);

  const setTarget = useCallback((id: string | null) => {
    targetIdRef.current = id;
    setTargetIdState(id);
  }, []);

  const applyEvent = useCallback(
    (ev: TetrisEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setMatchId(ev.matchId);
          setPlayers(ev.players);
          setBoards(ev.boards ?? {});
          if (ev.status === "running") {
            setMatchRunning(true);
            const amParticipant = ev.players.some(
              (p) => p.memberId === myMemberId,
            );
            // 시작할 때 함께 있었던(=참가자거나 방금 합류한) 사람만 대결로.
            // 도중에 들어온 사람은 합류하지 않고 대기실에서 다음 판을 기다린다.
            if (amParticipant || joinedMatchRef.current === ev.matchId) {
              pendingGarbageRef.current = 0;
              joinedMatchRef.current = ev.matchId;
              // 재연결 시 내 생존 여부 복원 (탈락 상태였으면 관전 유지)
              const me = ev.players.find((p) => p.memberId === myMemberId);
              setAmOut(me ? !me.alive : false);
              setPhase("versus");
            } else {
              setPhase("lobby");
            }
          } else if (ev.status === "ended") {
            setMatchRunning(false);
            setResults(ev.results ?? null);
            const inResults = (ev.results ?? []).some(
              (r) => r.memberId === myMemberId,
            );
            setPhase(inResults ? "result" : "lobby");
          }
          break;
        }
        case "match_started": {
          setMatchId(ev.matchId);
          setResults(null);
          setBoards({});
          setMatchRunning(true);
          // 대기방(자리비움) 상태면 합류하지 않고 대기방에 머문다.
          if (amAwayRef.current) break;
          setAmOut(false);
          setTarget(null);
          pendingGarbageRef.current = 0;
          // 시작 시점에 이 탭에 있던 사람만 이 매치에 합류한다.
          joinedMatchRef.current = ev.matchId;
          void fetch("/api/tetris/join", { method: "POST" }).catch(
            () => undefined,
          );
          setPhase("versus");
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
                    alive: true,
                    score: 0,
                  },
                ],
          );
          break;
        }
        case "player_board": {
          setBoards((prev) => ({ ...prev, [ev.memberId]: ev.board }));
          break;
        }
        case "player_attack": {
          if (ev.targetMemberId !== myMemberId) break; // 내가 타겟일 때만 적립
          pendingGarbageRef.current += ev.lines;
          setAttackSeq((n) => n + 1);
          break;
        }
        case "player_out": {
          setPlayers((prev) =>
            prev.map((p) =>
              p.memberId === ev.memberId
                ? { ...p, alive: false, score: ev.score }
                : p,
            ),
          );
          // 내가 탈락 → 관전 모드. 타겟이 탈락 → 타겟 해제(무작위로 복귀).
          if (ev.memberId === myMemberId) setAmOut(true);
          if (targetIdRef.current === ev.memberId) setTarget(null);
          break;
        }
        case "match_ended": {
          setMatchRunning(false);
          setResults(ev.results);
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
    [myMemberId, setTarget],
  );

  // SSE 연결 (group_destroyed 처리·정리는 공용 훅이 담당)
  useGameStream<TetrisEvent>("/api/tetris/stream", applyEvent);

  const postBoard = useCallback((board: Board, score: number) => {
    void fetch("/api/tetris/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, score }),
    }).catch(() => undefined);
  }, []);

  const postAttack = useCallback((lines: number) => {
    void fetch("/api/tetris/attack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines,
        targetMemberId: targetIdRef.current ?? undefined,
      }),
    }).catch(() => undefined);
  }, []);

  const postOut = useCallback((score: number) => {
    void fetch("/api/tetris/out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score }),
    }).catch(() => undefined);
  }, []);

  const startVersus = useCallback(async () => {
    setStartError(null);
    try {
      const res = await fetch("/api/tetris/start", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setStartError(translateStartError(data?.error));
        return;
      }
      // 성공 시 SSE의 match_started로 versus 전환됨
    } catch {
      setStartError("연결 실패");
    }
  }, []);

  const toggleReady = useCallback((ready: boolean) => {
    void fetch("/api/tetris/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ready }),
    }).catch(() => undefined);
  }, []);

  const opponents = players.filter((p) => p.memberId !== myMemberId);

  // 타겟 선택: Tab = 살아있는 상대 순환, 1~9 = 표시 순서로 직접 지정
  useEffect(() => {
    if (phase !== "versus" || amOut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const alive = players.filter(
          (p) => p.memberId !== myMemberId && p.alive,
        );
        if (alive.length === 0) return;
        const idx = alive.findIndex(
          (p) => p.memberId === targetIdRef.current,
        );
        setTarget(alive[(idx + 1) % alive.length].memberId);
      } else if (/^[1-9]$/.test(e.key)) {
        const opp = players.filter((p) => p.memberId !== myMemberId);
        const cand = opp[Number(e.key) - 1];
        if (cand?.alive) setTarget(cand.memberId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, amOut, players, myMemberId, setTarget]);

  if (phase === "versus") {
    // 탈락 후 관전 모드: 남은 사람들의 보드를 크게 보면서 끝까지 시청
    if (amOut) {
      const aliveCount = opponents.filter((p) => p.alive).length;
      return (
        <div className="py-4 flex flex-col gap-4">
          <div className="text-[14px] font-medium text-[var(--sheet-fg)]">
            👁 관전 중 — {aliveCount}명 생존
            <span className="ml-2 text-[12px] font-normal text-[var(--sheet-muted)]">
              대결이 끝나면 결과가 표시됩니다.
            </span>
          </div>
          <div className="flex flex-wrap gap-8 content-start">
            {opponents.map((p) => (
              <MiniBoard
                key={p.memberId}
                board={boards[p.memberId] ?? null}
                nickname={p.nickname}
                alive={p.alive}
                score={p.score}
                cellSize={14}
              />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="py-4 flex gap-8 items-start flex-wrap">
        <TetrisBoard
          mode="versus"
          pendingGarbageRef={pendingGarbageRef}
          attackSeq={attackSeq}
          postBoard={postBoard}
          postAttack={postAttack}
          postOut={postOut}
        />
        <div className="flex flex-col gap-2">
          <div className="text-[12px] text-[var(--sheet-muted)]">
            상대 ({opponents.length})
          </div>
          {opponents.length === 0 ? (
            <div className="text-[12px] text-[var(--sheet-muted)] max-w-[200px] leading-relaxed">
              아직 상대가 없어요. 같은 그룹의 멤버가 테트리스 탭에 들어오면 함께
              대결합니다.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-4 max-w-[440px] content-start">
                {opponents.map((p, i) => (
                  <MiniBoard
                    key={p.memberId}
                    board={boards[p.memberId] ?? null}
                    nickname={p.nickname}
                    alive={p.alive}
                    score={p.score}
                    index={i + 1}
                    isTarget={p.memberId === targetId}
                    onSelect={
                      p.alive ? () => setTarget(p.memberId) : undefined
                    }
                  />
                ))}
              </div>
              {opponents.length >= 2 && (
                <div className="text-[11px] text-[var(--sheet-muted)] leading-relaxed max-w-[220px]">
                  🎯 Tab·숫자키·클릭으로 공격 타겟 지정
                  <br />
                  (미지정 시 무작위 1명에게 공격)
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === "result") {
    const sorted = results ? [...results].sort((a, b) => a.rank - b.rank) : [];
    const me = sorted.find((r) => r.memberId === myMemberId);
    const won = me?.rank === 1 && sorted.length >= 2;
    return (
      <div className="py-8 flex flex-col items-center gap-5">
        <div
          className="text-[26px] font-bold"
          style={{ color: won ? "var(--sheet-green)" : "var(--sheet-muted)" }}
        >
          {sorted.length < 2 ? "대결 종료" : won ? "승리!" : "패배"}
        </div>
        <table className="border-collapse text-[13px]">
          <thead>
            <tr className="text-[var(--sheet-muted)]">
              <th className="px-3 py-1 text-left">순위</th>
              <th className="px-3 py-1 text-left">닉네임</th>
              <th className="px-3 py-1 text-right">점수</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isMe = r.memberId === myMemberId;
              return (
                <tr
                  key={r.memberId}
                  className={isMe ? "text-[var(--sheet-active)] font-medium" : ""}
                >
                  <td className="px-3 py-1 tabular-nums">{r.rank}</td>
                  <td className="px-3 py-1">
                    {r.nickname}
                    {isMe ? " (나)" : ""}
                  </td>
                  <td className="px-3 py-1 tabular-nums text-right">{r.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <LobbyCard
          title="다시 대결"
          description="다음 대결을 준비하세요."
          members={lobbyMembers}
          myMemberId={myMemberId}
          isOwner={isOwner}
          onStart={startVersus}
          onReady={toggleReady}
          startError={startError}
        />
      </div>
    );
  }

  // lobby (기본 화면)
  return (
    <div className="py-8 flex flex-col items-center gap-6">
      <TetrisLogo />
      <LobbyCard
        title="테트리스"
        description={
          "블록을 쌓아 줄을 지우세요.\n시작하면 같은 그룹의 멤버들과 생존 대결을 합니다."
        }
        notice={
          matchRunning
            ? "다른 멤버들이 대결 중이에요. 끝나면 다음 판에 참여할 수 있어요."
            : undefined
        }
        members={lobbyMembers}
        myMemberId={myMemberId}
        isOwner={isOwner}
        onStart={startVersus}
        onReady={toggleReady}
        startError={startError}
        canStart={!matchRunning}
      />
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
      return "대결 시작은 방장만 할 수 있어요.";
    default:
      return "시작에 실패했어요.";
  }
}

// TETRIS 블록 로고
const LOGO_LETTERS: [string, PieceType | "garbage"][] = [
  ["T", "Z"],
  ["E", "L"],
  ["T", "O"],
  ["R", "S"],
  ["I", "I"],
  ["S", "T"],
];
function TetrisLogo() {
  return (
    <div className="flex gap-1.5">
      {LOGO_LETTERS.map(([ch, color], i) => (
        <span
          key={i}
          className="grid place-items-center text-white font-bold rounded"
          style={{
            width: 40,
            height: 46,
            fontSize: 26,
            background: COLORS[color],
            transform: i % 2 === 0 ? "translateY(-3px)" : "translateY(3px)",
            boxShadow: "inset 0 -4px 0 rgba(0,0,0,0.18)",
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}
