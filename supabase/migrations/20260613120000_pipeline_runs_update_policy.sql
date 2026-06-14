-- Allow authenticated users to update their own pipeline runs (desktop agent logs via user JWT).

DROP POLICY IF EXISTS "pipeline_runs_update_own" ON pipeline_runs;

CREATE POLICY "pipeline_runs_update_own" ON pipeline_runs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
