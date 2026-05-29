"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  FolderOpen,
  History,
  Lock,
  LogOut,
  MessageSquare,
  MoreVertical,
  Plus,
  Printer,
  Redo2,
  Search,
  Share2,
  Sigma,
  Star,
  Undo2,
  Video,
} from "lucide-react";

const MENU_ITEMS = [
  "파일",
  "수정",
  "보기",
  "삽입",
  "서식",
  "데이터",
  "도구",
  "확장 프로그램",
  "도움말",
];

export type SheetTab = {
  id: string;
  label: string;
};

type Props = {
  title: string;
  tabs: SheetTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  rightUser?: ReactNode;
  onLeave?: () => void;
  children: ReactNode;
};

const BOSS_KEY_TARGET =
  process.env.NEXT_PUBLIC_BOSS_KEY_TARGET ?? "https://docs.google.com/spreadsheets/u/0/";

export function SheetShell({
  title,
  tabs,
  activeTabId,
  onTabChange,
  rightUser,
  onLeave,
  children,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        window.location.replace(BOSS_KEY_TARGET);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-screen">
      <HeaderBar title={title} rightUser={rightUser} onLeave={onLeave} />
      <MenuBar />
      <Toolbar />
      <FormulaBar />
      <main className="flex-1 overflow-auto bg-white">{children}</main>
      <SheetTabs tabs={tabs} activeId={activeTabId} onChange={onTabChange} />
    </div>
  );
}

function HeaderBar({
  title,
  rightUser,
  onLeave,
}: {
  title: string;
  rightUser?: ReactNode;
  onLeave?: () => void;
}) {
  return (
    <header className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--sheet-border)]">
      <a
        href={BOSS_KEY_TARGET}
        className="shrink-0 w-9 h-9 rounded grid place-items-center"
        title="Sheets 홈"
        aria-label="Sheets 홈"
      >
        <SheetsIcon />
      </a>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5 text-[18px] leading-5 text-[var(--sheet-fg)]">
          <span className="px-1 -mx-1 rounded hover:bg-black/5 cursor-text">
            {title}
          </span>
          <Star size={16} className="text-[var(--sheet-muted)]" />
          <FolderOpen size={16} className="text-[var(--sheet-muted)]" />
          <Cloud size={16} className="text-[var(--sheet-muted)]" />
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[12px] text-[var(--sheet-muted)]">
          {MENU_ITEMS.map((label) => (
            <button
              key={label}
              type="button"
              className="px-1.5 py-0.5 rounded hover:bg-black/5 cursor-default"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-1 rounded text-[13px] text-[var(--sheet-muted)] hover:bg-black/5 cursor-default"
      >
        <History size={16} />
      </button>
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-1 rounded text-[13px] text-[var(--sheet-muted)] hover:bg-black/5 cursor-default"
      >
        <MessageSquare size={16} />
      </button>
      <button
        type="button"
        className="flex items-center gap-1 px-2 py-1 rounded text-[13px] text-[var(--sheet-muted)] hover:bg-black/5 cursor-default"
      >
        <Video size={16} />
      </button>
      <button
        type="button"
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#c2e7ff] text-[#001d35] text-[14px] font-medium cursor-default"
      >
        <Lock size={14} />
        공유
      </button>
      {rightUser}
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          title="워크스페이스 나가기"
          aria-label="워크스페이스 나가기"
          className="ml-1 w-8 h-8 rounded-full grid place-items-center text-[var(--sheet-muted)] hover:bg-black/5"
        >
          <LogOut size={16} />
        </button>
      )}
    </header>
  );
}

function MenuBar() {
  return null;
}

type GroupInfo = {
  inviteCode: string;
  groupName: string;
};

// 툴바의 공유 버튼: 누르면 시트 코드와 초대 링크를 보여주고 복사할 수 있는 팝업을 연다.
function ShareButton() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 팝업이 열릴 때 그룹 정보를 한 번만 불러온다.
  useEffect(() => {
    if (!open || info || loading) return;
    setLoading(true);
    setError(false);
    fetch("/api/group/info")
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: GroupInfo) => setInfo(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [open, info, loading]);

  // 바깥 클릭/ESC로 팝업 닫기.
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

  const inviteLink = useMemo(() => {
    if (!info || typeof window === "undefined") return "";
    return `${window.location.origin}/?invite=${encodeURIComponent(info.inviteCode)}`;
  }, [info]);

  async function copy(value: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // 클립보드 권한이 없으면 무시 (사용자가 직접 선택 복사 가능)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-7 h-7 rounded grid place-items-center text-[var(--sheet-fg)] hover:bg-black/5"
        aria-label="공유"
        title="공유"
      >
        <Share2 size={16} />
      </button>

      {open && (
        <div className="absolute z-30 top-9 left-0 w-[320px] bg-white rounded-lg shadow-xl border border-[var(--sheet-border)] p-4 text-[var(--sheet-fg)] cursor-default">
          <div className="text-[15px] font-medium mb-3">
            {info ? `"${info.groupName}" 공유` : "공유"}
          </div>

          {loading && (
            <div className="text-[13px] text-[var(--sheet-muted)]">
              불러오는 중...
            </div>
          )}

          {error && (
            <div className="text-[13px] text-[#d93025]">
              정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
            </div>
          )}

          {info && !loading && (
            <div className="flex flex-col gap-3">
              <ShareRow
                label="시트 코드"
                value={info.inviteCode}
                mono
                copied={copied === "code"}
                onCopy={() => copy(info.inviteCode, "code")}
              />
              <ShareRow
                label="초대 링크"
                value={inviteLink}
                copied={copied === "link"}
                onCopy={() => copy(inviteLink, "link")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShareRow({
  label,
  value,
  mono,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--sheet-muted)]">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={
            (mono ? "font-mono tracking-widest " : "") +
            "flex-1 min-w-0 border border-[var(--sheet-border)] rounded px-2 py-1.5 text-[13px] bg-[var(--sheet-toolbar-bg)] focus:outline-none focus:border-[var(--sheet-active)]"
          }
        />
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 w-8 h-8 rounded grid place-items-center hover:bg-black/5"
          aria-label={`${label} 복사`}
          title="복사"
        >
          {copied ? (
            <Check size={16} className="text-[var(--sheet-active)]" />
          ) : (
            <Copy size={16} />
          )}
        </button>
      </div>
    </div>
  );
}

function Toolbar() {
  const Btn = ({ children }: { children: ReactNode }) => (
    <button
      type="button"
      className="w-7 h-7 rounded grid place-items-center text-[var(--sheet-fg)] hover:bg-black/5 cursor-default"
    >
      {children}
    </button>
  );
  const Sep = () => <div className="w-px h-5 bg-[var(--sheet-border)] mx-1" />;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--sheet-border)] bg-[var(--sheet-toolbar-bg)]">
      <Btn>
        <Search size={16} />
      </Btn>
      <Btn>
        <Undo2 size={16} />
      </Btn>
      <Btn>
        <Redo2 size={16} />
      </Btn>
      <Btn>
        <Printer size={16} />
      </Btn>
      <Sep />
      <button
        type="button"
        className="flex items-center gap-1 h-7 px-2 rounded text-[13px] hover:bg-black/5 cursor-default"
      >
        100%
        <ChevronDown size={14} />
      </button>
      <Sep />
      <Btn>
        <span className="text-[14px] font-medium">₩</span>
      </Btn>
      <Btn>
        <span className="text-[14px]">%</span>
      </Btn>
      <Btn>
        <span className="text-[12px]">.0</span>
      </Btn>
      <Btn>
        <span className="text-[12px]">.00</span>
      </Btn>
      <Sep />
      <button
        type="button"
        className="flex items-center gap-1 h-7 px-2 rounded text-[13px] hover:bg-black/5 cursor-default"
      >
        기본값 (Arial)
        <ChevronDown size={14} />
      </button>
      <Sep />
      <Btn>
        <Sigma size={16} />
      </Btn>
      <Btn>
        <ArrowLeftRight size={16} />
      </Btn>
      <ShareButton />
      <div className="flex-1" />
      <Btn>
        <MoreVertical size={16} />
      </Btn>
    </div>
  );
}

function FormulaBar() {
  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--sheet-border)] bg-white text-[13px] text-[var(--sheet-muted)]">
      <div className="flex items-center gap-1 px-2 py-0.5 border border-[var(--sheet-border)] rounded text-[var(--sheet-fg)] min-w-[64px]">
        A1
        <ChevronDown size={12} />
      </div>
      <span className="italic font-serif">fx</span>
      <div className="flex-1 truncate" />
    </div>
  );
}

function SheetTabs({
  tabs,
  activeId,
  onChange,
}: {
  tabs: SheetTab[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <footer className="flex items-center gap-1 px-2 py-1 border-t border-[var(--sheet-border)] bg-[var(--sheet-toolbar-bg)] text-[13px]">
      <button
        type="button"
        className="w-7 h-7 rounded grid place-items-center hover:bg-black/5 cursor-default"
        aria-label="시트 추가"
      >
        <Plus size={16} />
      </button>
      <button
        type="button"
        className="w-7 h-7 rounded grid place-items-center hover:bg-black/5 cursor-default"
        aria-label="모든 시트"
      >
        <MoreVertical size={16} />
      </button>
      <div className="w-px h-5 bg-[var(--sheet-border)] mx-1" />
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={
              active
                ? "flex items-center gap-1 px-3 py-1 rounded-t bg-white border-t-2 border-[var(--sheet-green)] text-[var(--sheet-fg)] font-medium"
                : "flex items-center gap-1 px-3 py-1 rounded hover:bg-black/5 text-[var(--sheet-muted)]"
            }
          >
            {tab.label}
          </button>
        );
      })}
    </footer>
  );
}

function SheetsIcon() {
  return (
    <svg viewBox="0 0 64 64" width={28} height={28} aria-hidden>
      <rect x="8" y="4" width="44" height="56" rx="4" fill="#0f9d58" />
      <rect x="14" y="14" width="32" height="40" rx="2" fill="#ffffff" />
      <g stroke="#0f9d58" strokeWidth="2">
        <line x1="14" y1="24" x2="46" y2="24" />
        <line x1="14" y1="34" x2="46" y2="34" />
        <line x1="14" y1="44" x2="46" y2="44" />
        <line x1="24" y1="14" x2="24" y2="54" />
        <line x1="36" y1="14" x2="36" y2="54" />
      </g>
    </svg>
  );
}

export function SheetGridEmpty({ rows = 30, cols = 8 }: { rows?: number; cols?: number }) {
  const colHeaders = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < cols; i++) out.push(String.fromCharCode(65 + i));
    return out;
  }, [cols]);
  const rowList = useMemo(
    () => Array.from({ length: rows }, (_, i) => i + 1),
    [rows],
  );

  return (
    <div className="min-w-max">
      <div className="flex sticky top-0 z-10 bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div className="w-10 h-6 border-r border-[var(--sheet-cell-border)]" />
        {colHeaders.map((h) => (
          <div
            key={h}
            className="w-24 h-6 border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]"
          >
            {h}
          </div>
        ))}
      </div>
      {rowList.map((r) => (
        <div key={r} className="flex">
          <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-b border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
            {r}
          </div>
          {colHeaders.map((h) => (
            <div
              key={h + r}
              className="w-24 h-[22px] border-b border-r border-[var(--sheet-cell-border)] bg-white"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function useSheetState(initial: string) {
  return useState(initial);
}
