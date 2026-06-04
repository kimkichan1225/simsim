import { registerSubscriber, type AppleEvent } from "@/lib/apple";
import { getCurrentMember, isGroupOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

// 사과게임 대결 전용 SSE. 단어줍기 스트림(/api/play/stream)과 동일한 구조다.
export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }
  const owner = await isGroupOwner(me.groupId, me.memberId);

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

      const send = (event: AppleEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const reg = registerSubscriber(
        me.groupId,
        me.memberId,
        me.nickname,
        owner,
        send,
      );
      unsubscribe = reg.unsubscribe;

      const ok = safeEnqueue(
        encoder.encode(`data: ${JSON.stringify(reg.initialEvent)}\n\n`),
      );
      if (!ok) {
        return;
      }

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
