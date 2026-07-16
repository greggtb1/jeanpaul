import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan, PLANS, monthlyApplicationsQuota, type Plan, type PlanId } from "@/lib/plans";
import type { PipelineRunMode as PipelineMode } from "@/lib/pipeline-phase";

import { countQuotaJobs, countWeeklyQuotaJobs } from "@/lib/job-ready";
import { countPendingUnlockJobs } from "@/lib/trial-unlock";

/** Dossiers CV+lettre générés en mode découverte (essai gratuit). */
export const TRIAL_DISCOVERY_GEN_MAX = 4;

export function isDiscoveryTrial(subscriptionStatus: string | null | undefined): boolean {
  return subscriptionStatus === "trial";
}

/** Dossiers prêts générés max par scan (aligné sur HUNT_TARGET du moteur). */
export const CREDITS_PER_RUN = 15;

export type QuotaOpts = {
  generatedCount: number;
  weeklyGeneratedCount?: number;
  firstSearchDone?: boolean;
  bonusCredits?: number;
};

export type QuotaUsage = {
  label: string;
  used: number;
  /** Dénominateur affiché (mensuel pour les abos). */
  limit: number;
  /** Plafond hebdo réel (jauge + blocage). */
  weeklyLimit?: number;
  exhausted: boolean;
  bonusCredits: number;
  searchesUsed?: number;
  searchesLimit?: number;
};

export type UpgradeOffer = {
  href: string;
  name: string;
  priceHint: string;
  isMaxPlan?: boolean;
};

export function countGeneratedJobs(
  jobs: {
    cv_url?: string | null;
    fit_score?: number | null;
    data?: Record<string, unknown> | null;
  }[]
): number {
  return countQuotaJobs(jobs);
}

export function countWeeklyGeneratedJobs(
  jobs: {
    cv_url?: string | null;
    fit_score?: number | null;
    data?: Record<string, unknown> | null;
    updated_at?: string | null;
  }[]
): number {
  return countWeeklyQuotaJobs(jobs);
}

function weeklyCount(opts: QuotaOpts): number {
  return opts.weeklyGeneratedCount ?? opts.generatedCount;
}

function bonus(opts: QuotaOpts): number {
  return Math.max(0, opts.bonusCredits ?? 0);
}

function remainingBaseQuota(plan: Plan, opts: QuotaOpts): number {
  if (plan.kind === "one_time") {
    return Math.max(0, plan.applicationsQuota - opts.generatedCount);
  }
  return Math.max(0, plan.applicationsQuota - weeklyCount(opts));
}

/**
 * Le quota de base du plan est-il épuisé pour ce mode ?
 * - Start : plafond total de dossiers prêts
 * - Abonnements : plafond hebdomadaire de dossiers prêts
 */
function baseQuotaExhausted(plan: Plan, mode: PipelineMode, opts: QuotaOpts): boolean {
  if (mode === "autoapply") return false;

  if (plan.kind === "one_time") {
    return opts.generatedCount >= plan.applicationsQuota;
  }

  return weeklyCount(opts) >= plan.applicationsQuota;
}

function creditsNeededForMode(mode: PipelineMode): number {
  if (mode === "autoapply") return 0;
  if (mode === "import") return 1;
  if (mode === "unlock") return 1;
  return CREDITS_PER_RUN;
}

/** Ce lancement doit-il être financé par des crédits bonus ? */
export function isCreditFundedRun(
  plan: Plan,
  mode: PipelineMode,
  opts: QuotaOpts
): boolean {
  if (mode === "autoapply" || mode === "unlock") return false;
  return baseQuotaExhausted(plan, mode, opts) && bonus(opts) >= creditsNeededForMode(mode);
}

/**
 * Raison de blocage (null si autorisé).
 * Les crédits bonus débloquent un lancement quand le quota de base est épuisé.
 */
export function pipelineQuotaBlockReason(
  plan: Plan,
  mode: PipelineMode,
  opts: QuotaOpts
): string | null {
  if (mode === "autoapply") return null;
  if (mode === "unlock") {
    if (!baseQuotaExhausted(plan, mode, opts)) return null;
    return pipelineQuotaBlockReason(plan, "import", opts);
  }
  if (!baseQuotaExhausted(plan, mode, opts)) return null;
  const needed = creditsNeededForMode(mode);
  if (bonus(opts) >= needed) return null;
  if (bonus(opts) > 0) {
    return `Il vous reste ${bonus(opts)} dossier(s) bonus. Il en faut ${needed} pour lancer cette génération.`;
  }

  if (plan.kind === "one_time") {
    return `Votre recherche ${plan.name} est utilisée (${plan.applicationsQuota} dossiers prêts).`;
  }

  return `Vous avez atteint vos ${plan.applicationsQuota} dossiers prêts de la semaine (${plan.name}).`;
}

/** Consommation pour affichage (dashboard + facturation). */
export function getQuotaUsage(
  plan: Plan,
  opts: QuotaOpts,
  subscriptionStatus?: string | null
): QuotaUsage {
  if (isDiscoveryTrial(subscriptionStatus)) {
    const used = Math.min(opts.generatedCount, TRIAL_DISCOVERY_GEN_MAX);
    return {
      label: "Dossiers prêts (découverte)",
      used,
      limit: TRIAL_DISCOVERY_GEN_MAX,
      exhausted: used >= TRIAL_DISCOVERY_GEN_MAX,
      bonusCredits: 0,
    };
  }

  const bonusCredits = bonus(opts);

  if (plan.kind === "one_time") {
    return {
      label: "Dossiers prêts à soumettre",
      used: opts.generatedCount,
      limit: plan.applicationsQuota,
      exhausted: baseQuotaExhausted(plan, "full", opts) && bonusCredits < CREDITS_PER_RUN,
      bonusCredits,
    };
  }

  const weekly = weeklyCount(opts);
  const weeklyLimit = plan.applicationsQuota;
  return {
    label: "Dossiers prêts ce mois",
    used: weekly,
    limit: monthlyApplicationsQuota(plan),
    weeklyLimit,
    exhausted: weekly >= weeklyLimit && bonusCredits < CREDITS_PER_RUN,
    bonusCredits,
  };
}

/** Plan supérieur suggéré quand le quota bloque. */
export function suggestedUpgradePlan(planId: string | null | undefined): Plan | null {
  const id = getPlan(planId).id;
  if (id === "test") return PLANS.chill;
  if (id === "chill") return PLANS.tryhard;
  return null;
}

export function upgradeSubscribePath(planId?: PlanId | null): string {
  if (planId) return `/dashboard/facturation?upgrade=1&plan=${planId}`;
  return `/dashboard/facturation?upgrade=1`;
}

export function buyCreditsPath(): string {
  return `/dashboard/facturation?credits=1`;
}

export function buildUpgradeOffer(
  planId: string | null | undefined,
  blockReason: string | null
): UpgradeOffer | null {
  if (!blockReason) return null;

  const next = suggestedUpgradePlan(planId);
  if (next) {
    const priceHint =
      next.priceMonthlyEur != null
        ? `${next.priceMonthlyEur} €/mois`
        : next.priceWeeklyEur != null
          ? `${next.priceWeeklyEur} €/sem`
          : next.priceOneTimeEur != null
            ? `${next.priceOneTimeEur} €`
            : "";
    return {
      href: upgradeSubscribePath(next.id),
      name: next.name,
      priceHint,
    };
  }

  const plan = getPlan(planId);
  if (plan.kind === "subscription") {
    return {
      href: buyCreditsPath(),
      name: plan.name,
      priceHint: "",
      isMaxPlan: true,
    };
  }

  return null;
}

export async function fetchGeneratedJobCounts(
  admin: SupabaseClient,
  userId: string
): Promise<{ total: number; weekly: number }> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [withCv, withoutCv, importedWithoutCv] = await Promise.all([
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .not("cv_url", "is", null),
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .is("cv_url", null)
      .gte("fit_score", 6)
      .contains("data", { ready_without_cv: true }),
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .is("cv_url", null)
      .is("fit_score", null)
      .contains("data", { ready_without_cv: true, imported_manually: true }),
  ]);

  const total =
    (withCv.count ?? 0) + (withoutCv.count ?? 0) + (importedWithoutCv.count ?? 0);

  const [weeklyWithCv, weeklyWithoutCv, weeklyImportedWithoutCv] = await Promise.all([
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .not("cv_url", "is", null)
      .gte("updated_at", weekAgo),
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .is("cv_url", null)
      .gte("fit_score", 6)
      .contains("data", { ready_without_cv: true })
      .gte("updated_at", weekAgo),
    admin
      .from("jobs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("deleted", false)
      .is("cv_url", null)
      .is("fit_score", null)
      .contains("data", { ready_without_cv: true, imported_manually: true })
      .gte("updated_at", weekAgo),
  ]);

  return {
    total,
    weekly:
      (weeklyWithCv.count ?? 0) +
      (weeklyWithoutCv.count ?? 0) +
      (weeklyImportedWithoutCv.count ?? 0),
  };
}

/**
 * Vérifie le quota côté serveur. Si le lancement est financé par crédits,
 * décompte CREDITS_PER_RUN avant de l'autoriser.
 */
export async function assertPipelineQuota(
  admin: SupabaseClient,
  userId: string,
  mode: PipelineMode,
  profile: {
    plan_id?: string | null;
    first_search_done?: boolean | null;
    bonus_credits?: number | null;
  }
): Promise<
  { ok: true; creditFunded?: boolean; runTarget: number } | { ok: false; error: string }
> {
  const plan = getPlan(profile.plan_id);
  const { total, weekly } = await fetchGeneratedJobCounts(admin, userId);

  const opts: QuotaOpts = {
    generatedCount: total,
    weeklyGeneratedCount: weekly,
    firstSearchDone: !!profile.first_search_done,
    bonusCredits: profile.bonus_credits ?? 0,
  };

  if (mode === "unlock") {
    const { data: jobs } = await admin
      .from("jobs")
      .select("url,cv_url,letter_url,fit_score,data")
      .eq("user_id", userId)
      .eq("deleted", false);
    const pending = countPendingUnlockJobs(jobs ?? []);
    if (pending === 0) {
      return { ok: false, error: "Aucun dossier à débloquer." };
    }
    const reason = pipelineQuotaBlockReason(plan, mode, opts);
    if (reason) return { ok: false, error: reason };
    const baseRemaining = remainingBaseQuota(plan, opts);
    const runTarget = Math.min(pending, baseRemaining || pending);
    if (runTarget <= 0) {
      return { ok: false, error: "Quota de dossiers épuisé pour le déblocage." };
    }
    return { ok: true, runTarget };
  }

  const reason = pipelineQuotaBlockReason(plan, mode, opts);
  if (reason) return { ok: false, error: reason };

  const baseRemaining = remainingBaseQuota(plan, opts);
  const needed = creditsNeededForMode(mode);
  const runTarget = mode === "autoapply" ? 0 : Math.min(needed, baseRemaining || needed);

  if (baseQuotaExhausted(plan, mode, opts) && bonus(opts) > 0 && bonus(opts) < needed) {
    return {
      ok: false,
      error: `Il vous reste ${bonus(opts)} dossier(s) bonus. Il en faut ${needed} pour lancer cette génération.`,
    };
  }

  if (isCreditFundedRun(plan, mode, opts)) {
    const { error } = await admin.rpc("consume_bonus_credits", {
      p_user_id: userId,
      p_credits: needed,
    });
    if (error) {
      return { ok: false, error: "Impossible de décompter vos dossiers prêts bonus. Réessayez." };
    }
    return { ok: true, creditFunded: true, runTarget: needed };
  }

  return { ok: true, runTarget };
}
