import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generateInviteCode } from "@/lib/invite-code";
import {
  canonicalizeNickname,
  isAllowedNickname,
} from "@/lib/nickname";
import {
  clientKey,
  consumeToken,
  RATE_GROUP_CREATE,
} from "@/lib/rate-limit";
import { assertSessionSecretConfigured } from "@/lib/session";
import { generateSessionSecret, issueSessionCookie } from "@/server/auth";

const Body = z.object({
  groupName: z.string().trim().min(1).max(40),
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
  if (!consumeToken(`create:${clientKey(request)}`, RATE_GROUP_CREATE)) {
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

  if (!isAllowedNickname(parsed.nickname)) {
    return NextResponse.json({ error: "invalid_nickname" }, { status: 400 });
  }
  const nicknameKey = canonicalizeNickname(parsed.nickname);
  if (nicknameKey.length === 0) {
    return NextResponse.json({ error: "invalid_nickname" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    const sessionSecret = generateSessionSecret();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: { name: parsed.groupName, inviteCode },
        });
        const member = await tx.member.create({
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
            memberId: member.id,
            kind: "joined",
            payload: JSON.stringify({ nickname: parsed.nickname }),
          },
        });
        return { group, member };
      });

      await issueSessionCookie({
        memberId: result.member.id,
        groupId: result.group.id,
        sessionSecret,
      });

      return NextResponse.json({
        groupId: result.group.id,
        inviteCode: result.group.inviteCode,
      });
    } catch (err) {
      const errorCode = (err as { code?: string }).code;
      if (errorCode === "P2002") continue;
      console.error("group.create failed", err);
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "invite_code_collision" },
    { status: 500 },
  );
}
