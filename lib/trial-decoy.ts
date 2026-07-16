import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/lib/supabase";
import { isJobReadyWithoutCv, MIN_READY_SCORE } from "@/lib/job-ready";

export const TRIAL_DECOY_URL_PREFIX = "https://trial.blowmyjob.fr/decoy/";

export function isTrialDecoyJob(
  job: Pick<Job, "url" | "data">
): boolean {
  if (job.data?.trial_decoy === true) return true;
  return job.url.startsWith(TRIAL_DECOY_URL_PREFIX);
}

/** Dossiers affichés « prêts » en essai : générés, cadenassés et offres floutées. */
export function isTrialDisplayReadyJob(
  job: Pick<Job, "url" | "data" | "cv_url" | "fit_score">
): boolean {
  if (isTrialDecoyJob(job)) return true;
  if (job.cv_url) return true;
  const score = job.fit_score ?? (job.data?._fit_score as number | undefined);
  if (typeof score === "number" && score >= MIN_READY_SCORE) return true;
  return isJobReadyWithoutCv(job);
}

export function countTrialDisplayReadyJobs(
  jobs: Pick<Job, "url" | "data" | "cv_url" | "fit_score">[]
): number {
  return jobs.filter(isTrialDisplayReadyJob).length;
}

export async function deleteTrialDecoyJobs(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  const { data } = await admin
    .from("jobs")
    .select("url,data")
    .eq("user_id", userId)
    .eq("deleted", false);

  const urls = (data ?? [])
    .filter((row) => isTrialDecoyJob({ url: row.url, data: row.data as Record<string, unknown> }))
    .map((row) => row.url);

  if (!urls.length) return;

  await admin
    .from("jobs")
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("url", urls);
}
