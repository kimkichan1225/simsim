// 게임/대기방 SSE 연결 공통 훅 — 클라이언트 컴포넌트가 공유한다.
// EventSource를 열어 메시지를 파싱하고, group_destroyed면 세션을 정리한 뒤
// 새로고침해 입장 화면으로 돌려보낸다. 그 외 이벤트는 onEvent로 전달한다.
// 컴포넌트 언마운트(탭 전환) 시 연결을 닫는다.

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

export function useGameStream<T extends { type: string }>(
  url: string,
  onEvent: (ev: T) => void,
): void {
  const router = useRouter();

  const handleDestroyed = useCallback(async () => {
    try {
      await fetch("/api/session/leave", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.refresh();
  }, [router]);

  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      if (!e.data) return;
      try {
        const ev = JSON.parse(e.data) as T;
        if (ev.type === "group_destroyed") {
          es.close();
          void handleDestroyed();
          return;
        }
        onEvent(ev);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      /* EventSource 자동 재연결 */
    };
    return () => es.close();
  }, [url, onEvent, handleDestroyed]);
}
