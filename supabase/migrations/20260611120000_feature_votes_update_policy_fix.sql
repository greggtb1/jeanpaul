-- Fix vote counter updates under RLS (trigger must be able to UPDATE feature_requests)

DROP POLICY IF EXISTS "fr_update_votes" ON feature_requests;
CREATE POLICY "fr_update_votes" ON feature_requests
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

ALTER FUNCTION feature_votes_sync() SECURITY DEFINER SET search_path = public;
