import { NextResponse } from "next/server";
import { getCurrentMember } from "@/server/auth";

export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    groupId: me.groupId,
    groupName: me.groupName,
    inviteCode: me.inviteCode,
  });
}
