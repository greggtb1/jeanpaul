-- Tables cœur aiapply + RLS restrictive (colonnes billing / flags protégées côté client)

-- ── profiles ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id                      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name               text,
  email                   text,
  phone                   text,
  location                text,
  target_roles            text[],
  target_locations        text[],
  contract_type           text[],
  remote_pref             text[],
  salary_min              integer,
  cv_url                  text,
  cv_filename             text,
  cv_path                 text,
  summary                 text,
  letter_tone             text,
  letter_sample           text,
  onboarding_done         boolean NOT NULL DEFAULT false,
  first_search_done       boolean NOT NULL DEFAULT false,
  subscription_status     text NOT NULL DEFAULT 'none',
  stripe_customer_id      text,
  stripe_subscription_id  text,
  plan_id                 text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can read all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can insert their profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their profile" ON profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    current_setting('request.jwt.claim.role', true),
    (auth.jwt() ->> 'role')
  ) = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.profiles_guard_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.subscription_status := 'none';
    NEW.stripe_customer_id := NULL;
    NEW.stripe_subscription_id := NULL;
    NEW.plan_id := COALESCE(NEW.plan_id, 'chill');
    NEW.onboarding_done := false;
    NEW.first_search_done := false;
    RETURN NEW;
  END IF;

  NEW.subscription_status := OLD.subscription_status;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.plan_id := OLD.plan_id;
  NEW.onboarding_done := OLD.onboarding_done;
  NEW.first_search_done := OLD.first_search_done;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_sensitive_columns ON profiles;
CREATE TRIGGER profiles_guard_sensitive_columns
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_guard_sensitive_columns();

-- ── jobs ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url         text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  fit_score   integer,
  applied     boolean NOT NULL DEFAULT false,
  deleted     boolean NOT NULL DEFAULT false,
  cv_url      text,
  letter_url  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, url)
);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jobs_select_own" ON jobs;
DROP POLICY IF EXISTS "jobs_update_applied" ON jobs;

CREATE POLICY "jobs_select_own" ON jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "jobs_update_applied" ON jobs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.jobs_guard_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'jobs insert requires service role';
  END IF;

  NEW.user_id := OLD.user_id;
  NEW.url := OLD.url;
  NEW.data := OLD.data;
  NEW.fit_score := OLD.fit_score;
  NEW.deleted := OLD.deleted;
  NEW.cv_url := OLD.cv_url;
  NEW.letter_url := OLD.letter_url;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_guard_columns ON jobs;
CREATE TRIGGER jobs_guard_columns
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.jobs_guard_columns();

-- ── pipeline_runs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  log         text NOT NULL DEFAULT '',
  progress    integer NOT NULL DEFAULT 0,
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_runs_select_own" ON pipeline_runs;
DROP POLICY IF EXISTS "pipeline_runs_insert_own" ON pipeline_runs;

CREATE POLICY "pipeline_runs_select_own" ON pipeline_runs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "pipeline_runs_insert_own" ON pipeline_runs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── app_state ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_state (
  id       text PRIMARY KEY,
  user_id  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  data     jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_state_select_own" ON app_state;
DROP POLICY IF EXISTS "app_state_insert_own" ON app_state;
DROP POLICY IF EXISTS "app_state_update_own" ON app_state;
DROP POLICY IF EXISTS "app_state_delete_own" ON app_state;

CREATE POLICY "app_state_select_own" ON app_state
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR id = 'autoapply_selection:' || auth.uid()::text
    OR id LIKE 'pipeline_pid:%' AND EXISTS (
      SELECT 1 FROM pipeline_runs r
      WHERE r.user_id = auth.uid()
        AND r.id = substring(app_state.id from 14)::uuid
    )
    OR id LIKE 'pipeline_cancel:%' AND EXISTS (
      SELECT 1 FROM pipeline_runs r
      WHERE r.user_id = auth.uid()
        AND r.id = substring(app_state.id from 17)::uuid
    )
  );

CREATE POLICY "app_state_insert_own" ON app_state
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      id = 'autoapply_selection:' || auth.uid()::text
      OR (
        id LIKE 'pipeline_pid:%'
        AND EXISTS (
          SELECT 1 FROM pipeline_runs r
          WHERE r.user_id = auth.uid()
            AND r.id = substring(app_state.id from 14)::uuid
        )
      )
    )
  );

CREATE POLICY "app_state_update_own" ON app_state
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "app_state_delete_own" ON app_state
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR id LIKE 'pipeline_cancel:%' AND EXISTS (
      SELECT 1 FROM pipeline_runs r
      WHERE r.user_id = auth.uid()
        AND r.id = substring(app_state.id from 17)::uuid
    )
  );

-- ── seen_urls (moteur) ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS seen_urls (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key     text NOT NULL,
  PRIMARY KEY (user_id, key)
);

ALTER TABLE seen_urls ENABLE ROW LEVEL SECURITY;

-- Pas d'accès client : moteur (service role) uniquement

-- ── Storage bucket cvs ───────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('cvs', 'cvs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "cvs_select_own" ON storage.objects;
DROP POLICY IF EXISTS "cvs_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "cvs_update_own" ON storage.objects;
DROP POLICY IF EXISTS "cvs_delete_own" ON storage.objects;

CREATE POLICY "cvs_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cvs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "cvs_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cvs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "cvs_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cvs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'cvs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "cvs_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cvs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
