import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { CHECKERS_SIZE, applyMove } from "@/lib/checkers";
import { getCurrentMember } from "@/server/auth";

// 멀티 점프는 한 수씩 연속 호출되므로 단순 이동보다 여유를 둔다
const RATE_CHECKERS_MOVE: RateLimitConfig = {
  capacity: 20,
  refillPerSec: 4,
};

const CELLS = CHECKERS_SIZE * CHECKERS_SIZE;
const Body = z.object({
  from: z.number().int().min(0).max(CELLS - 1),
  to: z.number().int().min(0).max(CELLS - 1),
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
  if (!consumeToken(`checkers-move:${me.memberId}`, RATE_CHECKERS_MOVE)) {
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

  const result = applyMove({
    groupId: me.groupId,
    memberId: me.memberId,
    from: parsed.data.from,
    to: parsed.data.to,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, win: result.win });
}
