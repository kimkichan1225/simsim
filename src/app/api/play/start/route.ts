import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  consumeToken,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { startOrJoinGame, type GameResult } from "@/lib/multiplayer";
import { getCurrentMember } from "@/server/auth";

const RATE_PLAY_START: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 60,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`play-start:${me.memberId}`, RATE_PLAY_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const groupId = me.groupId;
  const { game, created } = startOrJoinGame({
    groupId,
    memberId: me.memberId,
    nickname: me.nickname,
    onEnded: async (results: GameResult[]) => {
      if (results.length === 0) return;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.matchResult.createMany({
            data: results.map((r) => ({
              memberId: r.memberId,
              groupId,
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
                topNickname: top.nickname,
                topScore: top.score,
                participants: results.length,
              }),
            },
          });
        });
      } catch (e) {
        console.error("match result persist failed", e);
      }
    },
  });

  return NextResponse.json({
    gameId: game.gameId,
    startedAt: game.startedAt,
    endsAt: game.endsAt,
    created,
  });
}
