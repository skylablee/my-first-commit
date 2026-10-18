import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
const url = z
  .union([
    z.literal(""),
    z
      .url()
      .max(2048)
      .refine(
        (value) => /^https?:\/\//.test(value),
        "HTTP(S) URL만 허용됩니다.",
      ),
  ])
  .default("");
export const brandInput = z.object({
  id: z.uuid().optional(),
  name: text(150).min(1),
  industry: text(150),
  audience: text(150),
  voice: text(150),
  description: text(1000),
  website: url,
  blog_url: url,
  instagram: url,
  threads: url,
  keywords: z.array(text(50).min(1)).max(20).default([]),
  forbidden_words: z.array(text(50).min(1)).max(20).default([]),
});
export const platforms = [
  "인스타그램",
  "네이버 블로그",
  "카카오 채널",
  "Threads",
  "인스타그램 캐러셀",
  "숏폼 스크립트",
  "후킹 문구",
  "해시태그",
] as const;
export const platformCodes = [
  "instagram",
  "naver_blog",
  "kakao",
  "threads",
  "carousel",
  "shorts",
  "hooks",
  "hashtags",
] as const;
export const contentInput = z.object({
  id: z.uuid().optional(),
  brand_id: z.uuid(),
  title: text(300).min(1),
  body: text(20000).min(1),
  channel: z.enum(platforms),
  source_type: z.enum(["manual", "news", "repurpose"]).default("manual"),
  source_url: url.nullable().default(null),
});
export const uuid = z.uuid();
export const generationInput = z.object({
  provider: z.enum(["openai", "gemini"]),
  brand_id: z.uuid(),
  topic: text(300).min(1),
  platform: z.enum(platforms),
  tone: text(150).min(1),
  length: z.enum(["짧게", "보통", "길게"]),
  mode: z.enum(["single", "all", ...platformCodes]).default("single"),
  source: text(10000).default(""),
  source_url: url.nullable().default(null),
});
export const generatedSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  hashtags: z.array(z.string().max(80)).max(20),
});
export const bundleSchema = z.object({
  threads: z.array(z.string().max(1500)).length(3),
  instagram: z.string().max(3000),
  carousel: z
    .array(z.object({ title: z.string().max(150), body: z.string().max(1000) }))
    .length(8),
  blog: z.string().max(12000),
  shorts: z.string().max(5000),
  hooks: z.array(z.string().max(300)).length(5),
  hashtags: z.array(z.string().max(80)).length(10),
});
export type Generated = z.infer<typeof generatedSchema>;
export type RepurposeBundle = z.infer<typeof bundleSchema>;
export type GenerationInput = z.infer<typeof generationInput>;
