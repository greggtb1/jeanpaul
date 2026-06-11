export type PlanId = "essentiel" | "pro" | "intensif";

export const DEFAULT_PLAN_ID: PlanId = "pro";

/** Prix affiché et facturé actuellement (offre lancement) */
export const LAUNCH_PRICE_EUR = 1;

/** Prix Stripe actuel (centimes) — offre lancement */
export const STRIPE_LAUNCH_UNIT_AMOUNT = LAUNCH_PRICE_EUR * 100;

export type Plan = {
  id: PlanId;
  name: string;
  listPrice: number;
  tagline: string;
  description: string;
  features: string[];
  featured?: boolean;
};

export const PLANS: Record<PlanId, Plan> = {
  essentiel: {
    id: "essentiel",
    name: "Essentiel",
    listPrice: 19,
    tagline: "Pour une recherche en veille",
    description:
      "Vous surveillez le marché sans y passer vos soirées. JEAN PAUL scanne et vous alerte sur les bonnes offres.",
    features: [
      "Scan LinkedIn hebdomadaire",
      "Score de fit /10 sur chaque offre",
      "10 candidatures préparées / mois",
      "CV adapté par offre",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    listPrice: 29,
    tagline: "Pour une recherche active",
    description:
      "Le cœur du produit : recherche, génération et auto-apply. L'équivalent de plusieurs heures par semaine.",
    features: [
      "Recherches LinkedIn illimitées",
      "CV + lettre générés pour chaque offre",
      "Auto-apply Easy Apply (validation avant envoi)",
      "Tableau de bord candidatures",
    ],
    featured: true,
  },
  intensif: {
    id: "intensif",
    name: "Intensif",
    listPrice: 49,
    tagline: "Pour une reconversion ou chômage",
    description:
      "Volume maximal quand chaque semaine compte. Priorité sur les nouvelles offres et plus de candidatures auto.",
    features: [
      "Tout le plan Pro",
      "Scan quotidien + alertes prioritaires",
      "Candidatures auto illimitées",
      "Support prioritaire",
    ],
  },
};

export const PLANS_LIST: Plan[] = [PLANS.essentiel, PLANS.pro, PLANS.intensif];

export function isPlanId(value: string | null | undefined): value is PlanId {
  return !!value && value in PLANS;
}

export function parsePlanId(value: string | null | undefined): PlanId {
  return isPlanId(value) ? value : DEFAULT_PLAN_ID;
}

export function getPlan(value: string | null | undefined): Plan {
  return PLANS[parsePlanId(value)];
}

export function planQuery(planId: PlanId): string {
  return `?plan=${planId}`;
}
