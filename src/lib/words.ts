export type Word = {
  text: string;
  lang: "ko" | "en";
  points: number;
};

const KO_2: string[] = [
  "회의",
  "보고",
  "결재",
  "검토",
  "자료",
  "일정",
  "발표",
  "마감",
  "공유",
  "확인",
  "수정",
  "초안",
  "휴가",
  "출근",
  "퇴근",
  "야근",
];

const KO_3_4: string[] = [
  "보고서",
  "회의록",
  "스케줄",
  "마케팅",
  "디자인",
  "데이터",
  "프로젝트",
  "클라이언트",
  "리포트",
  "런칭일",
  "캠페인",
  "리뷰콜",
  "분기말",
  "결산회의",
  "킥오프",
  "워크숍",
];

const KO_LONG: string[] = [
  "프로젝트 일정",
  "분기 매출 정산",
  "고객 응대 가이드",
  "디자인 리뷰",
  "회의실 예약",
  "스프린트 회고",
];

const EN_3_5: string[] = [
  "mail",
  "sync",
  "sale",
  "plan",
  "task",
  "demo",
  "deck",
  "ETA",
  "spec",
  "kpi",
  "team",
  "lead",
  "draft",
  "scope",
  "stand",
  "share",
];

const EN_6_8: string[] = [
  "roadmap",
  "kickoff",
  "agenda",
  "review",
  "deadline",
  "release",
  "metric",
  "feedback",
  "backlog",
  "sprint",
  "rollout",
  "owner",
];

const EN_LONG: string[] = [
  "quarterly review",
  "client meeting",
  "follow up",
  "status report",
  "performance",
  "documentation",
];

function pointsFor(text: string, lang: "ko" | "en"): number {
  const cleaned = text.replace(/\s+/g, "");
  if (lang === "ko") {
    return Math.max(2, cleaned.length * 2);
  }
  return Math.max(2, cleaned.length);
}

export const WORD_POOL: Word[] = [
  ...KO_2.map((t) => ({ text: t, lang: "ko" as const, points: pointsFor(t, "ko") })),
  ...KO_3_4.map((t) => ({ text: t, lang: "ko" as const, points: pointsFor(t, "ko") })),
  ...KO_LONG.map((t) => ({ text: t, lang: "ko" as const, points: pointsFor(t, "ko") })),
  ...EN_3_5.map((t) => ({ text: t, lang: "en" as const, points: pointsFor(t, "en") })),
  ...EN_6_8.map((t) => ({ text: t, lang: "en" as const, points: pointsFor(t, "en") })),
  ...EN_LONG.map((t) => ({ text: t, lang: "en" as const, points: pointsFor(t, "en") })),
];

export function rollWord(exclude: Set<string>): Word | null {
  const candidates = WORD_POOL.filter((w) => !exclude.has(w.text));
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
