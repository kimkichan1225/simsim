import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { selectOpen } from "@/lib/sutda";
import { getCurrentMember } from "@/server/auth";

const RATE_SUTDA_OPEN: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

// 첫 2장 중 오픈할 카드 인덱스(0 또는 1) 선택
const Body = z.object({ idx: z.number().int().min(0).max(1) });

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
  if (!consumeToken(`sutda-open:${me.memberId}`, RATE_SUTDA_OPEN)) {
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

  const result = selectOpen({
    groupId: me.groupId,
    memberId: me.memberId,
    idx: parsed.data.idx,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
