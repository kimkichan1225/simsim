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

// 셀 색상 — 스프레드시트 컨셉에 맞춰 구글 시트 초록 계열 모노톤으로 통일.
// 형형색색 대신 초록 3단계 + 방해 줄만 회색.
const COLORS: Record<PieceType | "garbage", string> = {
  I: "#0f9d58",
  S: "#0f9d58",
  L: "#0f9d58",
  O: "#34a853",
  T: "#34a853",
  Z: "#0b8043",
  J: "#0b8043",
  garbage: "#9aa0a6",
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
const randomType = (): PieceType =>
  TYPES[Math.floor(Math.random() * TYPES.length)];

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
    const t = randomType();
    g.current = {
      board: emptyBoard(),
      piece: {
        type: t,
        shape: SHAPES[t],
        row: 0,
        col: Math.floor((COLS - SHAPES[t][0].length) / 2),
      },
      next: randomType(),
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
      s.next = randomType();
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
      s.next = randomType();
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

  // 키 입력
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
          step();
          break;
        case "ArrowUp":
        case "x":
        case "X":
          e.preventDefault();
          rotate();
          break;
        case " ":
          e.preventDefault();
          hardDrop();
          break;
        case "c":
        case "C":
        case "Shift":
          e.preventDefault();
          hold();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, rotate, step, hardDrop, hold, onBack, isVersus]);

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
                    탈락 — 결과 집계 중…
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
                      ? "#0b8043"
                      : s.gauge >= 50
                        ? "#34a853"
                        : "#9aa0a6",
                }}
              />
            </div>
          </Panel>
        )}
        <div className="text-[11px] text-[var(--sheet-muted)] leading-relaxed mt-1">
          ← → 이동 · ↑/X 회전
          <br />↓ 소프트드롭 · Space 하드드롭
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
function MiniBoard({
  board,
  nickname,
  alive,
  score,
}: {
  board: Board | null;
  nickname: string;
  alive: boolean;
  score: number;
}) {
  const grid = board ?? emptyBoard();
  const C = 8;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[11px] text-[var(--sheet-fg)] max-w-[88px] truncate">
        {alive ? "" : "💀 "}
        {nickname}
      </div>
      <div
        className="border border-[var(--sheet-cell-border)]"
        style={{ opacity: alive ? 1 : 0.5 }}
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
  | { type: "player_attack"; fromMemberId: string; lines: number }
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
}: {
  myMemberId: string;
  myNickname: string;
  isOwner: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerView[]>([]);
  const [boards, setBoards] = useState<Record<string, Board>>({});
  const [results, setResults] = useState<TetrisResult[] | null>(null);
  const [attackSeq, setAttackSeq] = useState(0);
  const [startError, setStartError] = useState<string | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);

  const pendingGarbageRef = useRef(0);
  const joinedMatchRef = useRef<string | null>(null);

  // 진행 중인 대결에 내가 아직 없으면 자동 합류한다(시작은 방장만).
  const autoJoin = useCallback(
    (mId: string, ps: PlayerView[]) => {
      const amIn = ps.some((p) => p.memberId === myMemberId);
      if (amIn) {
        joinedMatchRef.current = mId;
        return;
      }
      if (joinedMatchRef.current === mId) return;
      joinedMatchRef.current = mId;
      void fetch("/api/tetris/join", { method: "POST" }).catch(() => {
        joinedMatchRef.current = null;
      });
    },
    [myMemberId],
  );

  const applyEvent = useCallback(
    (ev: TetrisEvent) => {
      switch (ev.type) {
        case "snapshot": {
          setMatchId(ev.matchId);
          setPlayers(ev.players);
          setBoards(ev.boards ?? {});
          if (ev.status === "running") {
            pendingGarbageRef.current = 0;
            autoJoin(ev.matchId, ev.players);
            setPhase("versus");
          } else if (ev.status === "ended") {
            setResults(ev.results ?? null);
            setPhase("result");
          }
          break;
        }
        case "match_started": {
          setMatchId(ev.matchId);
          setResults(null);
          setBoards({});
          pendingGarbageRef.current = 0;
          joinedMatchRef.current = null;
          // 다음 snapshot/player_joined로 참가자 목록이 채워진다
          void fetch("/api/tetris/join", { method: "POST" })
            .then(() => {
              joinedMatchRef.current = ev.matchId;
            })
            .catch(() => undefined);
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
          if (ev.fromMemberId === myMemberId) break; // 내 공격은 무시
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
          break;
        }
        case "match_ended": {
          setResults(ev.results);
          setPhase("result");
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
    [autoJoin, myMemberId],
  );

  // SSE 연결 (탭이 마운트된 동안 유지)
  useEffect(() => {
    const es = new EventSource("/api/tetris/stream");
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        applyEvent(JSON.parse(e.data) as TetrisEvent);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource 자동 재연결 */
    };
    return () => es.close();
  }, [applyEvent]);

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
      body: JSON.stringify({ lines }),
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

  if (phase === "versus") {
    return (
      <div className="py-4 flex flex-col gap-4">
        <TetrisBoard
          mode="versus"
          pendingGarbageRef={pendingGarbageRef}
          attackSeq={attackSeq}
          postBoard={postBoard}
          postAttack={postAttack}
          postOut={postOut}
        />
        {opponents.length > 0 && (
          <div>
            <div className="text-[12px] text-[var(--sheet-muted)] mb-2">
              상대 ({opponents.length})
            </div>
            <div className="flex gap-4 flex-wrap">
              {opponents.map((p) => (
                <MiniBoard
                  key={p.memberId}
                  board={boards[p.memberId] ?? null}
                  nickname={p.nickname}
                  alive={p.alive}
                  score={p.score}
                />
              ))}
            </div>
          </div>
        )}
        {opponents.length === 0 && (
          <div className="text-[12px] text-[var(--sheet-muted)]">
            아직 상대가 없어요. 같은 그룹의 멤버가 테트리스 탭에 들어오면 함께
            대결합니다.
          </div>
        )}
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
