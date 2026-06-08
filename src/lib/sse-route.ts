// SSE 라우트 공용 팩토리 — 게임/대기방 스트림 라우트의 ReadableStream 보일러플레이트
// (closed 가드, 15초 ping, abort/cleanup, 헤더)를 한 곳에 모은다.
//
// setup(send)에서 구독을 등록하고 초기 페이로드(직렬화 문자열)와 unsubscribe를 돌려준다.
// send는 이미 직렬화된 문자열을 받아 `data: ...` 프레임으로 감싼다(GameChannel과 호환).

import type { SseSubscriber } from "./game-channel";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export type SseSetup = {
  initialData: string; // 연결 직후 보낼 첫 이벤트(JSON.stringify 결과)
  unsubscribe: () => void;
};

export function sseResponse(
  request: Request,
  setup: (send: SseSubscriber) => SseSetup,
): Response {
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

      const send: SseSubscriber = (data) => {
        safeEnqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const reg = setup(send);
      unsubscribe = reg.unsubscribe;

      const ok = safeEnqueue(encoder.encode(`data: ${reg.initialData}\n\n`));
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

  return new Response(stream, { headers: SSE_HEADERS });
}
