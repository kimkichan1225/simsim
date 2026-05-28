import { NextResponse } from "next/server";
import { createGameSession } from "@/lib/game-sessions";
import {
  consumeToken,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { getCurrentMember } from "@/server/auth";

const RATE_GAME_START: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 10 / 120,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`game-start:${me.memberId}`, RATE_GAME_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const session = createGameSession(me.memberId);
  return NextResponse.json({
    runId: session.runId,
    serverStartedAt: session.startedAt,
  });
}
