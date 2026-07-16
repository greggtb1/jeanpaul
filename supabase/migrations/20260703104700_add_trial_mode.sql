-- Mode essai (scan gratuit sans inscription via auth anonyme)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_trial boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_used boolean DEFAULT false;
