import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { selectCards } from "@/lib/sutda";
import { getCurrentMember } from "@/server/auth";

const RATE_SUTDA_SELECT: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

// 3장 중 쓸 2장 인덱스 선택(번복 불가)
const Body = z.object({
  cards: z.tuple([z.number().int().min(0).max(2), z.number().int().min(0).max(2)]),
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
  if (!consumeToken(`sutda-select:${me.memberId}`, RATE_SUTDA_SELECT)) {
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

  const result = selectCards({
    groupId: me.groupId,
    memberId: me.memberId,
    cards: parsed.data.cards,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
