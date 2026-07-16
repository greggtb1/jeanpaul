-- Par défaut, garder la recherche stricte à la ville pour limiter la friction onboarding.

ALTER TABLE profiles
  ALTER COLUMN location_search_mode SET DEFAULT 'city',
  ALTER COLUMN location_radius_km DROP DEFAULT;
