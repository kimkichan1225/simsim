import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  isValidInviteCodeShape,
  normalizeInviteCode,
} from "@/lib/invite-code";
import {
  canonicalizeNickname,
  isAllowedNickname,
} from "@/lib/nickname";
import {
  clientKey,
  consumeToken,
  RATE_GROUP_JOIN,
} from "@/lib/rate-limit";
import { assertSessionSecretConfigured } from "@/lib/session";
import { generateSessionSecret, issueSessionCookie } from "@/server/auth";

const Body = z.object({
  inviteCode: z.string().min(1).max(40),
  nickname: z.string().trim().min(1).max(20),
});

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!consumeToken(`join:${clientKey(request)}`, RATE_GROUP_JOIN)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    assertSessionSecretConfigured();
  } catch (err) {
    console.error("session secret misconfigured", err);
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const raw = await readJson(request);
  if (raw === null) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const parsedResult = Body.safeParse(raw);
  if (!parsedResult.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const parsed = parsedResult.data;

  const code = normalizeInviteCode(parsed.inviteCode);
  if (!isValidInviteCodeShape(code)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  if (!isAllowedNickname(parsed.nickname)) {
    return NextResponse.json({ error: "invalid_nickname" }, { status: 400 });
  }
  const nicknameKey = canonicalizeNickname(parsed.nickname);
  if (nicknameKey.length === 0) {
    return NextResponse.json({ error: "invalid_nickname" }, { status: 400 });
  }

  const group = await prisma.group.findUnique({
    where: { inviteCode: code },
  });
  if (!group) {
    return NextResponse.json({ error: "invalid_code" }, { status: 404 });
  }

  const sessionSecret = generateSessionSecret();
  try {
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.member.create({
        data: {
          groupId: group.id,
          nickname: parsed.nickname,
          nicknameKey,
          sessionSecret,
        },
      });
      await tx.activityFeed.create({
        data: {
          groupId: group.id,
          memberId: newMember.id,
          kind: "joined",
          payload: JSON.stringify({ nickname: parsed.nickname }),
        },
      });
      return newMember;
    });

    await issueSessionCookie({
      memberId: member.id,
      groupId: group.id,
      sessionSecret,
    });

    return NextResponse.json({ groupId: group.id });
  } catch (err) {
    const errorCode = (err as { code?: string }).code;
    if (errorCode === "P2002") {
      return NextResponse.json({ error: "nickname_taken" }, { status: 409 });
    }
    console.error("group.join failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
