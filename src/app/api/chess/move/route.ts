import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { CHESS_SIZE, applyMove } from "@/lib/chess";
import { getCurrentMember } from "@/server/auth";

const RATE_CHESS_MOVE: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

const CELLS = CHESS_SIZE * CHESS_SIZE;
const Body = z.object({
  from: z.number().int().min(0).max(CELLS - 1),
  to: z.number().int().min(0).max(CELLS - 1),
  promotion: z.enum(["Q", "R", "B", "N"]).optional(),
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
  if (!consumeToken(`chess-move:${me.memberId}`, RATE_CHESS_MOVE)) {
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

  const result = applyMove({
    groupId: me.groupId,
    memberId: me.memberId,
    from: parsed.data.from,
    to: parsed.data.to,
    promotion: parsed.data.promotion,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, end: result.end });
}
