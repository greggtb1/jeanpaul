import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/lib/supabase";
import { isJobReadyWithoutCv, MIN_READY_SCORE } from "@/lib/job-ready";
import { isTrialDecoyJob } from "@/lib/trial-decoy";

export const trialUnlockPendingKey = (userId: string) => `trial_unlock_pending:${userId}`;

export function countPendingUnlockJobs(
  jobs: Pick<Job, "cv_url" | "letter_url" | "fit_score" | "data" | "url">[]
): number {
  return jobs.filter(isPendingUnlockJob).length;
}

export function isPendingUnlockJob(
  job: Pick<Job, "cv_url" | "letter_url" | "fit_score" | "data" | "url">
): boolean {
  if (isTrialDecoyJob(job)) return false;
  if (job.cv_url || job.letter_url) return false;
  const score = job.fit_score ?? (job.data?._fit_score as number | undefined);
  if (typeof score === "number" && score >= MIN_READY_SCORE) return true;
  return isJobReadyWithoutCv(job);
}

export async function markTrialUnlockPending(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  await admin.from("app_state").upsert({
    id: trialUnlockPendingKey(userId),
    user_id: userId,
    data: { pending: true },
  });
}

export async function clearTrialUnlockPending(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  await admin.from("app_state").delete().eq("id", trialUnlockPendingKey(userId));
}

export async function hasTrialUnlockPending(
  admin: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await admin
    .from("app_state")
    .select("data")
    .eq("id", trialUnlockPendingKey(userId))
    .maybeSingle();
  return !!(data?.data as { pending?: boolean } | undefined)?.pending;
}
