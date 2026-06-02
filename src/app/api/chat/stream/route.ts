import { prisma } from "@/lib/db";
import {
  registerChatSubscriber,
  type ChatEvent,
  type ChatMessage,
} from "@/lib/chat";
import { getCurrentMember } from "@/server/auth";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

// 그룹 채팅 SSE. 접속 시 최근 메시지 history를 먼저 보내고, 이후 실시간 메시지를 흘려준다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }

  // 최근 메시지 불러오기(오래된 → 최신 순으로 정렬해 전달)
  const recent = await prisma.chatMessage.findMany({
    where: { groupId: me.groupId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      memberId: true,
      nickname: true,
      text: true,
      createdAt: true,
    },
  });
  const history: ChatMessage[] = recent
    .reverse()
    .map((m) => ({
      id: m.id,
      memberId: m.memberId,
      nickname: m.nickname,
      text: m.text,
      createdAt: m.createdAt.getTime(),
    }));

  const encoder = new TextEncoder();
  let cleanup = () => {
    /* replaced below */
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      const realCleanup = () => {
        if (closed) return;
        closed = true;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        request.signal.removeEventListener("abort", realCleanup);
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      cleanup = realCleanup;

      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          realCleanup();
          return false;
        }
      };

      const send = (event: ChatEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const reg = registerChatSubscriber(me.groupId, send);
      unsubscribe = reg.unsubscribe;

      const ok = safeEnqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "history", messages: history })}\n\n`,
        ),
      );
      if (!ok) return;

      pingTimer = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      request.signal.addEventListener("abort", realCleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
