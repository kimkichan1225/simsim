import { registerSubscriber } from "@/lib/rummy";
import { sseResponse } from "@/lib/sse-route";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// 루미큐브 전용 SSE — 공용 sseResponse 팩토리로 처리한다.
// 손패는 개인화 스냅샷(broadcastEach)으로 본인에게만 간다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }
  const owner = await isGroupOwner(me.groupId, me.memberId);

  return sseResponse(request, (send) => {
    const reg = registerSubscriber(
      me.groupId,
      me.memberId,
      me.nickname,
      owner,
      send,
    );
    return {
      initialData: JSON.stringify(reg.initialEvent),
      unsubscribe: reg.unsubscribe,
    };
  });
}
