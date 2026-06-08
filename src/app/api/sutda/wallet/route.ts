import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

// 내 보유 골드·누적 손익 조회. 그룹 전원의 골드도 함께 내려 방장 충전 UI에서 쓴다.
export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const members = await prisma.member.findMany({
    where: { groupId: me.groupId },
    select: { id: true, nickname: true, gold: true, netProfit: true },
    take: 100,
  });
  const meRow = members.find((m) => m.id === me.memberId);
  return NextResponse.json({
    gold: meRow?.gold ?? 0,
    netProfit: meRow?.netProfit ?? 0,
    members: members.map((m) => ({
      memberId: m.id,
      nickname: m.nickname,
      gold: m.gold,
      netProfit: m.netProfit,
    })),
  });
}
