import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { articleUrl, readingTime } from "@/lib/blog";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BlogArticle } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog emploi, CV et candidatures",
  description:
    "Conseils pratiques pour trouver plus d'offres pertinentes, optimiser son CV et écrire des lettres de motivation qui convertissent.",
};

async function getArticles(): Promise<BlogArticle[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("blog_articles")
    .select("*")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false });
  return (data as BlogArticle[]) || [];
}

export default async function BlogPage() {
  const articles = await getArticles();

  return (
    <>
      <div className="bg-decor" aria-hidden="true" />
      <div className="page">
        <Header />
      </div>
      <main className="blog-index">
        <section className="blog-index__hero">
          <p className="blog-index__eyebrow">Blog</p>
          <h1>Conseils emploi, CV et candidatures</h1>
          <p>
            Des guides concrets pour passer les filtres recruteurs, cibler les bonnes offres et
            gagner du temps dans vos candidatures.
          </p>
        </section>

        <section className="blog-index__grid" aria-label="Articles">
          {articles.map((article) => (
            <Link href={articleUrl(article)} className="blog-card" key={article.id}>
              {article.cover_image_url && (
                <img src={article.cover_image_url} alt="" className="blog-card__image" />
              )}
              <div className="blog-card__body">
                <p className="blog-card__meta">
                  {readingTime(article.content)} min de lecture
                  {article.published_at &&
                    ` · ${new Date(article.published_at).toLocaleDateString("fr-FR")}`}
                </p>
                <h2>{article.title}</h2>
                {article.excerpt && <p>{article.excerpt}</p>}
              </div>
            </Link>
          ))}
        </section>

        {articles.length === 0 && (
          <p className="blog-index__empty">Aucun article publié pour le moment.</p>
        )}
      </main>
      <Footer />
    </>
  );
}
