"use client";

import { SheetGridEmpty, SheetShell } from "./SheetShell";

export function PlaceholderSheet() {
  return (
    <SheetShell
      title="제목 없는 스프레드시트"
      tabs={[{ id: "sheet1", label: "Sheet1" }]}
      activeTabId="sheet1"
      onTabChange={() => undefined}
    >
      <div className="p-6">
        <SheetGridEmpty />
      </div>
    </SheetShell>
  );
}
