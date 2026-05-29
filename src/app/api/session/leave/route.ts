import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  destroyGroup,
  removeParticipant,
  removeSubscriber,
} from "@/lib/multiplayer";
import { clearSessionCookie, getCurrentMember } from "@/server/auth";

export async function POST() {
  const me = await getCurrentMember();
  if (me) {
    try {
      removeSubscriber(me.groupId, me.memberId);
      removeParticipant(me.groupId, me.memberId);

      // 멤버를 삭제하고, 남은 멤버가 없으면 방을 폭파한다.
      // 마지막 멤버 둘이 동시에 나가는 경쟁 상황에서 빈 방이 남지 않도록
      // 그룹 행을 잠가(FOR UPDATE) 같은 그룹의 나가기를 직렬화한다.
      const groupEmptied = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Group" WHERE id = ${me.groupId} FOR UPDATE`;
        await tx.member.deleteMany({ where: { id: me.memberId } });
        const remaining = await tx.member.count({
          where: { groupId: me.groupId },
        });
        if (remaining === 0) {
          await tx.group.deleteMany({ where: { id: me.groupId } });
          return true;
        }
        return false;
      });

      if (groupEmptied) {
        destroyGroup(me.groupId);
      }
    } catch (e) {
      console.error("leave failed", e);
      return NextResponse.json({ error: "leave_failed" }, { status: 500 });
    }
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
