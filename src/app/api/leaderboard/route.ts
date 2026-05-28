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
    prisma.gameRun.groupBy({
      by: ["memberId"],
      where: { member: { groupId: me.groupId } },
      _max: { wpm: true, finishedAt: true },
      _avg: { accuracy: true },
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
        bestWpm: null,
        avgAccuracy: null,
        runs: 0,
        lastPlayedAt: null,
      };
    }
    return {
      memberId: m.id,
      nickname: m.nickname,
      bestWpm: a._max.wpm != null ? Number(a._max.wpm.toFixed(1)) : null,
      avgAccuracy:
        a._avg.accuracy != null ? Number(a._avg.accuracy.toFixed(3)) : null,
      runs: a._count._all,
      lastPlayedAt:
        a._max.finishedAt != null ? a._max.finishedAt.toISOString() : null,
    };
  });

  rows.sort((a, b) => (b.bestWpm ?? -1) - (a.bestWpm ?? -1));

  return NextResponse.json({ rows });
}
