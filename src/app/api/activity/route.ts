import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentMember } from "@/server/auth";

const PAGE_SIZE = 30;

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const items = await prisma.activityFeed.findMany({
    where: { groupId: me.groupId },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      kind: true,
      payload: true,
      createdAt: true,
      memberId: true,
      member: { select: { nickname: true } },
    },
  });

  const rows = items.map((it) => ({
    id: it.id,
    kind: it.kind,
    nickname: it.member.nickname,
    payload: safeParse(it.payload),
    createdAt: it.createdAt.toISOString(),
  }));

  return NextResponse.json({ rows });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
