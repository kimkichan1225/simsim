import { NextResponse } from "next/server";
import { snapshotRoster } from "@/lib/waiting";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// 방장 전용 — 공유 팝업에서 현재 접속자 명단(닉네임 + 현재 시트 위치)을 조회한다.
export async function GET() {
  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const owner = await isGroupOwner(me.groupId, me.memberId);
  if (!owner) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ members: snapshotRoster(me.groupId) });
}
