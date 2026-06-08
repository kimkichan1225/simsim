import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { destroyGroupApple } from "@/lib/apple";
import { destroyGroupOmok } from "@/lib/omok";
import { destroyGroupRummy } from "@/lib/rummy";
import { destroyGroupSutda } from "@/lib/sutda";
import { destroyGroupTetris } from "@/lib/tetris";
import { destroyGroupChat } from "@/lib/chat";
import { destroyGroupWaiting } from "@/lib/waiting";
import {
  clearSessionCookie,
  getCurrentMember,
  isGroupOwner,
} from "@/server/auth";

export async function POST() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 방장(생성자)만 방을 폭파할 수 있다.
  const owner = await isGroupOwner(me.groupId, me.memberId);
  if (!owner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // 그룹 삭제 → 멤버/활동/기록 cascade 삭제. 이미 삭제됐어도 안전하도록 deleteMany 사용.
    await prisma.group.deleteMany({ where: { id: me.groupId } });
    destroyGroupApple(me.groupId);
    destroyGroupOmok(me.groupId);
    destroyGroupRummy(me.groupId);
    destroyGroupSutda(me.groupId);
    destroyGroupTetris(me.groupId);
    destroyGroupChat(me.groupId);
    destroyGroupWaiting(me.groupId);
  } catch (e) {
    console.error("group destroy failed", e);
    return NextResponse.json({ error: "destroy_failed" }, { status: 500 });
  }

  // 방장 자신의 세션도 정리한다.
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
