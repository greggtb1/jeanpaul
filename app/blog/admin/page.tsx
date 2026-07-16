"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BlogArticle } from "@/lib/supabase";
import { SEO_LIMITS, slugify } from "@/lib/blog";

type ArticleForm = {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image_url: string;
  cover_image_path: string;
  meta_title: string;
  meta_description: string;
  keywords: string;
  status: "draft" | "published";
  published_at?: string | null;
};

const EMPTY: ArticleForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  cover_image_url: "",
  cover_image_path: "",
  meta_title: "",
  meta_description: "",
  keywords: "",
  status: "draft",
};

function toForm(article: BlogArticle): ArticleForm {
  return {
    id: article.id,
    title: article.title || "",
    slug: article.slug || "",
    excerpt: article.excerpt || "",
    content: article.content || "",
    cover_image_url: article.cover_image_url || "",
    cover_image_path: article.cover_image_path || "",
    meta_title: article.meta_title || article.title || "",
    meta_description: article.meta_description || article.excerpt || "",
    keywords: article.keywords?.join(", ") || "",
    status: article.status || "draft",
    published_at: article.published_at,
  };
}

function SeoCounter({
  value,
  min,
  max,
  label,
}: {
  value: string;
  min: number;
  max: number;
  label: string;
}) {
  const len = value.trim().length;
  const ok = len >= min && len <= max;
  const empty = len === 0;
  return (
    <p className={`blog-admin__counter${ok ? " is-ok" : ""}${empty ? " is-empty" : ""}`}>
      {len} caractères · recommandé : {label}
    </p>
  );
}

export default function BlogAdminPage() {
  const [articles, setArticles] = useState<BlogArticle[]>([]);
  const [form, setForm] = useState<ArticleForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const previewUrl = useMemo(() => (form.slug ? `/blog/${form.slug}` : "/blog"), [form.slug]);

  async function loadArticles() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/blog/articles", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Chargement impossible");
      setArticles(data.articles || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadArticles();
  }, []);

  function set(patch: Partial<ArticleForm>) {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.title !== undefined && !slugTouched && !current.id) {
        next.slug = slugify(patch.title);
      }
      if (patch.title !== undefined && !current.meta_title) {
        next.meta_title = patch.title.slice(0, SEO_LIMITS.title.max);
      }
      if (patch.excerpt !== undefined && !current.meta_description) {
        next.meta_description = patch.excerpt.slice(0, SEO_LIMITS.description.max);
      }
      return next;
    });
  }

  function edit(article: BlogArticle) {
    setForm(toForm(article));
    setSlugTouched(true);
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setForm(EMPTY);
    setSlugTouched(false);
    setNotice("");
  }

  async function uploadCover(file: File) {
    setUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/blog/upload", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload impossible");
      set({ cover_image_url: data.url, cover_image_path: data.path });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function save(status: "draft" | "published" = form.status) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        ...form,
        status,
        slug: slugify(form.slug || form.title),
        keywords: form.keywords,
      };
      const res = await fetch(
        form.id ? `/api/blog/articles/${form.id}` : "/api/blog/articles",
        {
          method: form.id ? "PUT" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sauvegarde impossible");
      setForm(toForm(data.article));
      setSlugTouched(true);
      setNotice(status === "published" ? "Article publié." : "Brouillon sauvegardé.");
      await loadArticles();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(article: BlogArticle) {
    if (!confirm(`Supprimer "${article.title}" ?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/blog/articles/${article.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Suppression impossible");
      if (form.id === article.id) reset();
      await loadArticles();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="blog-admin">
      <div className="blog-admin__shell">
        <header className="blog-admin__top">
          <div>
            <p className="blog-admin__eyebrow">Backoffice blog</p>
            <h1>Articles SEO</h1>
            <p>
              Rédigez, optimisez les balises, ajoutez une image de couverture et publiez.
            </p>
          </div>
          <div className="blog-admin__top-actions">
            <Link href="/blog" className="btn btn--outline btn--sm">
              Voir le blog
            </Link>
            <button type="button" className="btn btn--navy btn--sm" onClick={reset}>
              Nouvel article
            </button>
          </div>
        </header>

        {error && (
          <div className="blog-admin__alert blog-admin__alert--error">
            {error}
            {error.includes("Non authentifié") && (
              <Link href="/login" className="blog-admin__alert-link">
                Se connecter
              </Link>
            )}
          </div>
        )}
        {notice && <div className="blog-admin__alert">{notice}</div>}

        <section className="blog-admin__grid">
          <form
            className="blog-admin__form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(form.status);
            }}
          >
            <div className="blog-admin__section-head">
              <h2>{form.id ? "Modifier l'article" : "Nouvel article"}</h2>
              <span className={`blog-admin__status is-${form.status}`}>
                {form.status === "published" ? "Publié" : "Brouillon"}
              </span>
            </div>

            <label className="blog-admin__field">
              <span>Titre de l&apos;article</span>
              <input
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="Ex. Comment décrocher plus d'entretiens avec un CV ciblé"
                required
              />
            </label>

            <label className="blog-admin__field">
              <span>Slug URL</span>
              <input
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set({ slug: slugify(e.target.value) });
                }}
                placeholder="comment-decrocher-plus-entretiens"
                required
              />
              <SeoCounter value={form.slug} {...SEO_LIMITS.slug} />
            </label>

            <label className="blog-admin__field">
              <span>Résumé / chapô</span>
              <textarea
                rows={3}
                value={form.excerpt}
                onChange={(e) => set({ excerpt: e.target.value })}
                placeholder="Le résumé affiché sur la page blog et utile pour donner envie de cliquer."
              />
              <SeoCounter value={form.excerpt} {...SEO_LIMITS.excerpt} />
            </label>

            <div className="blog-admin__field">
              <span>Image de couverture</span>
              <div className="blog-admin__cover-row">
                <label className="blog-admin__upload">
                  {uploading ? "Upload…" : "Choisir une image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadCover(file);
                    }}
                  />
                </label>
                <input
                  value={form.cover_image_url}
                  onChange={(e) => set({ cover_image_url: e.target.value })}
                  placeholder="Ou URL de couverture"
                />
              </div>
              {form.cover_image_url && (
                <img
                  className="blog-admin__cover-preview"
                  src={form.cover_image_url}
                  alt="Aperçu couverture"
                />
              )}
            </div>

            <label className="blog-admin__field">
              <span>Contenu</span>
              <textarea
                className="blog-admin__content"
                rows={15}
                value={form.content}
                onChange={(e) => set({ content: e.target.value })}
                placeholder={"Intro...\n\n## Sous-titre\n\nVotre paragraphe..."}
              />
              <p className="blog-admin__counter">
                {form.content.trim().split(/\s+/).filter(Boolean).length} mots · viser 800-1 500 mots
                pour un article SEO solide.
              </p>
            </label>

            <div className="blog-admin__seo">
              <h3>Optimisation SEO</h3>
              <label className="blog-admin__field">
                <span>Meta title</span>
                <input
                  value={form.meta_title}
                  onChange={(e) => set({ meta_title: e.target.value })}
                  placeholder="Titre Google"
                />
                <SeoCounter value={form.meta_title} {...SEO_LIMITS.title} />
              </label>
              <label className="blog-admin__field">
                <span>Meta description</span>
                <textarea
                  rows={3}
                  value={form.meta_description}
                  onChange={(e) => set({ meta_description: e.target.value })}
                  placeholder="Description Google qui donne envie de cliquer."
                />
                <SeoCounter value={form.meta_description} {...SEO_LIMITS.description} />
              </label>
              <label className="blog-admin__field">
                <span>Mots-clés (séparés par des virgules)</span>
                <input
                  value={form.keywords}
                  onChange={(e) => set({ keywords: e.target.value })}
                  placeholder="CV personnalisé, lettre de motivation, recherche emploi"
                />
                <p className="blog-admin__counter">3-8 mots-clés principaux recommandés.</p>
              </label>
            </div>

            <div className="blog-admin__actions">
              <button type="submit" className="btn btn--outline" disabled={saving}>
                {saving ? "Sauvegarde…" : "Sauvegarder brouillon"}
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving}
                onClick={() => void save("published")}
              >
                {saving ? "Publication…" : "Publier"}
              </button>
              {form.slug && (
                <Link href={previewUrl} className="blog-admin__preview-link">
                  Voir l&apos;URL
                </Link>
              )}
            </div>
          </form>

          <aside className="blog-admin__list">
            <h2>Articles</h2>
            {loading ? (
              <p className="blog-admin__muted">Chargement…</p>
            ) : articles.length === 0 ? (
              <p className="blog-admin__muted">Aucun article pour l&apos;instant.</p>
            ) : (
              articles.map((article) => (
                <article className="blog-admin__item" key={article.id}>
                  <div>
                    <span className={`blog-admin__status is-${article.status}`}>
                      {article.status === "published" ? "Publié" : "Brouillon"}
                    </span>
                    <h3>{article.title}</h3>
                    <p>/{article.slug}</p>
                  </div>
                  <div className="blog-admin__item-actions">
                    <button type="button" onClick={() => edit(article)}>
                      Modifier
                    </button>
                    {article.status === "published" && (
                      <Link href={`/blog/${article.slug}`}>Voir</Link>
                    )}
                    <button type="button" onClick={() => void remove(article)}>
                      Supprimer
                    </button>
                  </div>
                </article>
              ))
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
