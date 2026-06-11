import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan, PLANS, type Plan, type PlanId } from "@/lib/plans";

export type PipelineMode = "full" | "autoapply" | "analyze";

/** Candidatures générées max par scan (aligné sur HUNT_TARGET du moteur). */
export const CREDITS_PER_RUN = 5;

export type QuotaOpts = {
  generatedCount: number;
  weeklyGeneratedCount?: number;
  firstSearchDone?: boolean;
  bonusCredits?: number;
};

export type QuotaUsage = {
  label: string;
  used: number;
  limit: number;
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
  jobs: { cv_url?: string | null; updated_at?: string | null }[]
): number {
  return jobs.filter((j) => j.cv_url).length;
}

export function countWeeklyGeneratedJobs(
  jobs: { cv_url?: string | null; updated_at?: string | null }[]
): number {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return jobs.filter((j) => {
    if (!j.cv_url) return false;
    if (!j.updated_at) return true;
    return new Date(j.updated_at).getTime() >= weekAgo;
  }).length;
}

function weeklyCount(opts: QuotaOpts): number {
  return opts.weeklyGeneratedCount ?? opts.generatedCount;
}

function bonus(opts: QuotaOpts): number {
  return Math.max(0, opts.bonusCredits ?? 0);
}

/**
 * Le quota de base du plan est-il épuisé pour ce mode ?
 * - Découverte : 1 recherche + plafond total de candidatures
 * - Abonnements : plafond hebdomadaire de candidatures
 */
function baseQuotaExhausted(plan: Plan, mode: PipelineMode, opts: QuotaOpts): boolean {
  if (mode === "autoapply") return false;

  if (plan.kind === "one_time") {
    if (opts.generatedCount >= plan.applicationsQuota) return true;
    if (mode === "full" && opts.firstSearchDone) return true;
    return false;
  }

  return weeklyCount(opts) >= plan.applicationsQuota;
}

/** Ce lancement doit-il être financé par des crédits bonus ? */
export function isCreditFundedRun(
  plan: Plan,
  mode: PipelineMode,
  opts: QuotaOpts
): boolean {
  if (mode === "autoapply") return false;
  return baseQuotaExhausted(plan, mode, opts) && bonus(opts) > 0;
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
  if (!baseQuotaExhausted(plan, mode, opts)) return null;
  if (bonus(opts) > 0) return null;

  if (plan.kind === "one_time") {
    if (opts.generatedCount >= plan.applicationsQuota) {
      return `Vos ${plan.applicationsQuota} candidatures ${plan.name} sont utilisées.`;
    }
    return `Le plan ${plan.name} inclut une seule recherche (${plan.applicationsQuota} candidatures).`;
  }

  return `Vous avez atteint vos ${plan.applicationsQuota} candidatures de la semaine (${plan.name}).`;
}

/** Consommation pour affichage (dashboard + facturation). */
export function getQuotaUsage(plan: Plan, opts: QuotaOpts): QuotaUsage {
  const bonusCredits = bonus(opts);

  if (plan.kind === "one_time") {
    return {
      label: "Candidatures",
      used: opts.generatedCount,
      limit: plan.applicationsQuota,
      exhausted: baseQuotaExhausted(plan, "full", opts) && bonusCredits <= 0,
      bonusCredits,
      searchesUsed: opts.firstSearchDone ? 1 : 0,
      searchesLimit: 1,
    };
  }

  const weekly = weeklyCount(opts);
  return {
    label: "Candidatures cette semaine",
    used: weekly,
    limit: plan.applicationsQuota,
    exhausted: weekly >= plan.applicationsQuota && bonusCredits <= 0,
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
      next.priceWeeklyEur != null
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

  const [totalRes, weeklyRes] = await Promise.all([
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
      .not("cv_url", "is", null)
      .gte("updated_at", weekAgo),
  ]);

  return {
    total: totalRes.count ?? 0,
    weekly: weeklyRes.count ?? 0,
  };
}

/**
 * Vérifie le quota côté serveur. Si le lancement est financé par crédits,
 * décompte CREDITS_PER_RUN (plafonné au solde) avant de l'autoriser.
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
): Promise<{ ok: true; creditFunded?: boolean } | { ok: false; error: string }> {
  const plan = getPlan(profile.plan_id);
  const { total, weekly } = await fetchGeneratedJobCounts(admin, userId);

  const opts: QuotaOpts = {
    generatedCount: total,
    weeklyGeneratedCount: weekly,
    firstSearchDone: !!profile.first_search_done,
    bonusCredits: profile.bonus_credits ?? 0,
  };

  const reason = pipelineQuotaBlockReason(plan, mode, opts);
  if (reason) return { ok: false, error: reason };

  if (isCreditFundedRun(plan, mode, opts)) {
    const { error } = await admin.rpc("consume_bonus_credits", {
      p_user_id: userId,
      p_credits: CREDITS_PER_RUN,
    });
    if (error) {
      return { ok: false, error: "Impossible de décompter vos candidatures bonus. Réessayez." };
    }
    return { ok: true, creditFunded: true };
  }

  return { ok: true };
}
