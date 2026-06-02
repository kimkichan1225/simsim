"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MessageSquare, Send } from "lucide-react";

type ChatMessage = {
  id: string;
  memberId: string;
  nickname: string;
  text: string;
  createdAt: number;
};

type ChatEvent =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "group_destroyed" };

// 헤더의 말풍선(댓글) 버튼 — 누르면 그룹 채팅 패널이 열리고,
// 안 읽은 메시지 수가 뱃지로 표시된다(시트 댓글 기능 느낌).
export function ChatButton({
  myMemberId,
  myNickname,
}: {
  myMemberId: string;
  myNickname: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [input, setInput] = useState("");

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  // SSE 연결 (로그인된 동안 항상 유지 → 닫혀 있어도 안 읽음 카운트)
  useEffect(() => {
    const es = new EventSource("/api/chat/stream");
    es.onmessage = (e) => {
      if (!e.data) return;
      let ev: ChatEvent;
      try {
        ev = JSON.parse(e.data) as ChatEvent;
      } catch {
        return;
      }
      if (ev.type === "history") {
        setMessages(ev.messages);
      } else if (ev.type === "message") {
        setMessages((prev) =>
          prev.some((m) => m.id === ev.message.id)
            ? prev
            : [...prev, ev.message],
        );
        if (!openRef.current && ev.message.memberId !== myMemberId) {
          setUnread((n) => n + 1);
        }
      } else if (ev.type === "group_destroyed") {
        es.close();
      }
    };
    es.onerror = () => {
      /* 자동 재연결 */
    };
    return () => es.close();
  }, [myMemberId]);

  // 열릴 때 안 읽음 초기화 + 입력 포커스
  useEffect(() => {
    if (open) {
      setUnread(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // 새 메시지/열림 시 맨 아래로 스크롤
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages]);

  // 바깥 클릭 / ESC 닫기
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => undefined);
  }, [input]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing || composingRef.current) return;
    e.preventDefault();
    send();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="댓글"
        aria-label="댓글"
        className="relative flex items-center gap-1 px-2 py-1 rounded text-[13px] text-[var(--sheet-muted)] hover:bg-black/5"
      >
        <MessageSquare size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#d93025] text-white text-[10px] font-medium grid place-items-center leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-30 top-11 right-0 w-[320px] bg-white rounded-lg shadow-xl border border-[var(--sheet-border)] flex flex-col cursor-default">
          <div className="px-4 py-2.5 border-b border-[var(--sheet-border)] text-[14px] font-medium text-[var(--sheet-fg)]">
            댓글
          </div>

          <div
            ref={listRef}
            className="flex flex-col gap-2 px-3 py-3 overflow-y-auto"
            style={{ height: 320 }}
          >
            {messages.length === 0 ? (
              <div className="text-[12px] text-[var(--sheet-muted)] text-center py-6">
                아직 댓글이 없어요. 첫 댓글을 남겨보세요!
              </div>
            ) : (
              messages.map((m) => {
                const isMe = m.memberId === myMemberId;
                return (
                  <div
                    key={m.id}
                    className={
                      "flex flex-col " + (isMe ? "items-end" : "items-start")
                    }
                  >
                    <div className="text-[10px] text-[var(--sheet-muted)] mb-0.5 px-1">
                      {isMe ? "나" : m.nickname} · {formatTime(m.createdAt)}
                    </div>
                    <div
                      className={
                        "max-w-[230px] px-2.5 py-1.5 rounded-lg text-[13px] whitespace-pre-wrap break-words " +
                        (isMe
                          ? "bg-[var(--sheet-active)] text-white rounded-br-sm"
                          : "bg-[var(--sheet-header-bg)] text-[var(--sheet-fg)] rounded-bl-sm")
                      }
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center gap-1.5 p-2 border-t border-[var(--sheet-border)]">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onCompositionStart={() => (composingRef.current = true)}
              onCompositionEnd={() => (composingRef.current = false)}
              maxLength={500}
              autoComplete="off"
              placeholder="댓글 입력 후 Enter"
              className="flex-1 min-w-0 border border-[var(--sheet-border)] rounded px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-[var(--sheet-active)]"
            />
            <button
              type="button"
              onClick={send}
              aria-label="보내기"
              title="보내기"
              className="shrink-0 w-8 h-8 rounded grid place-items-center text-white bg-[var(--sheet-active)] hover:brightness-95 disabled:opacity-40"
              disabled={input.trim().length === 0}
            >
              <Send size={15} />
            </button>
          </div>
          <span className="sr-only">{myNickname}</span>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}
