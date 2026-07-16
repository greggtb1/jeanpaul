import type { BlogArticle } from "@/lib/supabase";

export const SEO_LIMITS = {
  title: { min: 45, max: 60, label: "45-60 caractères" },
  description: { min: 120, max: 155, label: "120-155 caractères" },
  excerpt: { min: 90, max: 160, label: "90-160 caractères" },
  slug: { min: 3, max: 75, label: "3-75 caractères" },
} as const;

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SEO_LIMITS.slug.max);
}

export function readingTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function articleUrl(article: Pick<BlogArticle, "slug">): string {
  return `/blog/${article.slug}`;
}

export function normalizeKeywords(value: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 12);
}
