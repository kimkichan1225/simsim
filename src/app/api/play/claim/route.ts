import { NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeToken,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { claimWord } from "@/lib/multiplayer";
import { getCurrentMember } from "@/server/auth";

const RATE_PLAY_CLAIM: RateLimitConfig = {
  capacity: 60,
  refillPerSec: 4,
};

const Body = z.object({
  wordId: z.string().min(1).max(64),
  text: z.string().min(1).max(200),
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
  if (!consumeToken(`play-claim:${me.memberId}`, RATE_PLAY_CLAIM)) {
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

  const result = claimWord({
    groupId: me.groupId,
    memberId: me.memberId,
    wordId: parsed.data.wordId,
    attempt: parsed.data.text,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({
    points: result.points,
    newScore: result.newScore,
  });
}
