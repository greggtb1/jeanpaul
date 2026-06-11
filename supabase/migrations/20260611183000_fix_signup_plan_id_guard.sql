-- Fix signUp: profiles_guard_sensitive_columns mettait plan_id à NULL à l'INSERT,
-- ce qui violait NOT NULL et renvoyait "Database error saving new user".

ALTER TABLE public.profiles
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE public.profiles
  ALTER COLUMN plan_id SET DEFAULT 'chill';

UPDATE public.profiles
SET plan_id = 'chill'
WHERE plan_id IS NULL OR plan_id = 'pro';

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
