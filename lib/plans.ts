export type PlanId = "test" | "chill" | "tryhard";
export type BillingInterval = "weekly" | "monthly";

export const DEFAULT_PLAN_ID: PlanId = "chill";
export const MONTHLY_DISCOUNT_PERCENT = 15;
/** Semaines facturées pour dériver le tarif mensuel (4 sem. × prix hebdo, −15 %). */
export const WEEKS_PER_MONTH = 4;

/** Affichage marketing : quota hebdo × 4 (le plafond réel reste hebdomadaire). */
export function monthlyApplicationsQuota(plan: Plan): number {
  return plan.applicationsQuota * WEEKS_PER_MONTH;
}

export function applicationsQuotaLabel(plan: Plan): string {
  if (plan.kind === "one_time") {
    return `1 recherche complète · jusqu'à ${plan.applicationsQuota} dossiers`;
  }
  return `${monthlyApplicationsQuota(plan)} dossiers / mois`;
}

const LEGACY_PLAN_IDS: Record<string, PlanId> = {
  essentiel: "chill",
  pro: "chill",
  intensif: "tryhard",
};

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  featured?: boolean;
  kind: "one_time" | "subscription";
  /** Dossiers adaptés au profil (one-shot) ou plafond hebdo (abo). */
  applicationsQuota: number;
  priceOneTimeEur: number | null;
  priceWeeklyEur: number | null;
};

export const PLANS: Record<PlanId, Plan> = {
  test: {
    id: "test",
    name: "Découverte",
    tagline: "Une vraie recherche pour tester JEAN PAUL jusqu'au bout",
    description:
      "Paiement unique : JEAN PAUL scanne LinkedIn, note les offres et prépare jusqu'à 15 dossiers complets prêts à soumettre.",
    features: [
      "Scan LinkedIn selon vos critères",
      "Jusqu'à 15 offres retenues et personnalisées",
      "CV + lettre prêts pour chaque bon match",
      "Score de pertinence /10 sur les offres analysées",
      "Sans abonnement",
    ],
    kind: "one_time",
    applicationsQuota: 15,
    priceOneTimeEur: 2.99,
    priceWeeklyEur: null,
  },
  chill: {
    id: "chill",
    name: "Essentiel",
    tagline: "Votre prochain poste, sans passer vos soirées à postuler",
    description:
      "Jusqu'à 180 dossiers prêts par mois. JEAN PAUL scanne, score et prépare chaque dossier pour vous.",
    features: [
      "180 dossiers prêts / mois",
      "Offres triées pour coller à votre profil",
      "CV et lettre sur mesure par annonce",
      "Formulaires pré-remplis, vous validez l'envoi",
    ],
    kind: "subscription",
    applicationsQuota: 45,
    priceOneTimeEur: null,
    priceWeeklyEur: 15,
  },
  tryhard: {
    id: "tryhard",
    name: "Intensif",
    tagline: "Accélérez sans brûler vos nuits",
    description:
      "300 dossiers prêts par mois quand vous voulez viser large sans tout faire à la main.",
    features: [
      "300 dossiers prêts / mois",
      "Tout le plan Essentiel inclus",
      "Dossiers candidatés sans lever le petit doigt",
      "Pensé pour la recherche active",
    ],
    featured: true,
    kind: "subscription",
    applicationsQuota: 75,
    priceOneTimeEur: null,
    priceWeeklyEur: 25,
  },
};

export const PLANS_LIST: Plan[] = [PLANS.test, PLANS.chill, PLANS.tryhard];

const PLAN_RANK: Record<PlanId, number> = {
  test: 0,
  chill: 1,
  tryhard: 2,
};

/** Plans abonnement supérieurs au plan actuel (pour upgrade). */
export function getUpgradePlans(currentPlanId: string | null | undefined): Plan[] {
  const current = parsePlanId(currentPlanId);
  return PLANS_LIST.filter(
    (p) => p.kind === "subscription" && PLAN_RANK[p.id] > PLAN_RANK[current]
  );
}

export function isUpgradePlan(from: PlanId, to: PlanId): boolean {
  return PLAN_RANK[to] > PLAN_RANK[from];
}

export function isPlanId(value: string | null | undefined): value is PlanId {
  return !!value && value in PLANS;
}

export function parsePlanId(value: string | null | undefined): PlanId {
  if (isPlanId(value)) return value;
  if (value && value in LEGACY_PLAN_IDS) return LEGACY_PLAN_IDS[value];
  return DEFAULT_PLAN_ID;
}

export function parseBillingInterval(
  value: string | null | undefined
): BillingInterval {
  if (value === "monthly" || value === "annual") return "monthly";
  return "weekly";
}

export function getPlan(value: string | null | undefined): Plan {
  return PLANS[parsePlanId(value)];
}

export function planQuery(planId: PlanId, billing?: BillingInterval): string {
  const params = new URLSearchParams({ plan: planId });
  if (billing && billing !== "weekly") params.set("billing", billing);
  return `?${params.toString()}`;
}

export function monthlyPriceEur(weeklyEur: number): number {
  const raw =
    weeklyEur * WEEKS_PER_MONTH * (1 - MONTHLY_DISCOUNT_PERCENT / 100);
  return Math.round(raw * 100) / 100;
}

/** Prix hebdo équivalent quand l'utilisateur paie au mois (−15 %). */
export function effectiveWeeklyPriceEur(weeklyEur: number): number {
  return Math.round((monthlyPriceEur(weeklyEur) / WEEKS_PER_MONTH) * 100) / 100;
}

export function monthlyPriceCents(weeklyEur: number): number {
  return Math.round(monthlyPriceEur(weeklyEur) * 100);
}

export function weeklyPriceCents(plan: Plan): number {
  if (plan.priceWeeklyEur == null) return 0;
  return Math.round(plan.priceWeeklyEur * 100);
}

export function oneTimePriceCents(plan: Plan): number {
  if (plan.priceOneTimeEur == null) return 0;
  return Math.round(plan.priceOneTimeEur * 100);
}

export function formatPriceEur(amount: number): string {
  return amount % 1 === 0 ? String(amount) : amount.toFixed(2).replace(".", ",");
}

export function displayPrice(
  plan: Plan,
  billing: BillingInterval = "weekly"
): { amount: string; suffix: string; billingSavings?: string } {
  if (plan.kind === "one_time" && plan.priceOneTimeEur != null) {
    return { amount: formatPriceEur(plan.priceOneTimeEur), suffix: "une fois" };
  }
  if (billing === "monthly" && plan.priceWeeklyEur != null) {
    const monthly = monthlyPriceEur(plan.priceWeeklyEur);
    const perWeek = effectiveWeeklyPriceEur(plan.priceWeeklyEur);
    return {
      amount: formatPriceEur(perWeek),
      suffix: "/ semaine",
      billingSavings: `−${MONTHLY_DISCOUNT_PERCENT} % · facturé ${formatPriceEur(monthly)} € / mois`,
    };
  }
  if (plan.priceWeeklyEur != null) {
    return { amount: formatPriceEur(plan.priceWeeklyEur), suffix: "/ semaine" };
  }
  return { amount: "…", suffix: "" };
}

export function checkoutAmountCents(
  plan: Plan,
  billing: BillingInterval
): number {
  if (plan.kind === "one_time") return oneTimePriceCents(plan);
  if (billing === "monthly" && plan.priceWeeklyEur != null) {
    return monthlyPriceCents(plan.priceWeeklyEur);
  }
  return weeklyPriceCents(plan);
}

/* ── Packs de dossiers prêts supplémentaires (achat one-shot) ───────────── */

export type CreditPackId = "pack5" | "pack15" | "pack30";

export type CreditPack = {
  id: CreditPackId;
  /** Nombre de dossiers prêts crédités */
  credits: number;
  priceEur: number;
  label: string;
  hint: string;
  featured?: boolean;
};

export const CREDIT_PACKS: Record<CreditPackId, CreditPack> = {
  pack5: {
    id: "pack5",
    credits: 15,
    priceEur: 4.99,
    label: "15 dossiers prêts",
    hint: "1 recherche supplémentaire",
  },
  pack15: {
    id: "pack15",
    credits: 30,
    priceEur: 7.99,
    label: "30 dossiers prêts",
    hint: "2 recherches supplémentaires",
    featured: true,
  },
  pack30: {
    id: "pack30",
    credits: 60,
    priceEur: 12.99,
    label: "60 dossiers prêts",
    hint: "4 recherches supplémentaires",
  },
};

export const CREDIT_PACKS_LIST: CreditPack[] = [
  CREDIT_PACKS.pack5,
  CREDIT_PACKS.pack15,
  CREDIT_PACKS.pack30,
];

export function isCreditPackId(value: string | null | undefined): value is CreditPackId {
  return !!value && value in CREDIT_PACKS;
}

export function creditPackPriceCents(pack: CreditPack): number {
  return Math.round(pack.priceEur * 100);
}
