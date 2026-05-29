import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/session";

export type CurrentMember = {
  memberId: string;
  groupId: string;
  nickname: string;
  groupName: string;
  inviteCode: string;
};

export function generateSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySession(token);
  if (!payload) return null;

  const member = await prisma.member.findUnique({
    where: { id: payload.mid },
    include: { group: true },
  });
  if (!member) return null;
  if (member.groupId !== payload.gid) return null;
  if (!constantTimeEqual(member.sessionSecret, payload.sec)) return null;

  return {
    memberId: member.id,
    groupId: member.groupId,
    nickname: member.nickname,
    groupName: member.group.name,
    inviteCode: member.group.inviteCode,
  };
}

export async function issueSessionCookie(input: {
  memberId: string;
  groupId: string;
  sessionSecret: string;
}): Promise<void> {
  const token = await signSession({
    mid: input.memberId,
    gid: input.groupId,
    sec: input.sessionSecret,
  });
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions, value: token });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set({ ...sessionCookieOptions, value: "", maxAge: 0 });
}
