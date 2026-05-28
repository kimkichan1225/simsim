export type Phrase = {
  text: string;
  lang: "ko" | "en";
};

const KO_OFFICE: string[] = [
  "회의 일정 확정해주세요.",
  "분기 보고서 첨부드립니다.",
  "내일 오전까지 검토 부탁드려요.",
  "관련 자료 공유드립니다.",
  "확인 후 회신 부탁드립니다.",
  "수정 사항 반영 완료했습니다.",
  "다음 주 일정 조율이 필요합니다.",
  "회의실 예약 부탁드려요.",
  "고객 피드백 정리 중입니다.",
  "이슈 트래킹 시트 업데이트했습니다.",
  "결재 라인 확인 부탁드립니다.",
  "프로젝트 진행 상황 공유드립니다.",
  "월간 매출 자료 정리했습니다.",
  "마감 일정에 맞춰 진행하겠습니다.",
  "회신이 늦어 죄송합니다.",
  "추가 자료가 필요하면 알려주세요.",
  "이번 주 안에 마무리 하겠습니다.",
  "관련 부서와 협의 후 회신드릴게요.",
  "보고서 초안을 준비 중입니다.",
  "비용 항목 다시 한 번 확인 부탁드립니다.",
];

const EN_OFFICE: string[] = [
  "Please confirm the meeting schedule.",
  "Attached is the quarterly report.",
  "Could you review by tomorrow morning?",
  "Sharing the related documents.",
  "Please reply after checking.",
  "The revisions have been applied.",
  "We need to align next week's schedule.",
  "Please book a meeting room.",
  "Compiling customer feedback now.",
  "Issue tracker has been updated.",
  "Please verify the approval chain.",
  "Sharing the project status update.",
  "Monthly revenue data is ready.",
  "We will keep to the deadline.",
  "Apologies for the late reply.",
  "Let me know if more data is needed.",
  "We aim to wrap up this week.",
  "Will sync with the relevant team and reply.",
  "Working on the initial draft.",
  "Please double-check the cost line.",
];

const KO_PHRASES: string[] = [
  ...KO_OFFICE,
  "오늘은 평소보다 조용하네요.",
  "잠시 환기 좀 하고 올게요.",
  "커피 한 잔 마시고 다시 시작하겠습니다.",
  "이거 하고 나면 점심이에요.",
  "조금만 더 집중하면 끝납니다.",
  "이번 분기는 빠르게 지나갔네요.",
  "회의 끝나고 잠깐 얘기 좀 해요.",
  "단축키 정리한 메모 공유해드릴게요.",
];

const EN_PHRASES: string[] = [
  ...EN_OFFICE,
  "Quiet morning today.",
  "Stepping out for a quick break.",
  "Grabbing a coffee, back in a bit.",
  "Almost done before lunch.",
  "One more push and we are good.",
  "This quarter flew by.",
  "Let's chat after the meeting.",
  "Sharing my shortcuts memo with you.",
];

const ALL: Phrase[] = [
  ...KO_PHRASES.map((text) => ({ text, lang: "ko" as const })),
  ...EN_PHRASES.map((text) => ({ text, lang: "en" as const })),
];

export function pickPhrase(prev?: Phrase): Phrase {
  if (ALL.length === 0) throw new Error("empty phrase pool");
  for (let i = 0; i < 8; i++) {
    const next = ALL[Math.floor(Math.random() * ALL.length)];
    if (!prev || next.text !== prev.text) return next;
  }
  return ALL[Math.floor(Math.random() * ALL.length)];
}

export function pickPhrases(count: number): Phrase[] {
  const out: Phrase[] = [];
  let prev: Phrase | undefined;
  for (let i = 0; i < count; i++) {
    const next = pickPhrase(prev);
    out.push(next);
    prev = next;
  }
  return out;
}
