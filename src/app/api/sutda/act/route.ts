import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { act } from "@/lib/sutda";
import { getCurrentMember } from "@/server/auth";

const RATE_SUTDA_ACT: RateLimitConfig = {
  capacity: 20,
  refillPerSec: 2,
};

// 베팅 액션 — 다이(die)는 차례와 무관하므로 /api/sutda/fold 로 분리
const Body = z.object({
  action: z.enum(["call", "bbing", "ttadang", "half"]),
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
  if (!consumeToken(`sutda-act:${me.memberId}`, RATE_SUTDA_ACT)) {
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

  const result = act({
    groupId: me.groupId,
    memberId: me.memberId,
    action: parsed.data.action,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
