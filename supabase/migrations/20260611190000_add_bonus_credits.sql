-- Crédits de candidatures supplémentaires (achat one-shot depuis Facturation).
-- bonus_credits = solde restant, décrémenté quand un scan financé par crédits démarre.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bonus_credits integer NOT NULL DEFAULT 0;

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
    NEW.bonus_credits := 0;
    RETURN NEW;
  END IF;

  NEW.subscription_status := OLD.subscription_status;
  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.plan_id := OLD.plan_id;
  NEW.onboarding_done := OLD.onboarding_done;
  NEW.first_search_done := OLD.first_search_done;
  NEW.bonus_credits := OLD.bonus_credits;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_bonus_credits(p_user_id uuid, p_credits integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE public.profiles
  SET bonus_credits = bonus_credits + GREATEST(p_credits, 0),
      updated_at = now()
  WHERE id = p_user_id
  RETURNING bonus_credits INTO new_balance;
  RETURN COALESCE(new_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_bonus_credits(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_bonus_credits(p_user_id uuid, p_credits integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
BEGIN
  UPDATE public.profiles
  SET bonus_credits = GREATEST(bonus_credits - GREATEST(p_credits, 0), 0),
      updated_at = now()
  WHERE id = p_user_id
  RETURNING bonus_credits INTO new_balance;
  RETURN COALESCE(new_balance, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_bonus_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
