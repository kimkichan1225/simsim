import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { sendMove } from "@/lib/workspace-control";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

// 방장이 클릭으로 보내는 명령이므로 가볍게 제한한다.
const RATE_MOVE: RateLimitConfig = {
  capacity: 20,
  refillPerSec: 2,
};

// 이동 가능한 시트(탭) 슬러그 — WorkspaceSheet의 TABS와 일치해야 한다.
const ALLOWED_LOCATIONS = [
  "waiting",
  "tetris",
  "apple",
  "omok",
  "chess",
  "rummy",
  "sutda",
  "leaderboard",
  "activity",
] as const;

const Body = z.object({
  memberId: z.string().min(1).max(64),
  location: z.enum(ALLOWED_LOCATIONS),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// 방장이 특정 참가자를 다른 시트(탭)로 강제 이동시킨다.
export async function POST(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const owner = await isGroupOwner(me.groupId, me.memberId);
  if (!owner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!consumeToken(`move:${me.memberId}`, RATE_MOVE)) {
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

  sendMove(me.groupId, parsed.data.memberId, parsed.data.location);
  return NextResponse.json({ ok: true });
}
