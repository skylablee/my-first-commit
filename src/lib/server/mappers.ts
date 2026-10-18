import { platforms, platformCodes } from "../contracts";
import type { Brand, Content } from "../content";
export type BrandRow = {
  id: string;
  brand_name: string;
  industry: string;
  target_customer: string;
  tone: string;
  description: string;
  website: string;
  blog_url: string;
  instagram: string;
  threads: string;
  keywords: string[];
  forbidden_words: string[];
};
export function toBrand(row: BrandRow): Brand {
  return {
    id: row.id,
    name: row.brand_name,
    industry: row.industry,
    audience: row.target_customer,
    voice: row.tone,
    description: row.description,
    website: row.website,
    blog_url: row.blog_url,
    instagram: row.instagram,
    threads: row.threads,
    keywords: row.keywords,
    forbidden_words: row.forbidden_words,
  };
}
export type ContentRow = {
  id: string;
  brand_id: string;
  title: string;
  body: string;
  platform: string;
  status: string;
  source_type: string;
  source_url: string | null;
  scheduled_at: string | null;
  created_at: string;
};
export function toContent(row: ContentRow): Content {
  return {
    id: row.id,
    brand_id: row.brand_id,
    title: row.title,
    body: row.body,
    channel:
      platforms[
        platformCodes.indexOf(row.platform as (typeof platformCodes)[number])
      ] ?? "인스타그램",
    status:
      row.status === "published"
        ? "발행됨"
        : row.status === "scheduled"
          ? "예약됨"
          : "초안",
    date: (row.scheduled_at ?? row.created_at).slice(0, 10),
    created_at: row.created_at,
    source_type: row.source_type as Content["source_type"],
    source_url: row.source_url,
  };
}
