"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  kind: string;
  nickname: string;
  payload: unknown;
  createdAt: string;
};

const COLS = [
  { label: "시간", width: 160 },
  { label: "멤버", width: 160 },
  { label: "활동", width: 480 },
];

const COL_LETTERS = ["A", "B", "C"];

export function ActivityTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/activity")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((data: { rows: Row[] }) => {
        if (!cancelled) {
          setRows(data.rows);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="min-w-max select-none">
      <div className="flex sticky top-0 z-10 bg-[var(--sheet-header-bg)] border-b border-[var(--sheet-cell-border)]">
        <div className="w-10 h-6 border-r border-[var(--sheet-cell-border)]" />
        {COLS.map((c, i) => (
          <div
            key={c.label}
            style={{ width: c.width }}
            className="h-6 border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]"
          >
            {COL_LETTERS[i]}
          </div>
        ))}
      </div>
      <HeaderRow />
      {error && (
        <div className="px-3 py-2 text-[12px] text-[#d93025]">
          불러오기 실패 ({error})
        </div>
      )}
      {rows === null && !error && (
        <div className="px-3 py-2 text-[12px] text-[var(--sheet-muted)]">
          불러오는 중...
        </div>
      )}
      {rows !== null && rows.length === 0 && (
        <div className="px-3 py-2 text-[12px] text-[var(--sheet-muted)]">
          아직 활동이 없어요.
        </div>
      )}
      {rows?.map((row, idx) => (
        <div key={row.id} className="flex bg-white">
          <RowHeaderCell n={idx + 2} />
          <Cell width={COLS[0].width}>{formatTime(row.createdAt)}</Cell>
          <Cell width={COLS[1].width}>{row.nickname}</Cell>
          <Cell width={COLS[2].width}>{describe(row)}</Cell>
        </div>
      ))}
    </div>
  );
}

function HeaderRow() {
  return (
    <div className="flex bg-white border-b border-[var(--sheet-cell-border)]">
      <RowHeaderCell n={1} />
      {COLS.map((c) => (
        <div
          key={c.label}
          style={{ width: c.width }}
          className="h-[22px] border-r border-[var(--sheet-cell-border)] px-2 text-[12px] font-medium text-[var(--sheet-fg)] flex items-center"
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

function RowHeaderCell({ n }: { n: number }) {
  return (
    <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-b border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
      {n}
    </div>
  );
}

function Cell({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ width }}
      className="h-[22px] border-b border-r border-[var(--sheet-cell-border)] px-2 text-[12px] flex items-center text-[var(--sheet-fg)]"
    >
      {children}
    </div>
  );
}

function describe(row: Row): string {
  if (row.kind === "joined") return "그룹에 입장";
  if (row.kind === "game_result") {
    const p = row.payload as
      | { wpm?: number; accuracy?: number; durationSec?: number }
      | null;
    if (!p) return "게임 완료";
    return `타이핑 완료: WPM ${p.wpm ?? "-"} / 정확도 ${
      p.accuracy != null ? Math.round(p.accuracy * 100) + "%" : "-"
    } / ${p.durationSec ?? "-"}초`;
  }
  return row.kind;
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
