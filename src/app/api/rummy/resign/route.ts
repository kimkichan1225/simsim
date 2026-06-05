import { NextResponse } from "next/server";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { resign } from "@/lib/rummy";
import { getCurrentMember } from "@/server/auth";

const RATE_RUMMY_RESIGN: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 1,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`rummy-resign:${me.memberId}`, RATE_RUMMY_RESIGN)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const result = resign({
    groupId: me.groupId,
    memberId: me.memberId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
