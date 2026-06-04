import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { APPLE_COLS, APPLE_ROWS, clearRect } from "@/lib/apple";
import { getCurrentMember } from "@/server/auth";

// 지우기는 빨라야 1초에 몇 번 수준이므로 넉넉하게 허용한다.
const RATE_APPLE_CLEAR: RateLimitConfig = {
  capacity: 20,
  refillPerSec: 5,
};

const Body = z.object({
  r1: z.number().int().min(0).max(APPLE_ROWS - 1),
  c1: z.number().int().min(0).max(APPLE_COLS - 1),
  r2: z.number().int().min(0).max(APPLE_ROWS - 1),
  c2: z.number().int().min(0).max(APPLE_COLS - 1),
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
  if (!consumeToken(`apple-clear:${me.memberId}`, RATE_APPLE_CLEAR)) {
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

  const result = clearRect({
    groupId: me.groupId,
    memberId: me.memberId,
    ...parsed.data,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    cells: result.cells,
    newScore: result.newScore,
  });
}
