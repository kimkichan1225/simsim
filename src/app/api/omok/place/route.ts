import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { OMOK_SIZE, placeStone } from "@/lib/omok";
import { getCurrentMember } from "@/server/auth";

// 턴제라 빠르게 연타할 일은 없지만 더블클릭 정도는 허용
const RATE_OMOK_PLACE: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

const Body = z.object({
  idx: z
    .number()
    .int()
    .min(0)
    .max(OMOK_SIZE * OMOK_SIZE - 1),
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
  if (!consumeToken(`omok-place:${me.memberId}`, RATE_OMOK_PLACE)) {
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

  const result = placeStone({
    groupId: me.groupId,
    memberId: me.memberId,
    idx: parsed.data.idx,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, win: result.win, draw: result.draw });
}
