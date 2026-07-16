import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { readingTime } from "@/lib/blog";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BlogArticle } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

async function getArticle(slug: string): Promise<BlogArticle | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("blog_articles")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .not("published_at", "is", null)
    .maybeSingle();
  return (data as BlogArticle | null) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) return {};

  const title = article.meta_title || article.title;
  const description = article.meta_description || article.excerpt || undefined;

  return {
    title,
    description,
    keywords: article.keywords || undefined,
    openGraph: {
      type: "article",
      title,
      description,
      images: article.cover_image_url ? [{ url: article.cover_image_url }] : undefined,
      publishedTime: article.published_at || undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: article.cover_image_url ? [article.cover_image_url] : undefined,
    },
  };
}

function renderContent(content: string) {
  const blocks = content.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    if (block.startsWith("### ")) {
      return <h3 key={index}>{block.replace(/^###\s+/, "")}</h3>;
    }
    if (block.startsWith("## ")) {
      return <h2 key={index}>{block.replace(/^##\s+/, "")}</h2>;
    }
    if (block.startsWith("- ")) {
      const items = block
        .split("\n")
        .map((line) => line.replace(/^-\s+/, "").trim())
        .filter(Boolean);
      return (
        <ul key={index}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    }
    return <p key={index}>{block}</p>;
  });
}

export default async function BlogArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = await getArticle(slug);
  if (!article) notFound();

  const published = article.published_at
    ? new Date(article.published_at).toLocaleDateString("fr-FR")
    : null;

  return (
    <>
      <div className="bg-decor" aria-hidden="true" />
      <div className="page">
        <Header />
      </div>
      <main className="blog-article">
        <article>
          <header className="blog-article__head">
            <p className="blog-index__eyebrow">Guide emploi</p>
            <h1>{article.title}</h1>
            <p className="blog-article__meta">
              {readingTime(article.content)} min de lecture
              {published && ` · ${published}`}
            </p>
            {article.excerpt && <p className="blog-article__excerpt">{article.excerpt}</p>}
            {article.cover_image_url && (
              <img src={article.cover_image_url} alt="" className="blog-article__cover" />
            )}
          </header>
          <div className="blog-article__content">{renderContent(article.content)}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
