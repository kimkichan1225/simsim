import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import {
  isAllReady,
  isAloneInLobby,
  startMatch,
  SUTDA_ANTE,
  type SutdaResult,
} from "@/lib/sutda";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

const RATE_SUTDA_START: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 5 / 60,
};

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`sutda-start:${me.memberId}`, RATE_SUTDA_START)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // 판 시작은 방장만. 섯다는 2명 이상이어야 한다.
  if (!(await isGroupOwner(me.groupId, me.memberId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (isAloneInLobby(me.groupId, me.memberId)) {
    return NextResponse.json({ error: "need_opponent" }, { status: 409 });
  }
  if (!isAllReady(me.groupId)) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }

  const row = await prisma.member.findUnique({
    where: { id: me.memberId },
    select: { gold: true },
  });
  if ((row?.gold ?? 0) < SUTDA_ANTE) {
    return NextResponse.json({ error: "broke" }, { status: 409 });
  }

  const { matchId } = startMatch({
    groupId: me.groupId,
    memberId: me.memberId,
    nickname: me.nickname,
    gold: row?.gold ?? 0,
    onEnded: async (results: SutdaResult[], groupId: string) => {
      try {
        await prisma.$transaction(async (tx) => {
          // 각자 최종 골드 반영 + 누적 손익 갱신
          for (const r of results) {
            await tx.member.update({
              where: { id: r.memberId },
              data: { gold: r.finalGold, netProfit: { increment: r.delta } },
            });
          }
          // 승자 활동 피드(여러 명이면 첫 승자)
          const winner = results.find((r) => r.winner);
          if (winner) {
            await tx.activityFeed.create({
              data: {
                groupId,
                memberId: winner.memberId,
                kind: "match_result",
                payload: JSON.stringify({
                  game: "sutda",
                  topNickname: winner.nickname,
                  topScore: winner.delta,
                  participants: results.length,
                }),
              },
            });
          }
        });
      } catch (e) {
        console.error("sutda result persist failed", e);
      }
    },
  });
  return NextResponse.json({ matchId });
}
