import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

const MAX_MEMBERS = 100;
const MAX_RESULTS = 5000;

type GameKey = "word" | "tetris" | "apple" | "suika" | "omok" | "rummy";
type ModeKey = "solo" | "versus"; // 혼자(참가자 1명) | 대결(2명 이상)

type Row = {
  memberId: string;
  nickname: string;
  best: number; // 최고 한 판 점수
  wins: number; // 대결에서 1위 (혼자 모드에선 항상 0)
  losses: number; // 대결에서 1위 외 (혼자 모드에선 항상 0)
  matches: number; // 총 참가 판수
  lastPlayedAt: string | null;
};

// 멤버별 누적치 (게임·모드별)
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

  // 게임·모드별 → 멤버별 누적
  const byGameMode: Record<GameKey, Record<ModeKey, Map<string, Acc>>> = {
    word: { solo: new Map(), versus: new Map() },
    tetris: { solo: new Map(), versus: new Map() },
    apple: { solo: new Map(), versus: new Map() },
    suika: { solo: new Map(), versus: new Map() },
    omok: { solo: new Map(), versus: new Map() },
    rummy: { solo: new Map(), versus: new Map() },
  };

  const KNOWN_GAMES: ReadonlySet<string> = new Set([
    "tetris",
    "apple",
    "suika",
    "omok",
    "rummy",
  ]);
  for (const r of results) {
    const gameKey: GameKey = KNOWN_GAMES.has(r.game)
      ? (r.game as GameKey)
      : "word";
    const modeKey: ModeKey = r.totalParticipants >= 2 ? "versus" : "solo";
    const map = byGameMode[gameKey][modeKey];
    let acc = map.get(r.memberId);
    if (!acc) {
      acc = emptyAcc();
      map.set(r.memberId, acc);
    }
    acc.matches += 1;
    if (r.score > acc.best) acc.best = r.score;
    // 승패는 대결에서만 의미 있음
    if (modeKey === "versus") {
      if (r.rank === 1) acc.wins += 1;
      else acc.losses += 1;
    }
    const t = r.endedAt.getTime();
    if (acc.lastPlayedAt == null || t > acc.lastPlayedAt) acc.lastPlayedAt = t;
  }

  function buildRows(gameKey: GameKey, modeKey: ModeKey): Row[] {
    const map = byGameMode[gameKey][modeKey];
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
    word: {
      solo: buildRows("word", "solo"),
      versus: buildRows("word", "versus"),
    },
    tetris: {
      solo: buildRows("tetris", "solo"),
      versus: buildRows("tetris", "versus"),
    },
    apple: {
      solo: buildRows("apple", "solo"),
      versus: buildRows("apple", "versus"),
    },
    // 수박게임은 개인전 전용 — solo만 의미 있다
    suika: {
      solo: buildRows("suika", "solo"),
      versus: buildRows("suika", "versus"),
    },
    // 오목은 1:1 대결 전용 — versus만 의미 있다
    omok: {
      solo: buildRows("omok", "solo"),
      versus: buildRows("omok", "versus"),
    },
    // 루미큐브는 2~4인 대결 전용
    rummy: {
      solo: buildRows("rummy", "solo"),
      versus: buildRows("rummy", "versus"),
    },
  });
}
