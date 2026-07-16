-- Préférences de localisation : ville stricte ou rayon autour du lieu principal.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS location_search_mode text DEFAULT 'radius'
    CHECK (location_search_mode IN ('city', 'radius')),
  ADD COLUMN IF NOT EXISTS location_radius_km integer DEFAULT 25
    CHECK (location_radius_km IS NULL OR (location_radius_km >= 0 AND location_radius_km <= 200));
