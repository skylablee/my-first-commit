export type Content = {
  brand_id?: string;
  created_at?: string;
  source_type?: "manual" | "news" | "repurpose";
  source_url?: string | null;
  id: string;
  title: string;
  channel: string;
  status: "초안" | "예약됨" | "발행됨";
  date: string;
  body: string;
};
export type Brand = {
  active?: boolean;
  id?: string;
  website?: string;
  blog_url?: string;
  instagram?: string;
  threads?: string;
  keywords?: string[];
  forbidden_words?: string[];
  name: string;
  industry: string;
  audience: string;
  voice: string;
  description: string;
};
export const defaultBrand: Brand = {
  name: "오후의 커피",
  industry: "카페 · 디저트",
  audience: "동네 직장인, 커피를 좋아하는 20~40대",
  voice: "따뜻하고 친근한",
  description:
    "매일 직접 굽는 디저트와 정성껏 내리는 스페셜티 커피를 만나는 동네 카페",
};
export const initialContent: Content[] = [
  {
    id: "1",
    title: "오늘도 잠깐, 커피 한 잔의 여유",
    channel: "인스타그램",
    status: "초안",
    date: "2026-10-17",
    body: "바쁜 하루에도 나를 위한 작은 쉼표가 필요하죠. 오후의 커피에서 따뜻한 라테 한 잔과 쉬어 가세요. ☕",
  },
  {
    id: "2",
    title: "가을 한정! 밤 크림 라테를 소개해요",
    channel: "네이버 블로그",
    status: "예약됨",
    date: "2026-10-20",
    body: "고소한 밤과 부드러운 크림이 만났어요. 오후의 커피에서 가을의 맛을 만나보세요.",
  },
  {
    id: "3",
    title: "우리 동네 단골이 추천하는 디저트",
    channel: "인스타그램",
    status: "발행됨",
    date: "2026-10-15",
    body: "매일 아침 구워내는 스콘, 오늘도 준비됐어요. 단골 여러분의 사랑에 감사드립니다.",
  },
  {
    id: "4",
    title: "갓 구운 스콘과 시작하는 아침",
    channel: "카카오 채널",
    status: "초안",
    date: "2026-10-18",
    body: "따뜻한 스콘과 아메리카노로 기분 좋은 하루를 시작해 보세요.",
  },
];
export function generateMockContent(
  brand: Brand,
  topic: string,
  channel: string,
) {
  const subject = topic.trim();
  if (!subject || subject.length > 300)
    throw new Error("주제를 1~300자로 입력해 주세요.");
  return `[${channel} · ${brand.name}]\n\n${subject}\n\n${brand.audience} 여러분, 오늘은 ${brand.name}에서 작은 즐거움을 만나보세요. ${brand.description}.\n\n${brand.voice} 마음을 담아 기다릴게요. 방문 전 영업시간을 확인해 주세요.\n\n#${brand.name.replace(/\s/g, "")} #동네가게 #일상의즐거움\n\n※ 데모 템플릿입니다. 게시 전에 사실관계와 표현을 확인해 주세요.`;
}

export const emptyBrand: Brand = {
  name: "",
  industry: "",
  audience: "",
  voice: "따뜻하고 친근한",
  description: "",
  website: "",
  blog_url: "",
  instagram: "",
  threads: "",
  keywords: [],
  forbidden_words: [],
};
