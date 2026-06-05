import { NextResponse } from "next/server";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { joinMatch } from "@/lib/omok";
import { getCurrentMember } from "@/server/auth";

const RATE_OMOK_JOIN: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 1,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`omok-join:${me.memberId}`, RATE_OMOK_JOIN)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = joinMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, color: result.color });
}
