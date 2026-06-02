export type Word = {
  text: string;
  lang: "ko" | "en";
  points: number;
};

// ===== 한글 =====

// 업무 2글자
const KO_WORK_SHORT: string[] = [
  "회의", "보고", "결재", "검토", "자료", "일정", "발표", "마감", "공유", "확인",
  "수정", "초안", "휴가", "출근", "퇴근", "야근", "기획", "분석", "협업", "조율",
  "승인", "반려", "첨부", "회신", "참조", "발송", "접수", "정산", "견적", "계약",
  "입금", "출금", "매출", "매입", "손익", "예산", "집행", "감사", "점검", "보안",
  "인증", "갱신", "등록", "삭제", "복구", "백업", "배포", "운영", "장애", "교육",
  "채용", "면접", "평가", "성과", "목표", "전략", "실적", "매장", "재고", "발주",
];

// 업무 3~4글자
const KO_WORK_MID: string[] = [
  "보고서", "회의록", "스케줄", "마케팅", "디자인", "데이터", "프로젝트", "클라이언트", "리포트", "런칭일",
  "캠페인", "리뷰콜", "분기말", "결산회의", "킥오프", "워크숍", "기획안", "제안서", "견적서", "계약서",
  "명세서", "사업부", "영업팀", "인사팀", "총무팀", "재무팀", "개발팀", "운영팀", "고객사", "협력사",
  "파트너", "벤더사", "매출액", "영업익", "순이익", "손익분기", "사업계획", "예산안", "결산서", "정산서",
  "세금계산", "부가세", "원천세", "급여명세", "인사평가", "성과급", "상여금", "퇴직금", "연차수당", "야근수당",
  "출장비", "경비처리", "법인카드", "회계감사", "내부통제", "컴플라이언스", "리스크", "포트폴리오", "로드맵", "마일스톤",
  "산출물", "요구사항", "기능명세", "와이어프레임", "프로토타입", "사용성", "접근성", "반응형", "배포일", "릴리즈",
  "핫픽스", "패치노트", "버그리포트", "회귀테스트", "부하테스트", "모니터링", "대시보드", "지표분석", "전환율", "이탈률",
  "체류시간", "유입경로", "광고비", "노출수", "클릭수", "구매전환", "재구매", "고객만족", "응대율", "처리율",
];

// 업무 구절
const KO_WORK_LONG: string[] = [
  "프로젝트 일정", "분기 매출 정산", "고객 응대 가이드", "디자인 리뷰", "회의실 예약",
  "스프린트 회고", "신규 사업 기획", "시장 조사 보고", "경쟁사 분석", "연간 사업 계획",
  "월간 실적 보고", "주간 업무 보고", "예산 집행 내역", "비용 절감 방안", "매출 성장 전략",
  "고객 이탈 분석", "신제품 출시 일정", "브랜드 인지도 조사", "광고 캠페인 기획", "콘텐츠 제작 일정",
  "채용 면접 일정", "신입 사원 교육", "조직 개편 안내", "인사 평가 기준", "성과 보상 체계",
  "복리 후생 제도", "재택 근무 정책", "출장 경비 정산", "계약 갱신 검토", "협력사 미팅",
  "공급망 관리", "재고 실사 일정", "품질 관리 기준", "고객 만족도 조사", "서비스 개선 과제",
  "시스템 점검 일정", "데이터 백업 정책", "보안 취약점 점검", "개인정보 보호", "내부 감사 일정",
  "위기 대응 매뉴얼", "업무 인수 인계", "워크플로 개선", "자동화 도입 검토", "디지털 전환 전략",
  "글로벌 진출 전략", "파트너십 제휴", "투자 유치 계획", "이사회 보고", "주주 총회 준비",
];

// 음식
const KO_FOOD: string[] = [
  "밥", "김치", "라면", "김밥", "떡볶이", "순대", "만두", "비빔밥", "불고기", "갈비",
  "삼겹살", "냉면", "칼국수", "수제비", "짜장면", "짬뽕", "탕수육", "볶음밥", "카레", "돈가스",
  "초밥", "우동", "피자", "파스타", "햄버거", "샌드위치", "토스트", "샐러드", "스테이크", "치킨",
  "족발", "보쌈", "닭갈비", "제육볶음", "김치찌개", "된장찌개", "부대찌개", "순두부", "감자탕", "설렁탕",
  "곰탕", "육개장", "삼계탕", "갈비탕", "미역국", "떡국", "어묵", "빵", "케이크", "쿠키",
  "도넛", "와플", "아이스크림", "초콜릿", "사탕", "젤리", "과자", "팝콘", "커피", "녹차",
  "우유", "주스", "콜라", "사이다", "식혜", "막걸리", "소주", "맥주", "와인", "두부",
  "계란", "소시지", "베이컨", "치즈", "버터", "꿀", "설탕", "소금", "후추", "간장",
  "식초", "참기름", "마늘", "양파", "고추", "생강", "사과", "바나나", "포도", "수박", "복숭아",
];

// 동물
const KO_ANIMAL: string[] = [
  "강아지", "고양이", "사자", "호랑이", "코끼리", "기린", "사슴", "토끼", "거북이", "다람쥐",
  "여우", "늑대", "곰", "판다", "원숭이", "고릴라", "코뿔소", "하마", "얼룩말", "캥거루",
  "코알라", "펭귄", "독수리", "참새", "까치", "비둘기", "부엉이", "올빼미", "앵무새", "공작",
  "타조", "오리", "거위", "닭", "병아리", "돼지", "소", "말", "양", "염소",
  "당나귀", "낙타", "잠자리", "나비", "벌", "개미", "거미", "달팽이", "지렁이", "개구리",
  "두꺼비", "뱀", "도마뱀", "악어", "상어", "고래", "돌고래", "문어", "오징어", "새우",
  "게", "가재", "조개", "해파리", "불가사리", "금붕어", "잉어", "메기", "장어", "수달",
];

// 자연/날씨
const KO_NATURE: string[] = [
  "하늘", "구름", "비", "눈", "바람", "번개", "천둥", "무지개", "햇빛", "달빛",
  "별", "태양", "달", "바다", "강", "호수", "계곡", "폭포", "산", "언덕",
  "들판", "숲", "나무", "꽃", "풀", "잎", "뿌리", "씨앗", "바위", "모래",
  "흙", "이슬", "안개", "서리", "우박", "태풍", "홍수", "가뭄", "지진", "화산",
  "파도", "섬", "사막", "초원", "동굴", "빙하", "온천", "갯벌", "절벽", "시냇물",
];

// 사물/생활용품
const KO_OBJECT: string[] = [
  "책상", "의자", "침대", "소파", "옷장", "책장", "서랍", "거울", "시계", "달력",
  "액자", "화분", "빗자루", "걸레", "수건", "비누", "칫솔", "치약", "샴푸", "컵",
  "접시", "그릇", "숟가락", "젓가락", "포크", "나이프", "냄비", "프라이팬", "주전자", "도마",
  "가위", "망치", "못", "드라이버", "연필", "볼펜", "지우개", "공책", "가방", "지갑",
  "우산", "모자", "안경", "반지", "목걸이", "귀걸이", "벨트", "신발", "양말", "장갑",
  "목도리", "휴대폰", "노트북", "컴퓨터", "키보드", "마우스", "모니터", "프린터", "텔레비전", "냉장고",
  "세탁기", "청소기", "선풍기", "에어컨", "전자레인지", "밥솥", "토스터", "믹서기", "다리미", "전등",
  "콘센트", "배터리", "충전기", "리모컨", "이어폰", "스피커",
];

// 장소
const KO_PLACE: string[] = [
  "집", "학교", "회사", "병원", "약국", "은행", "우체국", "경찰서", "소방서", "도서관",
  "박물관", "미술관", "영화관", "공원", "놀이터", "운동장", "체육관", "수영장", "식당", "카페",
  "편의점", "마트", "시장", "백화점", "서점", "문구점", "빵집", "미용실", "세탁소", "주유소",
  "정류장", "역", "공항", "항구", "터미널", "호텔", "교회", "절", "성당", "공장",
  "농장", "목장", "과수원", "창고", "주차장", "화장실", "엘리베이터", "계단", "복도", "옥상",
];

// 직업
const KO_JOB: string[] = [
  "의사", "간호사", "약사", "교사", "교수", "변호사", "판사", "검사", "경찰", "소방관",
  "군인", "요리사", "제빵사", "농부", "어부", "목수", "화가", "가수", "배우", "감독",
  "작가", "기자", "아나운서", "운동선수", "과학자", "연구원", "엔지니어", "프로그래머", "디자이너", "건축가",
  "회계사", "세무사", "비서", "점원", "택배기사", "운전기사", "미용사", "사진작가", "통역사", "번역가",
];

// 취미/스포츠
const KO_HOBBY: string[] = [
  "축구", "야구", "농구", "배구", "탁구", "테니스", "배드민턴", "골프", "볼링", "당구",
  "수영", "달리기", "등산", "자전거", "스키", "스케이트", "요가", "헬스", "복싱", "태권도",
  "유도", "검도", "낚시", "캠핑", "독서", "그림", "노래", "춤", "피아노", "기타",
  "바이올린", "드럼", "사진", "요리", "뜨개질", "바둑", "장기", "체스",
];

// 신체/건강
const KO_BODY: string[] = [
  "머리", "얼굴", "눈", "코", "입", "귀", "이마", "볼", "턱", "목",
  "어깨", "팔", "팔꿈치", "손", "손목", "손가락", "가슴", "배", "등", "허리",
  "엉덩이", "다리", "무릎", "발", "발목", "발가락", "심장", "폐", "위", "간",
  "뇌", "뼈", "근육", "피부", "혈관",
];

// 감정/성격
const KO_EMOTION: string[] = [
  "기쁨", "슬픔", "분노", "두려움", "놀람", "행복", "사랑", "미움", "질투", "부러움",
  "설렘", "그리움", "외로움", "후회", "감사", "용기", "자신감", "긍정", "친절", "성실",
  "정직", "겸손", "오만", "용감", "소심", "활발", "차분", "냉정", "열정", "끈기",
  "인내", "배려", "욕심", "희망",
];

// 색/모양
const KO_SHAPE: string[] = [
  "빨강", "주황", "노랑", "초록", "파랑", "남색", "보라", "분홍", "갈색", "회색",
  "검정", "하양", "동그라미", "세모", "네모", "별모양", "하트", "마름모", "타원", "육각형",
  "곡선", "직선", "줄무늬", "물방울",
];

// 시간/계절
const KO_TIME: string[] = [
  "봄", "여름", "가을", "겨울", "아침", "점심", "저녁", "밤", "새벽", "오전",
  "오후", "어제", "오늘", "내일", "주말", "평일", "월요일", "화요일", "수요일", "목요일",
  "금요일", "토요일", "일요일", "휴일", "연휴",
];

// ===== 영어 =====

// 짧은 업무어
const EN_WORK_SHORT: string[] = [
  "mail", "sync", "sale", "plan", "task", "demo", "deck", "ETA", "spec", "kpi",
  "team", "lead", "draft", "scope", "stand", "share", "goal", "risk", "scrum", "agile",
  "audit", "churn", "yield", "quota", "brief", "pivot", "scale", "lean", "stack", "merge",
];

// 중간 업무어
const EN_WORK_MID: string[] = [
  "roadmap", "kickoff", "agenda", "review", "deadline", "release", "metric", "feedback", "backlog", "sprint",
  "rollout", "vendor", "budget", "revenue", "invoice", "proposal", "contract", "estimate", "forecast", "pipeline",
  "workflow", "campaign", "analysis", "insight", "segment", "funnel", "traffic", "outreach", "renewal", "staffing",
  "payroll", "overtime", "appraisal", "headcount", "turnover", "synergy", "leverage", "baseline", "variance", "markup",
  "margin", "overhead", "logistics", "inventory", "shipment", "supplier", "quality", "cadence", "handoff", "retro",
];

// 고급 비즈니스/전문어 (난이도 상)
const EN_ADVANCED: string[] = [
  "stakeholder", "prioritization", "deliverable", "contingency", "optimization", "scalability", "infrastructure", "accountability", "methodology", "implementation",
  "collaboration", "negotiation", "procurement", "reconciliation", "amortization", "depreciation", "diversification", "consolidation", "differentiation", "segmentation",
  "personalization", "authentication", "authorization", "integration", "migration", "deployment", "provisioning", "orchestration", "virtualization", "containerization",
  "benchmarking", "forecasting", "budgeting", "onboarding", "offboarding", "restructuring", "downsizing", "outsourcing", "nearshoring", "compliance",
  "governance", "escalation", "remediation", "mitigation", "dependency", "requirement", "specification", "documentation", "visualization", "automation",
  "digitization", "transformation", "acquisition", "partnership", "sponsorship", "subscription", "retention", "engagement", "attribution", "conversion",
  "monetization", "profitability", "sustainability", "productivity", "efficiency", "capability", "competency", "initiative", "milestone", "framework",
];

// 업무 구절
const EN_WORK_LONG: string[] = [
  "quarterly review", "client meeting", "follow up", "status report", "executive summary",
  "business case", "market analysis", "competitive analysis", "revenue forecast", "profit margin",
  "cost reduction", "go to market", "value proposition", "customer journey", "user research",
  "product launch", "feature request", "technical debt", "code review", "release notes",
  "sprint planning", "retrospective meeting", "performance review", "talent acquisition", "employee engagement",
  "succession planning", "change management", "risk assessment", "due diligence", "return on investment",
  "key performance indicator", "service level agreement", "scope of work", "statement of work", "request for proposal",
  "proof of concept", "minimum viable product", "total cost of ownership", "customer lifetime value", "monthly recurring revenue",
  "annual recurring revenue", "gross profit margin", "operating expenses", "capital expenditure", "supply chain",
  "vendor management", "quality assurance", "continuous integration", "disaster recovery", "data governance",
];

// 음식
const EN_FOOD: string[] = [
  "rice", "kimchi", "ramen", "noodle", "dumpling", "pizza", "pasta", "burger", "sandwich", "toast",
  "salad", "steak", "chicken", "soup", "stew", "bread", "cake", "cookie", "donut", "waffle",
  "pancake", "chocolate", "candy", "jelly", "snack", "popcorn", "coffee", "tea", "milk", "juice",
  "cola", "soda", "tofu", "egg", "ham", "sausage", "bacon", "cheese", "butter", "jam",
  "honey", "sugar", "salt", "pepper", "sauce", "vinegar", "garlic", "onion", "ginger", "apple",
  "banana", "orange", "grape", "melon", "peach", "cherry", "lemon", "mango", "kiwi", "berry",
  "tomato", "potato", "carrot", "cabbage", "spinach", "cucumber", "pumpkin", "mushroom", "beef", "pork",
  "fish", "shrimp", "crab", "tuna", "salmon", "yogurt", "cereal", "pickle",
];

// 동물
const EN_ANIMAL: string[] = [
  "dog", "cat", "lion", "tiger", "elephant", "giraffe", "deer", "rabbit", "turtle", "squirrel",
  "fox", "wolf", "bear", "panda", "monkey", "gorilla", "rhino", "hippo", "zebra", "kangaroo",
  "koala", "penguin", "eagle", "sparrow", "magpie", "pigeon", "owl", "parrot", "peacock", "ostrich",
  "duck", "goose", "hen", "chick", "pig", "cow", "horse", "sheep", "goat", "donkey",
  "camel", "beetle", "dragonfly", "butterfly", "bee", "ant", "spider", "snail", "worm", "frog",
  "toad", "snake", "lizard", "crocodile", "shark", "whale", "dolphin", "octopus", "squid", "jellyfish",
  "starfish", "goldfish", "carp", "catfish", "eel", "otter",
];

// 자연/날씨
const EN_NATURE: string[] = [
  "sky", "cloud", "rain", "snow", "wind", "lightning", "thunder", "rainbow", "sunshine", "moonlight",
  "star", "sun", "moon", "sea", "river", "lake", "valley", "waterfall", "mountain", "hill",
  "field", "forest", "tree", "flower", "grass", "leaf", "root", "seed", "rock", "sand",
  "soil", "dew", "fog", "frost", "hail", "storm", "flood", "drought", "earthquake", "volcano",
  "wave", "island", "desert", "prairie", "cave", "glacier", "beach", "cliff", "stream", "pond",
];

// 사물/생활용품
const EN_OBJECT: string[] = [
  "desk", "chair", "bed", "sofa", "closet", "shelf", "drawer", "mirror", "clock", "calendar",
  "frame", "vase", "broom", "towel", "soap", "toothbrush", "toothpaste", "shampoo", "cup", "plate",
  "bowl", "spoon", "chopstick", "fork", "knife", "pot", "pan", "kettle", "scissors", "hammer",
  "nail", "screwdriver", "ruler", "pencil", "pen", "eraser", "notebook", "bag", "wallet", "umbrella",
  "hat", "glasses", "ring", "necklace", "belt", "shoe", "sock", "glove", "scarf", "phone",
  "laptop", "computer", "keyboard", "mouse", "monitor", "printer", "television", "fridge", "washer", "vacuum",
  "fan", "heater", "microwave", "toaster", "blender", "iron", "lamp", "battery", "charger", "remote",
  "earphone", "speaker",
];

// 장소
const EN_PLACE: string[] = [
  "home", "school", "office", "hospital", "pharmacy", "bank", "library", "museum", "gallery", "cinema",
  "park", "playground", "stadium", "gym", "pool", "restaurant", "cafe", "store", "market", "mall",
  "bookstore", "bakery", "salon", "laundry", "station", "airport", "harbor", "terminal", "hotel", "church",
  "temple", "factory", "farm", "ranch", "warehouse", "garage", "toilet", "elevator", "stairs", "hallway",
];

// 직업
const EN_JOB: string[] = [
  "doctor", "nurse", "pharmacist", "teacher", "professor", "lawyer", "judge", "police", "firefighter", "soldier",
  "chef", "baker", "farmer", "fisherman", "carpenter", "painter", "singer", "actor", "director", "writer",
  "reporter", "announcer", "athlete", "scientist", "researcher", "engineer", "programmer", "designer", "architect", "accountant",
  "secretary", "clerk", "driver", "florist", "photographer", "interpreter", "translator",
];

// 취미/스포츠
const EN_HOBBY: string[] = [
  "soccer", "baseball", "basketball", "volleyball", "tennis", "badminton", "golf", "bowling", "billiards", "swimming",
  "running", "hiking", "cycling", "skiing", "skating", "yoga", "boxing", "judo", "fishing", "camping",
  "reading", "drawing", "singing", "dancing", "piano", "guitar", "violin", "drums", "photography", "cooking",
  "knitting", "chess",
];

// 신체/건강
const EN_BODY: string[] = [
  "head", "face", "eye", "nose", "mouth", "ear", "forehead", "cheek", "chin", "neck",
  "shoulder", "arm", "elbow", "hand", "wrist", "finger", "chest", "belly", "back", "waist",
  "hip", "leg", "knee", "foot", "ankle", "toe", "heart", "lung", "stomach", "liver",
  "brain", "bone", "muscle", "skin", "vein",
];

// 감정/성격
const EN_EMOTION: string[] = [
  "joy", "sadness", "anger", "fear", "surprise", "happiness", "love", "hate", "jealousy", "envy",
  "excitement", "loneliness", "regret", "gratitude", "courage", "confidence", "kindness", "honesty", "humility", "passion",
  "patience", "hope", "pride", "shame", "calm", "curiosity",
];

// 색/모양
const EN_SHAPE: string[] = [
  "red", "orange", "yellow", "green", "blue", "indigo", "purple", "pink", "brown", "gray",
  "black", "white", "circle", "triangle", "square", "heart", "diamond", "oval", "hexagon", "curve",
  "line", "dot", "stripe",
];

// 시간/계절
const EN_TIME: string[] = [
  "spring", "summer", "autumn", "winter", "morning", "noon", "evening", "night", "dawn", "today",
  "tomorrow", "yesterday", "weekend", "weekday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  "sunday", "holiday",
];

function pointsFor(text: string, lang: "ko" | "en"): number {
  const cleaned = text.replace(/\s+/g, "");
  if (lang === "ko") {
    return Math.max(2, cleaned.length * 2);
  }
  // 영어는 난이도가 높으므로 글자당 가중치를 1.5배로 상향
  return Math.max(2, Math.round(cleaned.length * 1.5));
}

// 모든 카테고리를 합치되, text 기준으로 중복을 자동 제거
const KO_GROUPS: string[][] = [
  KO_WORK_SHORT, KO_WORK_MID, KO_WORK_LONG, KO_FOOD, KO_ANIMAL, KO_NATURE,
  KO_OBJECT, KO_PLACE, KO_JOB, KO_HOBBY, KO_BODY, KO_EMOTION, KO_SHAPE, KO_TIME,
];

const EN_GROUPS: string[][] = [
  EN_WORK_SHORT, EN_WORK_MID, EN_ADVANCED, EN_WORK_LONG, EN_FOOD, EN_ANIMAL, EN_NATURE,
  EN_OBJECT, EN_PLACE, EN_JOB, EN_HOBBY, EN_BODY, EN_EMOTION, EN_SHAPE, EN_TIME,
];

export const WORD_POOL: Word[] = (() => {
  const seen = new Set<string>();
  const pool: Word[] = [];
  const add = (lists: string[][], lang: "ko" | "en") => {
    for (const list of lists) {
      for (const text of list) {
        if (seen.has(text)) continue;
        seen.add(text);
        pool.push({ text, lang, points: pointsFor(text, lang) });
      }
    }
  };
  add(KO_GROUPS, "ko");
  add(EN_GROUPS, "en");
  return pool;
})();

export function rollWord(
  exclude: Set<string>,
  conflictCheck?: (text: string) => boolean,
): Word | null {
  const candidates = WORD_POOL.filter(
    (w) => !exclude.has(w.text) && !conflictCheck?.(w.text),
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
