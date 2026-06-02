import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { broadcastChat } from "@/lib/chat";
import { consumeToken, type RateLimitConfig } from "@/lib/rate-limit";
import { getCurrentMember } from "@/server/auth";

const RATE_CHAT_SEND: RateLimitConfig = {
  capacity: 8,
  refillPerSec: 1,
};

const Body = z.object({
  text: z.string().trim().min(1).max(500),
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
  if (!consumeToken(`chat-send:${me.memberId}`, RATE_CHAT_SEND)) {
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

  const saved = await prisma.chatMessage.create({
    data: {
      groupId: me.groupId,
      memberId: me.memberId,
      nickname: me.nickname,
      text: parsed.data.text,
    },
    select: { id: true, createdAt: true },
  });

  broadcastChat(me.groupId, {
    type: "message",
    message: {
      id: saved.id,
      memberId: me.memberId,
      nickname: me.nickname,
      text: parsed.data.text,
      createdAt: saved.createdAt.getTime(),
    },
  });

  return NextResponse.json({ ok: true });
}
