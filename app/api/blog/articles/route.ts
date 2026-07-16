import { NextResponse } from "next/server";
import { normalizeKeywords, slugify } from "@/lib/blog";
import { requireBlogAdmin } from "@/lib/blog-admin";

type BlogBody = {
  title?: string;
  slug?: string;
  excerpt?: string;
  content?: string;
  cover_image_url?: string;
  cover_image_path?: string;
  meta_title?: string;
  meta_description?: string;
  keywords?: string[] | string;
  status?: "draft" | "published";
};

function articlePayload(body: BlogBody, authorId: string) {
  const title = (body.title || "").trim();
  const slug = slugify(body.slug || title);
  const status = body.status === "published" ? "published" : "draft";

  if (!title) throw new Error("Titre requis");
  if (!slug) throw new Error("Slug requis");

  return {
    author_id: authorId,
    title,
    slug,
    excerpt: body.excerpt?.trim() || null,
    content: body.content?.trim() || "",
    cover_image_url: body.cover_image_url?.trim() || null,
    cover_image_path: body.cover_image_path?.trim() || null,
    meta_title: body.meta_title?.trim() || title,
    meta_description: body.meta_description?.trim() || body.excerpt?.trim() || null,
    keywords: normalizeKeywords(body.keywords),
    status,
    published_at: status === "published" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

export async function GET() {
  const gate = await requireBlogAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { data, error } = await gate.admin
    .from("blog_articles")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ articles: data ?? [] });
}

export async function POST(req: Request) {
  const gate = await requireBlogAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  try {
    const body = (await req.json()) as BlogBody;
    const payload = articlePayload(body, gate.user.id);
    const { data, error } = await gate.admin
      .from("blog_articles")
      .insert(payload)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ article: data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
