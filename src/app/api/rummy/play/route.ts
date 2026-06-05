import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { playTurn } from "@/lib/rummy";
import { getCurrentMember } from "@/server/auth";

const RATE_RUMMY_PLAY: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 1,
};

// 테이블 전체 배치: 타일 ID 2차원 배열 (세트당 3~13장, 최대 40세트)
const Body = z.object({
  table: z
    .array(z.array(z.string().min(1).max(8)).min(1).max(13))
    .max(40),
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
  if (!consumeToken(`rummy-play:${me.memberId}`, RATE_RUMMY_PLAY)) {
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

  const result = playTurn({
    groupId: me.groupId,
    memberId: me.memberId,
    tableIds: parsed.data.table,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, won: result.won });
}
