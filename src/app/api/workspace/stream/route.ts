import { registerControlSubscriber } from "@/lib/workspace-control";
import { sseResponse } from "@/lib/sse-route";
import { getCurrentMember } from "@/server/auth";

export const dynamic = "force-dynamic";

// 워크스페이스 전역 명령 SSE — 어느 탭에 있든 항상 연결되어 방장의 강제 이동 명령을 받는다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }

  return sseResponse(request, (send) => {
    const reg = registerControlSubscriber(me.groupId, me.memberId, send);
    return {
      initialData: JSON.stringify({ type: "connected" }),
      unsubscribe: reg.unsubscribe,
    };
  });
}
