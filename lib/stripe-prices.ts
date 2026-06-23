import type { BillingInterval, PlanId } from "@/lib/plans";
import {
  checkoutAmountCents,
  getPlan,
  monthlyApplicationsQuota,
  parsePlanId,
  weeklyPriceCents,
  monthlyPriceCents,
  oneTimePriceCents,
} from "@/lib/plans";
import type Stripe from "stripe";

const ENV_KEYS: Record<string, string[]> = {
  "test:one_time": ["STRIPE_PRICE_TEST"],
  "chill:weekly": ["STRIPE_PRICE_CHILL_WEEKLY"],
  "chill:monthly": ["STRIPE_PRICE_CHILL_MONTHLY", "STRIPE_PRICE_CHILL_ANNUAL"],
  "tryhard:weekly": ["STRIPE_PRICE_TRYHARD_WEEKLY"],
  "tryhard:monthly": ["STRIPE_PRICE_TRYHARD_MONTHLY", "STRIPE_PRICE_TRYHARD_ANNUAL"],
};

export function resolveStripePriceId(
  planId: PlanId,
  billing: BillingInterval
): string | undefined {
  const key = planId === "test" ? "test:one_time" : `${planId}:${billing}`;
  const envNames = ENV_KEYS[key];
  if (!envNames) return undefined;
  for (const envName of envNames) {
    const value = process.env[envName]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Produit Stripe lié à un price configuré (ex. STRIPE_PRICE_TEST → produit Découverte). */
export async function resolveStripeProductIdForPlan(
  stripe: Stripe,
  planId: PlanId
): Promise<string | undefined> {
  const fromEnv =
    planId === "test" ? process.env.STRIPE_PRODUCT_TEST?.trim() : undefined;
  if (fromEnv) return fromEnv;

  const billing: BillingInterval = "weekly";
  const priceId = resolveStripePriceId(planId, billing);
  if (!priceId) return undefined;

  try {
    const price = await stripe.prices.retrieve(priceId);
    return typeof price.product === "string" ? price.product : price.product?.id;
  } catch {
    return undefined;
  }
}

export function buildCheckoutLineItem(
  planId: string,
  billing: BillingInterval
): Stripe.Checkout.SessionCreateParams.LineItem {
  const plan = getPlan(planId);
  const id = parsePlanId(planId);
  const priceId = resolveStripePriceId(id, billing);

  if (priceId) {
    return { price: priceId, quantity: 1 };
  }

  if (plan.kind === "one_time") {
    return {
      price_data: {
        currency: "eur",
        unit_amount: oneTimePriceCents(plan),
        product_data: {
          name: `BLOW MY JOB · ${plan.name}`,
          description: `1 recherche complète · jusqu'à ${plan.applicationsQuota} dossiers prêts à soumettre`,
          metadata: {
            plan_id: plan.id,
            applications_quota: String(plan.applicationsQuota),
          },
        },
      },
      quantity: 1,
    };
  }

  const isMonthly = billing === "monthly";
  const unitAmount = isMonthly
    ? monthlyPriceCents(plan.priceWeeklyEur!)
    : weeklyPriceCents(plan);

  return {
    price_data: {
      currency: "eur",
      unit_amount: unitAmount,
      recurring: {
        interval: isMonthly ? "month" : "week",
        interval_count: 1,
      },
      product_data: {
        name: `BLOW MY JOB · ${plan.name}`,
        description: `${monthlyApplicationsQuota(plan)} dossiers prêts à soumettre / mois`,
        metadata: {
          plan_id: plan.id,
          applications_per_week: String(plan.applicationsQuota),
        },
      },
    },
    quantity: 1,
  };
}

export function checkoutMode(planId: string): "payment" | "subscription" {
  return getPlan(planId).kind === "one_time" ? "payment" : "subscription";
}

export function checkoutMetadata(
  planId: string,
  billing: BillingInterval,
  extra: Record<string, string> = {}
): Record<string, string> {
  const plan = getPlan(planId);
  return {
    plan_id: plan.id,
    billing_interval: plan.kind === "one_time" ? "one_time" : billing,
    applications_quota: String(plan.applicationsQuota),
    checkout_type: plan.kind === "one_time" ? "one_time" : "subscription",
    amount_cents: String(checkoutAmountCents(plan, billing)),
    ...extra,
  };
}
