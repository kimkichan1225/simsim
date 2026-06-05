// 탭이 백그라운드일 때 제목 앞에 "(n)" 알림 카운트를 붙인다.
// 실제 Google Sheets의 안 읽은 댓글 표시와 같은 모양이라 위장이 유지된다.
// 탭으로 돌아오면(focus/visible) 자동으로 원래 제목으로 복원된다.

let pending = 0;
let baseTitle: string | null = null;
let bound = false;

function refresh(): void {
  if (baseTitle === null) baseTitle = document.title;
  document.title = pending > 0 ? `(${pending}) ${baseTitle}` : baseTitle;
}

function clear(): void {
  if (pending === 0) return;
  pending = 0;
  refresh();
}

function bind(): void {
  if (bound) return;
  bound = true;
  window.addEventListener("focus", clear);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") clear();
  });
}

// 새 알림 1건 — 탭을 보고 있으면 아무것도 하지 않는다.
export function notifyTab(): void {
  if (typeof document === "undefined") return; // SSR 가드
  bind();
  if (!document.hidden && document.hasFocus()) return;
  pending += 1;
  refresh();
}
