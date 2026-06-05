import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import {
  isAllReady,
  isAloneInLobby,
  startMatch,
  type RummyResult,
} from "@/lib/rummy";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

const RATE_RUMMY_START: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 60,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`rummy-start:${me.memberId}`, RATE_RUMMY_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // 판 시작은 방장만. 루미큐브는 2~4인이라 혼자서는 시작할 수 없다.
  if (!(await isGroupOwner(me.groupId, me.memberId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isAloneInLobby(me.groupId, me.memberId)) {
    return NextResponse.json({ error: "need_opponent" }, { status: 409 });
  }
  if (!isAllReady(me.groupId)) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  const { matchId, startedAt } = startMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
    onEnded: async (results: RummyResult[], groupId: string) => {
      if (results.length === 0) return;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.matchResult.createMany({
            data: results.map((r) => ({
              memberId: r.memberId,
              groupId,
              game: "rummy",
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
                game: "rummy",
                topNickname: top.nickname,
                topScore: top.score,
                participants: results.length,
              }),
            },
          });
        });
      } catch (e) {
        console.error("rummy match result persist failed", e);
      }
    },
  });
  return NextResponse.json({ matchId, startedAt });
}
