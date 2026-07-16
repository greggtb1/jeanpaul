-- Blog CMS simple : articles publics + images de couverture.

CREATE TABLE IF NOT EXISTS blog_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  excerpt text,
  content text NOT NULL DEFAULT '',
  cover_image_url text,
  cover_image_path text,
  meta_title text,
  meta_description text,
  keywords text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blog_articles_status_published_idx
  ON blog_articles (status, published_at DESC);

ALTER TABLE blog_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published blog articles" ON blog_articles;
CREATE POLICY "Public can read published blog articles"
  ON blog_articles
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published' AND published_at IS NOT NULL);

INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-covers', 'blog-covers', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public can read blog covers" ON storage.objects;
CREATE POLICY "Public can read blog covers"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'blog-covers');
