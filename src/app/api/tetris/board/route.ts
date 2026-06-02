import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import {
  CELL_TYPES,
  TETRIS_COLS,
  TETRIS_ROWS,
  pushBoard,
  type Board,
} from "@/lib/tetris";
import { getCurrentMember } from "@/server/auth";

// 보드 스냅샷은 조각 고정마다 올라오므로(초당 수회) 비교적 넉넉하게 허용한다.
const RATE_TETRIS_BOARD: RateLimitConfig = {
  capacity: 12,
  refillPerSec: 6,
};

const Cell = z.union([z.null(), z.enum(CELL_TYPES)]);
const Body = z.object({
  board: z
    .array(z.array(Cell).length(TETRIS_COLS))
    .length(TETRIS_ROWS),
  score: z.number().int().min(0).max(100_000_000),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`tetris-board:${me.memberId}`, RATE_TETRIS_BOARD)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const raw = await readJson(request);
  if (raw === null) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = pushBoard({
    groupId: me.groupId,
    memberId: me.memberId,
    board: parsed.data.board as Board,
    score: parsed.data.score,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "not_running" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
