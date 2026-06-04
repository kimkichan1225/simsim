import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { reportPresence } from "@/lib/waiting";
import { getCurrentMember } from "@/server/auth";

// 위치 보고는 탭 전환 + 25초 하트비트 수준이므로 가볍게 제한한다.
const RATE_PRESENCE: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 1,
};

const Body = z.object({
  // 탭 ID 슬러그 — 표시는 클라이언트 라벨 맵에서 하고, 모르는 값은 "이동 중" 처리
  location: z
    .string()
    .regex(/^[a-z]+$/)
    .min(1)
    .max(24),
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
  if (!consumeToken(`presence:${me.memberId}`, RATE_PRESENCE)) {
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

  reportPresence(me.groupId, me.memberId, me.nickname, parsed.data.location);
  return NextResponse.json({ ok: true });
}
