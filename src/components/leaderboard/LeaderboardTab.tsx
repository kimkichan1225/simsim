"use client";

import { useEffect, useState } from "react";

type Row = {
  memberId: string;
  nickname: string;
  bestWpm: number | null;
  avgAccuracy: number | null;
  runs: number;
  lastPlayedAt: string | null;
};

const COLS = [
  { label: "닉네임", width: 160 },
  { label: "최고 WPM", width: 110 },
  { label: "평균 정확도", width: 110 },
  { label: "시도", width: 80 },
  { label: "최근 플레이", width: 200 },
];

const COL_LETTERS = ["A", "B", "C", "D", "E"];

export function LeaderboardTab({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/leaderboard")
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
      <div className="flex bg-white border-b border-[var(--sheet-cell-border)]">
        <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
          1
        </div>
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
          아직 기록이 없어요.
        </div>
      )}
      {rows?.map((row, idx) => (
        <div key={row.memberId} className="flex bg-white">
          <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-b border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
            {idx + 2}
          </div>
          <Cell width={COLS[0].width}>{row.nickname}</Cell>
          <Cell width={COLS[1].width} align="right">
            {row.bestWpm == null ? "-" : row.bestWpm.toFixed(1)}
          </Cell>
          <Cell width={COLS[2].width} align="right">
            {row.avgAccuracy == null
              ? "-"
              : `${Math.round(row.avgAccuracy * 100)}%`}
          </Cell>
          <Cell width={COLS[3].width} align="right">
            {row.runs}
          </Cell>
          <Cell width={COLS[4].width}>
            {row.lastPlayedAt ? formatRelative(row.lastPlayedAt) : "-"}
          </Cell>
        </div>
      ))}
    </div>
  );
}

function Cell({
  width,
  align = "left",
  children,
}: {
  width: number;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ width, justifyContent: align === "right" ? "flex-end" : "flex-start" }}
      className="h-[22px] border-b border-r border-[var(--sheet-cell-border)] px-2 text-[12px] flex items-center text-[var(--sheet-fg)] tabular-nums"
    >
      {children}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.round(hr / 24);
  return `${day}일 전`;
}
