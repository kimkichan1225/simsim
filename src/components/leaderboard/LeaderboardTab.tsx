"use client";

import { useEffect, useState } from "react";

type Row = {
  memberId: string;
  nickname: string;
  best: number;
  wins: number;
  losses: number;
  matches: number;
  lastPlayedAt: string | null;
};

type Data = { word: Row[]; tetris: Row[] };

const COLS = [
  { label: "순위", width: 70, align: "left" as const },
  { label: "닉네임", width: 150, align: "left" as const },
  { label: "최고 점수", width: 100, align: "right" as const },
  { label: "승", width: 60, align: "right" as const },
  { label: "패", width: 60, align: "right" as const },
  { label: "판수", width: 70, align: "right" as const },
];
const COL_LETTERS = ["A", "B", "C", "D", "E", "F"];
const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardTab({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch("/api/leaderboard")
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((d: Data) => {
        if (!cancelled) {
          setData(d);
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

  if (error) {
    return (
      <div className="px-3 py-2 text-[12px] text-[#d93025]">
        불러오기 실패 ({error})
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="px-3 py-2 text-[12px] text-[var(--sheet-muted)]">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 select-none">
      <ScoreTable title="🟦 단어줍기" rows={data.word} />
      <ScoreTable title="⬜ 테트리스" rows={data.tetris} />
    </div>
  );
}

function ScoreTable({ title, rows }: { title: string; rows: Row[] }) {
  // 한 번이라도 참가한 사람만 순위에 올린다.
  const played = rows.filter((r) => r.matches > 0);

  return (
    <div className="min-w-max">
      <div className="text-[13px] font-medium text-[var(--sheet-fg)] mb-1.5">
        {title}
      </div>

      {/* 열 머리글 (A~F) */}
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

      {/* 라벨 행 (sheet row 1) */}
      <div className="flex bg-white border-b border-[var(--sheet-cell-border)]">
        <RowNum n={1} />
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

      {played.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-[var(--sheet-muted)]">
          아직 기록이 없어요.
        </div>
      ) : (
        played.map((row, idx) => (
          <div key={row.memberId} className="flex bg-white">
            <RowNum n={idx + 2} />
            <Cell width={COLS[0].width}>
              {idx < 3 ? `${MEDALS[idx]} ` : ""}
              {idx + 1}
            </Cell>
            <Cell width={COLS[1].width}>{row.nickname}</Cell>
            <Cell width={COLS[2].width} align="right">
              {row.best}
            </Cell>
            <Cell width={COLS[3].width} align="right">
              {row.wins}
            </Cell>
            <Cell width={COLS[4].width} align="right">
              {row.losses}
            </Cell>
            <Cell width={COLS[5].width} align="right">
              {row.matches}
            </Cell>
          </div>
        ))
      )}
    </div>
  );
}

function RowNum({ n }: { n: number }) {
  return (
    <div className="w-10 h-[22px] sticky left-0 bg-[var(--sheet-header-bg)] border-b border-r border-[var(--sheet-cell-border)] grid place-items-center text-[12px] text-[var(--sheet-muted)]">
      {n}
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
      style={{
        width,
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
      className="h-[22px] border-b border-r border-[var(--sheet-cell-border)] px-2 text-[12px] flex items-center text-[var(--sheet-fg)] tabular-nums"
    >
      {children}
    </div>
  );
}
