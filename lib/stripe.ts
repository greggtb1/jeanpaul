import Stripe from "stripe";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY manquant");
    stripe = new Stripe(key);
  }
  return stripe;
}

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function isSubscriptionActive(status: string | null | undefined): boolean {
  return !!status && ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

/** Checkout one-shot (mode payment) ou abo legacy. */
export function isCheckoutSessionActive(session: {
  payment_status?: string | null;
  status?: string | null;
}): boolean {
  if (session.payment_status === "paid") return true;
  return session.status === "complete";
}
