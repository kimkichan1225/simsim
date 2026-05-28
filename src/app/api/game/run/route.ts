import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeGameSession } from "@/lib/game-sessions";
import { verifyRun } from "@/lib/game-verify";
import {
  consumeToken,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import { getCurrentMember } from "@/server/auth";

const RATE_GAME_RUN: RateLimitConfig = {
  capacity: 6,
  refillPerSec: 6 / 300,
};

const Body = z.object({
  runId: z.string().min(8).max(128),
  mode: z.string().min(1).max(20),
  language: z.string().min(1).max(20),
  charsCorrect: z.number().int().min(0).max(10000),
  charsIncorrect: z.number().int().min(0).max(10000),
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
  if (!consumeToken(`game-run:${me.memberId}`, RATE_GAME_RUN)) {
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

  const session = consumeGameSession(parsed.data.runId, me.memberId);
  if ("error" in session) {
    return NextResponse.json(
      { error: "rejected", reason: session.error },
      { status: 400 },
    );
  }

  const verified = verifyRun({
    mode: parsed.data.mode,
    language: parsed.data.language,
    charsCorrect: parsed.data.charsCorrect,
    charsIncorrect: parsed.data.charsIncorrect,
    serverStartedAt: session.startedAt,
    finishedAt: Date.now(),
  });
  if ("error" in verified) {
    return NextResponse.json(
      { error: "rejected", reason: verified.error },
      { status: 400 },
    );
  }

  try {
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.gameRun.create({
        data: {
          memberId: me.memberId,
          mode: verified.mode,
          language: verified.language,
          wpm: verified.wpm,
          accuracy: verified.accuracy,
          durationSec: verified.durationSec,
          charsCorrect: verified.charsCorrect,
          charsIncorrect: verified.charsIncorrect,
          startedAt: verified.startedAt,
          finishedAt: verified.finishedAt,
          serverVerified: true,
        },
      });
      await tx.activityFeed.create({
        data: {
          groupId: me.groupId,
          memberId: me.memberId,
          kind: "game_result",
          payload: JSON.stringify({
            nickname: me.nickname,
            wpm: Number(verified.wpm.toFixed(1)),
            accuracy: Number(verified.accuracy.toFixed(3)),
            durationSec: verified.durationSec,
            language: verified.language,
          }),
        },
      });
      return created;
    });

    return NextResponse.json({
      id: run.id,
      wpm: run.wpm,
      accuracy: run.accuracy,
    });
  } catch (err) {
    console.error("game.run failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
