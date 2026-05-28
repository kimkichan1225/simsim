import { NextResponse } from "next/server";
import { removeSubscriber } from "@/lib/multiplayer";
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
