import { registerWaitingSubscriber } from "@/lib/waiting";
import { sseResponse } from "@/lib/sse-route";
import { getCurrentMember } from "@/server/auth";

export const dynamic = "force-dynamic";

// 대기방 presence 전용 SSE — 공용 sseResponse 팩토리로 처리한다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }

  return sseResponse(request, (send) => {
    const reg = registerWaitingSubscriber(
      me.groupId,
      me.memberId,
      me.nickname,
      send,
    );
    return {
      initialData: JSON.stringify(reg.initialEvent),
      unsubscribe: reg.unsubscribe,
    };
  });
}
