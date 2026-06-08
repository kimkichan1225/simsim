import { NextResponse } from "next/server";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { fold } from "@/lib/sutda";
import { getCurrentMember } from "@/server/auth";

const RATE_SUTDA_FOLD: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

// 다이(기권) — 차례와 무관하게 죽을 수 있다.
export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`sutda-fold:${me.memberId}`, RATE_SUTDA_FOLD)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = fold({ groupId: me.groupId, memberId: me.memberId });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
