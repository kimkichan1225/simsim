import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { reportOut } from "@/lib/tetris";
import { getCurrentMember } from "@/server/auth";

const RATE_TETRIS_OUT: RateLimitConfig = {
  capacity: 5,
  refillPerSec: 1,
};

const Body = z.object({
  score: z.number().int().min(0).max(100_000_000),
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
  if (!consumeToken(`tetris-out:${me.memberId}`, RATE_TETRIS_OUT)) {
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

  const result = reportOut({
    groupId: me.groupId,
    memberId: me.memberId,
    score: parsed.data.score,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "not_running" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, rank: result.rank });
}
