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

  // 같은 그룹에 같은 닉네임(정규화 기준)이 이미 있으면 새 멤버를 만들지 않고
  // 기존 멤버 계정을 이어받는다(세션 재발급). 쿠키 만료/삭제 후 재입장 용도.
  const existing = await prisma.member.findUnique({
    where: { groupId_nicknameKey: { groupId: group.id, nicknameKey } },
  });
  if (existing) {
    await prisma.member.update({
      where: { id: existing.id },
      data: { sessionSecret },
    });
    await issueSessionCookie({
      memberId: existing.id,
      groupId: group.id,
      sessionSecret,
    });
    return NextResponse.json({ groupId: group.id });
  }

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
      // 동시 입장 경합으로 멤버가 막 생성된 경우 — 그 멤버를 이어받는다.
      const raced = await prisma.member.findUnique({
        where: { groupId_nicknameKey: { groupId: group.id, nicknameKey } },
      });
      if (raced) {
        await prisma.member.update({
          where: { id: raced.id },
          data: { sessionSecret },
        });
        await issueSessionCookie({
          memberId: raced.id,
          groupId: group.id,
          sessionSecret,
        });
        return NextResponse.json({ groupId: group.id });
      }
      return NextResponse.json({ error: "nickname_taken" }, { status: 409 });
    }
    console.error("group.join failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
