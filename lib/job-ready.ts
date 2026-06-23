import type { Job } from "@/lib/supabase";

export const MIN_READY_SCORE = 6;

export function isJobReadyWithoutCv(job: Job): boolean {
  return !!(job.data as Record<string, unknown> | undefined)?.ready_without_cv;
}

export function isJobReady(job: Job): boolean {
  if (job.applied) return false;
  if (job.cv_url) return true;
  if (job.data?.imported_manually && isJobReadyWithoutCv(job)) return true;
  const score = job.fit_score ?? (job.data?._fit_score as number | undefined);
  if (typeof score !== "number" || score < MIN_READY_SCORE) return false;
  return isJobReadyWithoutCv(job);
}

export function countQuotaJobs(
  jobs: { cv_url?: string | null; fit_score?: number | null; data?: Record<string, unknown> | null }[]
): number {
  return jobs.filter((j) => jobCountsForQuota(j)).length;
}

export function countWeeklyQuotaJobs(
  jobs: {
    cv_url?: string | null;
    fit_score?: number | null;
    data?: Record<string, unknown> | null;
    updated_at?: string | null;
  }[]
): number {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return jobs.filter((j) => {
    if (!jobCountsForQuota(j)) return false;
    if (!j.updated_at) return true;
    return new Date(j.updated_at).getTime() >= weekAgo;
  }).length;
}

function jobCountsForQuota(job: {
  cv_url?: string | null;
  fit_score?: number | null;
  data?: Record<string, unknown> | null;
}): boolean {
  if (job.cv_url) return true;
  if (!job.data?.ready_without_cv) return false;
  if (job.data.imported_manually) return true;
  const score = job.fit_score ?? (job.data._fit_score as number | undefined);
  return typeof score === "number" && score >= MIN_READY_SCORE;
}
