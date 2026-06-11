import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

const MAX_MEMBERS = 100;
const MAX_RESULTS = 5000;

type GameKey = "tetris" | "apple" | "omok" | "chess" | "rummy";
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

// 집계 대상 게임 키 (그 외 game 값 — 제거된 단어줍기·수박게임 등 — 은 집계에서 제외)
const KNOWN_GAMES: ReadonlySet<string> = new Set([
  "tetris",
  "apple",
  "omok",
  "chess",
  "rummy",
]);

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [members, results] = await Promise.all([
    prisma.member.findMany({
      where: { groupId: me.groupId },
      select: { id: true, nickname: true, gold: true, netProfit: true },
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
    tetris: { solo: new Map(), versus: new Map() },
    apple: { solo: new Map(), versus: new Map() },
    omok: { solo: new Map(), versus: new Map() },
    chess: { solo: new Map(), versus: new Map() },
    rummy: { solo: new Map(), versus: new Map() },
  };

  for (const r of results) {
    // 제거된 게임(단어줍기·수박게임 등)의 과거 기록은 집계에서 제외한다
    if (!KNOWN_GAMES.has(r.game)) continue;
    const gameKey = r.game as GameKey;
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
    tetris: {
      solo: buildRows("tetris", "solo"),
      versus: buildRows("tetris", "versus"),
    },
    apple: {
      solo: buildRows("apple", "solo"),
      versus: buildRows("apple", "versus"),
    },
    // 오목은 1:1 대결 전용 — versus만 의미 있다
    omok: {
      solo: buildRows("omok", "solo"),
      versus: buildRows("omok", "versus"),
    },
    // 체스도 1:1 대결 전용 — versus만 의미 있다
    chess: {
      solo: buildRows("chess", "solo"),
      versus: buildRows("chess", "versus"),
    },
    // 루미큐브는 2~4인 대결 전용
    rummy: {
      solo: buildRows("rummy", "solo"),
      versus: buildRows("rummy", "versus"),
    },
    // 섯다는 골드 게임 — 보유 골드·누적 손익을 손익 높은 순으로
    sutda: [...members]
      .sort((a, b) => b.netProfit - a.netProfit)
      .map((m) => ({
        memberId: m.id,
        nickname: m.nickname,
        gold: m.gold,
        netProfit: m.netProfit,
      })),
  });
}
