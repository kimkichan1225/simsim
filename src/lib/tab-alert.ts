// 탭이 백그라운드일 때 알림 표시:
//   1) 제목 앞에 "(n)" 카운트 (Google 문서의 안 읽은 댓글 표시와 같은 모양)
//   2) 파비콘 우상단에 빨간 점 뱃지 (캔버스로 그려서 교체)
// 탭으로 돌아오면(focus/visible) 자동으로 원래 제목/아이콘으로 복원된다.

let pending = 0;
let baseTitle: string | null = null;
let bound = false;

// 파비콘 뱃지 상태
let originalIconHref: string | null = null;
let badgedIconHref: Promise<string | null> | null = null;

function iconLinks(): HTMLLinkElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"]',
    ),
  );
}

// 원래 파비콘 위에 빨간 점(흰 테두리)을 그린 data URL을 만든다
function drawBadgedIcon(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 64, 64);
        ctx.beginPath();
        ctx.arc(46, 18, 15, 0, Math.PI * 2);
        ctx.fillStyle = "#d93025";
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        resolve(c.toDataURL("image/png"));
      } catch {
        resolve(null); // 캔버스 실패 시 제목 표시만 사용
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function setFaviconBadge(on: boolean): void {
  const links = iconLinks();
  if (links.length === 0) return;
  if (originalIconHref === null) originalIconHref = links[0].href;
  if (!on) {
    for (const l of links) l.href = originalIconHref;
    return;
  }
  badgedIconHref ??= drawBadgedIcon(originalIconHref);
  void badgedIconHref.then((href) => {
    // 그려지는 동안 탭으로 돌아왔으면 적용하지 않는다
    if (href && pending > 0) for (const l of iconLinks()) l.href = href;
  });
}

function refreshTitle(): void {
  if (baseTitle === null) baseTitle = document.title;
  document.title = pending > 0 ? `(${pending}) ${baseTitle}` : baseTitle;
}

function clear(): void {
  if (pending === 0) return;
  pending = 0;
  refreshTitle();
  setFaviconBadge(false);
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
  refreshTitle();
  setFaviconBadge(true);
}
