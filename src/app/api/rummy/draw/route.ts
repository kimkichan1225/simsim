import { NextResponse } from "next/server";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { drawAndPass } from "@/lib/rummy";
import { getCurrentMember } from "@/server/auth";

const RATE_RUMMY_DRAW: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 1,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`rummy-draw:${me.memberId}`, RATE_RUMMY_DRAW)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = drawAndPass({
    groupId: me.groupId,
    memberId: me.memberId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
