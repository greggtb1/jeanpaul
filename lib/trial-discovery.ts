import type { Job } from "@/lib/supabase";
import { countQuotaJobs } from "@/lib/job-ready";
import { TRIAL_DISCOVERY_GEN_MAX, isDiscoveryTrial } from "@/lib/plan-quota";

/** Dossiers réels livrés en essai (hors offres decoy) : CV généré ou prêt sans CV ≥6/10. */
export function countTrialFreeDossiers(
  jobs: Pick<Job, "url" | "data" | "cv_url" | "fit_score">[]
): number {
  return countQuotaJobs(jobs);
}

export function isTrialDiscoveryComplete(
  jobs: Pick<Job, "url" | "data" | "cv_url" | "fit_score">[]
): boolean {
  return countTrialFreeDossiers(jobs) >= TRIAL_DISCOVERY_GEN_MAX;
}

export function shouldShowTrialPaywall(
  subscriptionStatus: string | null | undefined,
  jobs: Pick<Job, "url" | "data" | "cv_url" | "fit_score">[]
): boolean {
  return isDiscoveryTrial(subscriptionStatus) && isTrialDiscoveryComplete(jobs);
}
