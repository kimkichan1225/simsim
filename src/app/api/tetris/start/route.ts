import { NextResponse } from "next/server";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { startMatch } from "@/lib/tetris";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

const RATE_TETRIS_START: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 60,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`tetris-start:${me.memberId}`, RATE_TETRIS_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // 대결 시작은 방장만 가능하다. 참가자는 /api/tetris/join으로 합류한다.
  if (!(await isGroupOwner(me.groupId, me.memberId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { matchId, startedAt } = startMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
  });
  return NextResponse.json({ matchId, startedAt });
}
