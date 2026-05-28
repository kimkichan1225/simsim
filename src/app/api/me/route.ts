import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/auth";

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    memberId: me.memberId,
    groupId: me.groupId,
    nickname: me.nickname,
    groupName: me.groupName,
  });
}
