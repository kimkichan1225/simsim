import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { updateLive } from "@/lib/rummy";
import { getCurrentMember } from "@/server/auth";

// 드래그 중 스로틀 전송(클라 ~300ms 간격)을 감당할 만큼 여유 있게
const RATE_RUMMY_LIVE: RateLimitConfig = {
  capacity: 20,
  refillPerSec: 8,
};

// 배치 중인 테이블: 타일 ID 2차원 배열 (play와 동일 형식) + 드는 중인 타일
const Body = z.object({
  table: z
    .array(z.array(z.string().min(1).max(8)).min(1).max(13))
    .max(40),
  dragging: z.string().min(1).max(8).nullable().optional(),
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
  if (!consumeToken(`rummy-live:${me.memberId}`, RATE_RUMMY_LIVE)) {
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

  // 미리보기 전용 — 실패해도 게임 진행에는 영향이 없으니 이유는 구분하지 않는다
  const result = updateLive({
    groupId: me.groupId,
    memberId: me.memberId,
    tableIds: parsed.data.table,
    draggingId: parsed.data.dragging ?? null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "rejected" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
