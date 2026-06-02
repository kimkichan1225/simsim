import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

const MAX_MEMBERS = 100;
const MAX_RESULTS = 5000;

type GameKey = "word" | "tetris";

type Row = {
  memberId: string;
  nickname: string;
  best: number; // 최고 한 판 점수
  wins: number; // 2인 이상 대결에서 1위
  losses: number; // 2인 이상 대결에서 1위 외
  matches: number; // 총 참가 판수
  lastPlayedAt: string | null;
};

// 멤버별 누적치 (게임별)
type Acc = {
  best: number;
  wins: number;
  losses: number;
  matches: number;
  lastPlayedAt: number | null;
};

function emptyAcc(): Acc {
  return { best: 0, wins: 0, losses: 0, matches: 0, lastPlayedAt: null };
}

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [members, results] = await Promise.all([
    prisma.member.findMany({
      where: { groupId: me.groupId },
      select: { id: true, nickname: true },
      take: MAX_MEMBERS,
    }),
    prisma.matchResult.findMany({
      where: { groupId: me.groupId },
      select: {
        memberId: true,
        game: true,
        score: true,
        rank: true,
        totalParticipants: true,
        endedAt: true,
      },
      orderBy: { endedAt: "desc" },
      take: MAX_RESULTS,
    }),
  ]);

  // 게임별 → 멤버별 누적
  const byGame: Record<GameKey, Map<string, Acc>> = {
    word: new Map(),
    tetris: new Map(),
  };

  for (const r of results) {
    const key: GameKey = r.game === "tetris" ? "tetris" : "word";
    const map = byGame[key];
    let acc = map.get(r.memberId);
    if (!acc) {
      acc = emptyAcc();
      map.set(r.memberId, acc);
    }
    acc.matches += 1;
    if (r.score > acc.best) acc.best = r.score;
    // 승패는 2인 이상 대결에서만 집계(혼자 플레이는 전적에 포함 안 함)
    if (r.totalParticipants >= 2) {
      if (r.rank === 1) acc.wins += 1;
      else acc.losses += 1;
    }
    const t = r.endedAt.getTime();
    if (acc.lastPlayedAt == null || t > acc.lastPlayedAt) acc.lastPlayedAt = t;
  }

  function buildRows(key: GameKey): Row[] {
    const map = byGame[key];
    const rows: Row[] = members.map((m) => {
      const a = map.get(m.id) ?? emptyAcc();
      return {
        memberId: m.id,
        nickname: m.nickname,
        best: a.best,
        wins: a.wins,
        losses: a.losses,
        matches: a.matches,
        lastPlayedAt:
          a.lastPlayedAt != null ? new Date(a.lastPlayedAt).toISOString() : null,
      };
    });
    // 최고 점수 내림차순 → 승 → 패 적은 순
    rows.sort(
      (a, b) =>
        b.best - a.best || b.wins - a.wins || a.losses - b.losses,
    );
    return rows;
  }

  return NextResponse.json({
    word: buildRows("word"),
    tetris: buildRows("tetris"),
  });
}
