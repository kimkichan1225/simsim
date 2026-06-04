import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import {
  isAllReady,
  isAloneInLobby,
  startMatch,
  type AppleResult,
} from "@/lib/apple";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

const RATE_APPLE_START: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 60,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`apple-start:${me.memberId}`, RATE_APPLE_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // 대결 시작은 방장만 가능하다. 단, 대기실에 혼자면 누구든 솔로 시작 허용.
  // 참가자는 /api/apple/join으로 합류한다.
  if (
    !(await isGroupOwner(me.groupId, me.memberId)) &&
    !isAloneInLobby(me.groupId, me.memberId)
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 방장을 제외한 접속자 전원이 준비해야 시작할 수 있다(혼자면 통과).
  if (!isAllReady(me.groupId) && !isAloneInLobby(me.groupId, me.memberId)) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  const { matchId, startedAt, endsAt } = startMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
    onEnded: async (results: AppleResult[], groupId: string) => {
      if (results.length === 0) return;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.matchResult.createMany({
            data: results.map((r) => ({
              memberId: r.memberId,
              groupId,
              game: "apple",
              score: r.score,
              rank: r.rank,
              totalParticipants: results.length,
            })),
          });
          const top = results[0];
          await tx.activityFeed.create({
            data: {
              groupId,
              memberId: top.memberId,
              kind: "match_result",
              payload: JSON.stringify({
                game: "apple",
                topNickname: top.nickname,
                topScore: top.score,
                participants: results.length,
              }),
            },
          });
        });
      } catch (e) {
        console.error("apple match result persist failed", e);
      }
    },
  });
  return NextResponse.json({ matchId, startedAt, endsAt });
}
