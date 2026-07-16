-- Secteurs d'activité visés (critères de recherche, hors onboarding)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS target_sectors text[];
