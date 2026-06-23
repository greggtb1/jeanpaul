import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commissionCents, REFERRAL_COMMISSION_RATE } from "@/lib/referrals";

export function stripeCustomerIdFrom(
  value: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export async function recordReferralPayment(
  admin: SupabaseClient,
  input: {
    metadata: Stripe.Metadata | null | undefined;
    referredUserId?: string | null;
    referredEmail?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
    checkoutSessionId?: string | null;
    invoiceId?: string | null;
    amountPaidCents: number;
  }
) {
  const referralCodeId = input.metadata?.referral_code_id;
  const referrerUserId = input.metadata?.referrer_user_id;
  if (!referralCodeId || !referrerUserId || input.amountPaidCents <= 0) return;

  const rate = Number(input.metadata?.referral_commission_rate || REFERRAL_COMMISSION_RATE);
  const row = {
    referral_code_id: referralCodeId,
    referrer_user_id: referrerUserId,
    referred_user_id: input.referredUserId ?? null,
    referred_email: input.referredEmail?.toLowerCase() ?? null,
    stripe_customer_id: input.customerId ?? null,
    stripe_subscription_id: input.subscriptionId ?? null,
    stripe_checkout_session_id: input.checkoutSessionId ?? null,
    stripe_invoice_id: input.invoiceId ?? null,
    plan_id: input.metadata?.plan_id ?? null,
    billing_interval: input.metadata?.billing_interval ?? null,
    amount_paid_cents: input.amountPaidCents,
    commission_cents: commissionCents(input.amountPaidCents, rate),
    commission_rate: rate,
    status: "earned",
    paid_at: new Date().toISOString(),
  };

  const onConflict = input.invoiceId ? "stripe_invoice_id" : "stripe_checkout_session_id";
  await admin.from("referral_conversions").upsert(row, { onConflict });
}

export async function recordReferralFromCheckoutSession(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session
) {
  if (session.payment_status !== "paid" || !session.metadata?.referral_code_id) return;
  if (session.mode !== "payment") return;

  await recordReferralPayment(admin, {
    metadata: session.metadata,
    referredUserId:
      session.client_reference_id || session.metadata?.supabase_user_id || null,
    referredEmail:
      session.customer_details?.email ??
      session.customer_email ??
      session.metadata?.checkout_email ??
      null,
    customerId: stripeCustomerIdFrom(session.customer),
    checkoutSessionId: session.id,
    amountPaidCents: session.amount_total ?? 0,
  });
}
