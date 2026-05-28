import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

const MAX_ROWS = 100;

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [members, agg] = await Promise.all([
    prisma.member.findMany({
      where: { groupId: me.groupId },
      select: { id: true, nickname: true },
      take: MAX_ROWS,
    }),
    prisma.matchResult.groupBy({
      by: ["memberId"],
      where: { groupId: me.groupId },
      _sum: { score: true },
      _max: { score: true, endedAt: true },
      _count: { _all: true },
    }),
  ]);

  const aggMap = new Map(agg.map((a) => [a.memberId, a]));

  const rows = members.map((m) => {
    const a = aggMap.get(m.id);
    if (!a || a._count._all === 0) {
      return {
        memberId: m.id,
        nickname: m.nickname,
        totalScore: 0,
        bestRound: null,
        matches: 0,
        lastPlayedAt: null,
      };
    }
    return {
      memberId: m.id,
      nickname: m.nickname,
      totalScore: a._sum.score ?? 0,
      bestRound: a._max.score ?? null,
      matches: a._count._all,
      lastPlayedAt:
        a._max.endedAt != null ? a._max.endedAt.toISOString() : null,
    };
  });

  rows.sort((a, b) => b.totalScore - a.totalScore);

  return NextResponse.json({ rows });
}
