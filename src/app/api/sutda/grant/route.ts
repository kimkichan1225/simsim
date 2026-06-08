import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

const RATE_SUTDA_GRANT: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 10 / 60,
};

// 방장이 멤버에게 골드를 충전한다(빚 없음 — 보유 골드만 증가, 손익에는 안 잡힘).
// 진행 중인 판에는 즉시 반영되지 않고 다음 판부터 적용된다(시작 시 DB에서 로드).
const Body = z.object({
  targetMemberId: z.string().min(1).max(64),
  amount: z.number().int().min(1).max(1_000_000),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!consumeToken(`sutda-grant:${me.memberId}`, RATE_SUTDA_GRANT)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!(await isGroupOwner(me.groupId, me.memberId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await readJson(request);
  if (raw === null) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // 충전 대상이 같은 그룹 멤버인지 확인
  const target = await prisma.member.findUnique({
    where: { id: parsed.data.targetMemberId },
    select: { groupId: true },
  });
  if (!target || target.groupId !== me.groupId) {
    return NextResponse.json({ error: "not_in_group" }, { status: 400 });
  }

  const updated = await prisma.member.update({
    where: { id: parsed.data.targetMemberId },
    data: { gold: { increment: parsed.data.amount } },
    select: { gold: true },
  });
  return NextResponse.json({ ok: true, gold: updated.gold });
}
