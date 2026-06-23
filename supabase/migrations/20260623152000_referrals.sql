-- Parrainage / ambassadeurs : code utilisateur + ventes attribuées.

CREATE TABLE IF NOT EXISTS referral_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  code              text NOT NULL UNIQUE,
  discount_percent  integer NOT NULL DEFAULT 15,
  commission_rate   numeric(5,4) NOT NULL DEFAULT 0.3500,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_format CHECK (code ~ '^[A-Z0-9_-]{3,24}$'),
  CONSTRAINT referral_codes_discount_check CHECK (discount_percent BETWEEN 1 AND 90),
  CONSTRAINT referral_codes_commission_check CHECK (commission_rate > 0 AND commission_rate < 1)
);

CREATE TABLE IF NOT EXISTS referral_conversions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id            uuid NOT NULL REFERENCES referral_codes(id) ON DELETE CASCADE,
  referrer_user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_user_id            uuid REFERENCES profiles(id) ON DELETE SET NULL,
  referred_email              text,
  stripe_customer_id          text,
  stripe_subscription_id      text,
  stripe_checkout_session_id  text UNIQUE,
  stripe_invoice_id           text UNIQUE,
  plan_id                     text,
  billing_interval            text,
  amount_paid_cents           integer NOT NULL DEFAULT 0,
  commission_cents            integer NOT NULL DEFAULT 0,
  commission_rate             numeric(5,4) NOT NULL DEFAULT 0.3500,
  status                      text NOT NULL DEFAULT 'earned',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  paid_at                     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_codes_select_own" ON referral_codes;
DROP POLICY IF EXISTS "referral_codes_insert_own" ON referral_codes;
DROP POLICY IF EXISTS "referral_codes_update_own" ON referral_codes;
DROP POLICY IF EXISTS "referral_conversions_select_referrer" ON referral_conversions;

CREATE POLICY "referral_codes_select_own" ON referral_codes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "referral_codes_insert_own" ON referral_codes
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "referral_codes_update_own" ON referral_codes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "referral_conversions_select_referrer" ON referral_conversions
  FOR SELECT TO authenticated
  USING (referrer_user_id = auth.uid());

