import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { sendAttack } from "@/lib/tetris";
import { getCurrentMember } from "@/server/auth";

const RATE_TETRIS_ATTACK: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 4,
};

const Body = z.object({
  lines: z.number().int().min(1).max(10),
  targetMemberId: z.string().max(64).optional(),
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
  if (!consumeToken(`tetris-attack:${me.memberId}`, RATE_TETRIS_ATTACK)) {
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

  const result = sendAttack({
    groupId: me.groupId,
    memberId: me.memberId,
    lines: parsed.data.lines,
    targetMemberId: parsed.data.targetMemberId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "not_running" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
