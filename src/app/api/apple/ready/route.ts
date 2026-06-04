import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { setLobbyReady } from "@/lib/apple";
import { getCurrentMember } from "@/server/auth";

const RATE_APPLE_READY: RateLimitConfig = {
  capacity: 10,
  refillPerSec: 2,
};

const Body = z.object({
  ready: z.boolean(),
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
  if (!consumeToken(`apple-ready:${me.memberId}`, RATE_APPLE_READY)) {
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

  setLobbyReady(me.groupId, me.memberId, parsed.data.ready);
  return NextResponse.json({ ok: true });
}
