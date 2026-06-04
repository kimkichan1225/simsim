import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { getCurrentMember } from "@/server/auth";

// 수박게임은 개인전 — 게임 오버/그만하기 시 점수를 솔로 기록으로 저장한다.
const RATE_SUIKA_RECORD: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 1 / 10,
};

const Body = z.object({
  score: z.number().int().min(1).max(1_000_000),
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
  if (!consumeToken(`suika-record:${me.memberId}`, RATE_SUIKA_RECORD)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const raw = await readJson(request);
  if (raw === null) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    await prisma.matchResult.create({
      data: {
        memberId: me.memberId,
        groupId: me.groupId,
        game: "suika",
        score: parsed.data.score,
        rank: 1,
        totalParticipants: 1,
      },
    });
  } catch (e) {
    console.error("suika record persist failed", e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
