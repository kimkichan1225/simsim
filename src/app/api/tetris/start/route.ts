import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { isAllReady, startMatch, type TetrisResult } from "@/lib/tetris";
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

  // 방장을 제외한 접속자 전원이 준비해야 시작할 수 있다(혼자면 통과).
  if (!isAllReady(me.groupId)) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  const { matchId, startedAt } = startMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
    onEnded: async (results: TetrisResult[], groupId: string) => {
      if (results.length === 0) return;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.matchResult.createMany({
            data: results.map((r) => ({
              memberId: r.memberId,
              groupId,
              game: "tetris",
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
                game: "tetris",
                topNickname: top.nickname,
                topScore: top.score,
                participants: results.length,
              }),
            },
          });
        });
      } catch (e) {
        console.error("tetris match result persist failed", e);
      }
    },
  });
  return NextResponse.json({ matchId, startedAt });
}
