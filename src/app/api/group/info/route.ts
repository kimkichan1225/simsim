import { NextResponse } from "next/server";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const isOwner = await isGroupOwner(me.groupId, me.memberId);
  return NextResponse.json({
    groupId: me.groupId,
    groupName: me.groupName,
    inviteCode: me.inviteCode,
    isOwner,
  });
}
