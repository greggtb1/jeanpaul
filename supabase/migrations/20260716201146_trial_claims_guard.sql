-- Empreintes opaques utilisées uniquement côté serveur pour limiter un essai
-- découverte par navigateur et les créations anonymes en rafale.
CREATE TABLE IF NOT EXISTS public.trial_claims (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  claim_type text NOT NULL CHECK (claim_type IN ('device', 'network_day')),
  claim_hash text NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_claims_type_hash_key UNIQUE (claim_type, claim_hash)
);

CREATE INDEX IF NOT EXISTS trial_claims_user_id_idx
  ON public.trial_claims (user_id);

CREATE INDEX IF NOT EXISTS trial_claims_created_at_idx
  ON public.trial_claims (created_at DESC);

ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.trial_claims FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.trial_claims_id_seq FROM anon, authenticated;

COMMENT ON TABLE public.trial_claims IS
  'Empreintes HMAC anti-abus des essais découverte, accessibles uniquement au serveur.';
