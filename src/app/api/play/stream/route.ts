import { subscribe, type GameEvent } from "@/lib/multiplayer";
import { getCurrentMember } from "@/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const me = await getCurrentMember();
  if (!me) {
    return new Response("unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const send = (event: GameEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      pingTimer = setInterval(() => {
        safeEnqueue(encoder.encode(`: ping\n\n`));
      }, 15000);

      unsubscribe = subscribe(me.groupId, me.memberId, send);

      const onAbort = () => {
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };
      request.signal.addEventListener("abort", onAbort);
    },
    cancel() {
      if (pingTimer) clearInterval(pingTimer);
      if (unsubscribe) unsubscribe();
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
