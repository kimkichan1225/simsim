import { prisma } from "@/lib/db";
import { registerChatSubscriber, type ChatMessage } from "@/lib/chat";
import { getCurrentMember } from "@/server/auth";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

// 그룹 채팅 SSE. 접속 시 최근 메시지 history를 먼저 보내고, 이후 실시간 메시지를 흘려준다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {
    /* replaced below */
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      // history를 보내기 전(구독 등록 직후) 도착한 실시간 메시지는 버퍼에 모았다가
      // history 뒤에 순서대로 흘려보낸다 → 조회~구독 사이 메시지 누락 방지.
      let historySent = false;
      const pending: string[] = []; // 직렬화된 메시지 프레임

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

      const send = (data: string) => {
        if (!historySent) {
          pending.push(data);
          return;
        }
        safeEnqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // 1) 먼저 구독을 등록한다(이후 도착 메시지는 pending에 쌓인다)
      const reg = registerChatSubscriber(me.groupId, send);
      unsubscribe = reg.unsubscribe;
      request.signal.addEventListener("abort", realCleanup);

      // 2) 최근 메시지 history 조회(오래된 → 최신 순으로 정렬해 전달)
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
      if (closed) return; // 조회 도중 연결이 끊겼으면 중단
      const history: ChatMessage[] = recent.reverse().map((m) => ({
        id: m.id,
        memberId: m.memberId,
        nickname: m.nickname,
        text: m.text,
        createdAt: m.createdAt.getTime(),
      }));

      // 3) history 전송 후, 그 사이 쌓인 실시간 메시지를 flush (클라가 id로 중복 제거)
      const ok = safeEnqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "history", messages: history })}\n\n`,
        ),
      );
      if (!ok) return;
      historySent = true;
      for (const data of pending) {
        safeEnqueue(encoder.encode(`data: ${data}\n\n`));
      }
      pending.length = 0;

      pingTimer = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
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
