import { NextResponse } from "next/server";
import { removeSubscriber } from "@/lib/multiplayer";
import { removePresence } from "@/lib/waiting";
import {
  clearSessionCookie,
  getCurrentMember,
  rotateMemberSessionSecret,
} from "@/server/auth";

export async function POST() {
  const me = await getCurrentMember();
  if (me) {
    try {
      await rotateMemberSessionSecret(me.memberId);
      removeSubscriber(me.groupId, me.memberId);
      // 나가기 즉시 대기방 위치 명단에서도 내린다(TTL 대기 없이)
      removePresence(me.groupId, me.memberId);
    } catch (e) {
      console.error("session secret rotate failed", e);
      return NextResponse.json(
        { error: "rotate_failed" },
        { status: 500 },
      );
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
