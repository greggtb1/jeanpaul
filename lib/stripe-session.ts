import type Stripe from "stripe";
import { getStripe, isCheckoutSessionActive } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordReferralFromCheckoutSession } from "@/lib/referral-conversions";
import {
  isPlanId,
  oneTimePriceCents,
  parsePlanId,
  PLANS,
  type PlanId,
} from "@/lib/plans";

export type CheckoutSessionInfo = {
  active: boolean;
  status: string | null;
  email: string | null;
  fullName: string | null;
  planId: ReturnType<typeof parsePlanId>;
  draftId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  pending: boolean;
  userId: string | null;
  /** Montant payé en centimes (pour la valeur de conversion publicitaire). */
  amountTotalCents: number | null;
  currency: string | null;
};

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

/** Paiement unique (mode payment) → toujours Start si aucun plan explicite. */
export function resolvePlanIdFromCheckoutSession(
  session: Stripe.Checkout.Session
): PlanId {
  const raw = session.metadata?.plan_id?.trim();
  if (isPlanId(raw)) return raw;

  const isOneTime =
    session.metadata?.checkout_type === "one_time" ||
    (session.mode === "payment" && !session.subscription);

  if (isOneTime) {
    return "test";
  }

  const testPlan = PLANS.test;
  const testCents = oneTimePriceCents(testPlan);
  const quota = session.metadata?.applications_quota;
  const amountMeta = session.metadata?.amount_cents;
  if (
    quota === String(testPlan.applicationsQuota) ||
    amountMeta === String(testCents) ||
    session.amount_total === testCents
  ) {
    return "test";
  }

  return parsePlanId(raw);
}

export function sessionBelongsToUser(
  info: CheckoutSessionInfo,
  user: { id: string; email?: string | null }
): boolean {
  if (info.userId && info.userId !== user.id) {
    return false;
  }

  const paidEmail = normalizeEmail(info.email);
  const userEmail = normalizeEmail(user.email);

  if (info.pending && !paidEmail) {
    return false;
  }

  if (paidEmail && userEmail && paidEmail !== userEmail) {
    return false;
  }

  return true;
}

export async function getCheckoutSessionInfo(sessionId: string): Promise<CheckoutSessionInfo> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["customer", "subscription"],
  });

  const customer =
    typeof session.customer === "string"
      ? await stripe.customers.retrieve(session.customer)
      : session.customer;

  const email =
    session.customer_details?.email ??
    (customer && !("deleted" in customer) ? customer.email : null) ??
    session.metadata?.checkout_email ??
    session.metadata?.email ??
    null;

  const fullName =
    session.customer_details?.name ??
    (customer && !("deleted" in customer) ? customer.name : null) ??
    null;

  const pending = session.metadata?.pending === "true";
  const userId = session.client_reference_id || session.metadata?.supabase_user_id || null;
  const active = isCheckoutSessionActive(session);

  const customerPlanRaw =
    customer && !("deleted" in customer)
      ? customer.metadata?.plan_id?.trim()
      : undefined;
  let planId = resolvePlanIdFromCheckoutSession(session);
  if (planId === "chill" && isPlanId(customerPlanRaw)) {
    planId = customerPlanRaw;
  }

  return {
    active,
    status: active ? "active" : session.payment_status ?? null,
    email,
    fullName,
    planId,
    draftId: session.metadata?.draft_id ?? null,
    customerId:
      typeof session.customer === "string"
        ? session.customer
        : customer && !("deleted" in customer)
          ? customer.id
          : null,
    subscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null,
    pending,
    userId,
    amountTotalCents: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
}

export async function attachCheckoutToUser(
  sessionId: string,
  userId: string,
  userEmail: string,
  prefetched?: CheckoutSessionInfo
) {
  const stripe = getStripe();
  const info = prefetched ?? (await getCheckoutSessionInfo(sessionId));

  if (!info.active) {
    throw new Error("Paiement non confirmé");
  }

  if (info.userId && info.userId !== userId) {
    throw new Error("Session déjà rattachée à un autre compte");
  }

  const paidEmail = normalizeEmail(info.email);
  const accountEmail = normalizeEmail(userEmail);

  if (info.pending && !paidEmail) {
    throw new Error("Session invalide : email de paiement manquant");
  }

  if (paidEmail && accountEmail && paidEmail !== accountEmail) {
    throw new Error("L'email du compte doit correspondre à celui du paiement");
  }

  const metadata = {
    supabase_user_id: userId,
    plan_id: info.planId,
    draft_id: info.draftId ?? "",
  };

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const mergedSessionMetadata = {
    ...(session.metadata ?? {}),
    ...metadata,
    pending: "false",
  };

  const tasks: Promise<unknown>[] = [
    stripe.checkout.sessions.update(sessionId, {
      metadata: mergedSessionMetadata,
    }),
  ];

  if (info.customerId) {
    tasks.push(stripe.customers.update(info.customerId, { metadata }));
  }

  if (info.subscriptionId) {
    const sub = await stripe.subscriptions.retrieve(info.subscriptionId);
    tasks.push(
      stripe.subscriptions.update(info.subscriptionId, {
        metadata: {
          ...(sub.metadata ?? {}),
          ...metadata,
        },
      })
    );
  }

  await Promise.all(tasks);

  const admin = createAdminClient();
  try {
    await recordReferralFromCheckoutSession(admin, session);
  } catch (e) {
    console.error("[stripe-session] referral", e);
  }

  return info;
}
