import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ensureGregPromoCode } from "@/lib/stripe-promo";
import {
  ensureReferralCoupon,
  findReferralCode,
  REFERRAL_COMMISSION_RATE,
  REFERRAL_DISCOUNT_PERCENT,
} from "@/lib/referrals";
import {
  getPlan,
  isPlanId,
  isUpgradePlan,
  parseBillingInterval,
  parsePlanId,
  type BillingInterval,
  type PlanId,
} from "@/lib/plans";
import {
  buildCheckoutLineItem,
  checkoutMetadata,
  checkoutMode,
  resolveStripePriceId,
} from "@/lib/stripe-prices";
import type Stripe from "stripe";

function checkoutSessionBase(
  planId: string,
  billing: BillingInterval,
  origin: string,
  draftId: string,
  opts: { upgrade?: boolean },
  extra: Stripe.Checkout.SessionCreateParams
): Stripe.Checkout.SessionCreateParams {
  const plan = getPlan(planId);
  const mode = checkoutMode(planId);
  const upgrade = !!opts.upgrade;

  const successUrl = upgrade
    ? `${origin}/dashboard/facturation?upgraded=1&session_id={CHECKOUT_SESSION_ID}`
    : `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = upgrade
    ? `${origin}/dashboard/facturation?upgrade=1&cancelled=1&plan=${plan.id}&billing=${billing}`
    : `${origin}/subscribe?cancelled=1&plan=${plan.id}&billing=${billing}`;

  const meta = checkoutMetadata(planId, billing, {
    draft_id: draftId,
    checkout_intent: upgrade ? "upgrade" : "signup",
    ...extra.metadata,
  });

  const hasDiscounts = !!(extra.discounts && extra.discounts.length > 0);
  const base: Stripe.Checkout.SessionCreateParams = {
    mode,
    line_items: [buildCheckoutLineItem(planId, billing)],
    success_url: successUrl,
    cancel_url: cancelUrl,
    ...extra,
    metadata: meta,
  };
  // Stripe interdit allow_promotion_codes + discounts — on omet l'un ou l'autre.
  // Code test « greg » : champ promo Stripe uniquement sur Découverte.
  if (hasDiscounts) {
    delete base.allow_promotion_codes;
  } else if (planId === "test") {
    base.allow_promotion_codes = true;
  } else {
    delete base.allow_promotion_codes;
  }

  if (mode === "subscription") {
    base.subscription_data = {
      metadata: meta,
    };
  }

  return base;
}

async function tryInstantSubscriptionUpgrade(
  stripe: Stripe,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  subscriptionId: string,
  currentPlanId: PlanId,
  targetPlanId: PlanId,
  billing: BillingInterval,
  origin: string
): Promise<{ url: string } | null> {
  const target = getPlan(targetPlanId);
  if (target.kind !== "subscription" || !isUpgradePlan(currentPlanId, targetPlanId)) {
    return null;
  }

  const priceId = resolveStripePriceId(targetPlanId, billing);
  if (!priceId) return null;

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (sub.status !== "active" && sub.status !== "trialing") return null;

  const itemId = sub.items.data[0]?.id;
  if (!itemId) return null;

  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "create_prorations",
    metadata: checkoutMetadata(targetPlanId, billing, {
      supabase_user_id: userId,
      checkout_intent: "upgrade",
    }),
  });

  await admin
    .from("profiles")
    .update({
      plan_id: targetPlanId,
      subscription_status: sub.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return { url: `${origin}/dashboard/facturation?upgraded=1` };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let planId: PlanId | null = null;
    let billing: BillingInterval = "weekly";
    let email = "";
    let fullName = "";
    let draftId = "";
    let upgrade = false;
    let referralCode = "";

    try {
      const body = await req.json();
      const rawPlan = typeof body?.plan === "string" ? body.plan.trim() : "";
      if (!isPlanId(rawPlan)) {
        return NextResponse.json({ error: "Formule invalide" }, { status: 400 });
      }
      planId = rawPlan;
      billing = parseBillingInterval(body?.billing);
      email = (body?.email ?? "").trim().toLowerCase();
      fullName = (body?.full_name ?? "").trim();
      draftId = (body?.draft_id ?? "").trim();
      upgrade = body?.upgrade === true;
      referralCode = (body?.referral_code ?? "").trim();
    } catch {
      return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
    }

    const plan = getPlan(planId);
    if (plan.kind === "one_time" && upgrade) {
      return NextResponse.json(
        { error: "Choisissez un abonnement pour continuer." },
        { status: 400 }
      );
    }
    if (plan.kind === "one_time") {
      billing = "weekly";
    }

    const stripe = getStripe();
    await ensureGregPromoCode(stripe);
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const referralAdmin = referralCode ? createAdminClient() : null;
    const referral = referralAdmin
      ? await findReferralCode(referralAdmin, referralCode)
      : null;
    if (referralCode && !referral) {
      return NextResponse.json({ error: "Code parrainage invalide." }, { status: 400 });
    }
    if (referral && user?.id === referral.user_id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas utiliser votre propre code." },
        { status: 400 }
      );
    }
    const referralCouponId = referral ? await ensureReferralCoupon(stripe) : null;
    const referralMetadata: Record<string, string> = referral
      ? {
          referral_code_id: referral.id,
          referral_code: referral.code,
          referrer_user_id: referral.user_id,
          referral_discount_percent: String(REFERRAL_DISCOUNT_PERCENT),
          referral_commission_rate: String(REFERRAL_COMMISSION_RATE),
        }
      : {};
    const referralDiscount = referralCouponId
      ? { discounts: [{ coupon: referralCouponId }] }
      : {};

    if (user?.id && user.email) {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select(
          "stripe_customer_id, stripe_subscription_id, full_name, email, plan_id"
        )
        .eq("id", user.id)
        .maybeSingle();

      const currentPlanId = parsePlanId(profile?.plan_id);

      if (
        upgrade &&
        profile?.stripe_subscription_id &&
        isUpgradePlan(currentPlanId, planId)
      ) {
        const instant = await tryInstantSubscriptionUpgrade(
          stripe,
          admin,
          user.id,
          profile.stripe_subscription_id,
          currentPlanId,
          planId,
          billing,
          origin
        );
        if (instant) {
          return NextResponse.json({
            url: instant.url,
            plan: planId,
            billing,
            upgraded: true,
          });
        }
      }

      let customerId = profile?.stripe_customer_id as string | undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: profile?.full_name || user.user_metadata?.full_name || undefined,
          metadata: { supabase_user_id: user.id, plan_id: planId },
        });
        customerId = customer.id;
      }

      await admin
        .from("profiles")
        .update({
          stripe_customer_id: customerId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      const session = await stripe.checkout.sessions.create(
        checkoutSessionBase(planId, billing, origin, draftId, { upgrade }, {
          customer: customerId,
          client_reference_id: user.id,
          metadata: {
            supabase_user_id: user.id,
            draft_id: draftId,
            previous_subscription_id: profile?.stripe_subscription_id ?? "",
            ...referralMetadata,
          },
          ...referralDiscount,
        })
      );

      return NextResponse.json({ url: session.url, plan: planId, billing });
    }

    if (!draftId) {
      return NextResponse.json({ error: "draft_id requis" }, { status: 400 });
    }

    const guestCheckout: Stripe.Checkout.SessionCreateParams = {
      metadata: { pending: "true", ...referralMetadata },
      ...referralDiscount,
    };
    // `customer_creation` n'est valide qu'en mode `payment` (one-shot).
    // En mode `subscription`, Stripe crée le client automatiquement.
    if (checkoutMode(planId) === "payment") {
      guestCheckout.customer_creation = "always";
    }
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      guestCheckout.customer_email = email;
      guestCheckout.metadata = {
        pending: "true",
        checkout_email: email,
        ...referralMetadata,
      };
    }

    const session = await stripe.checkout.sessions.create(
      checkoutSessionBase(planId, billing, origin, draftId, { upgrade: false }, guestCheckout)
    );

    return NextResponse.json({ url: session.url, plan: planId, billing });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Impossible de créer la session de paiement";
    console.error("[stripe/checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
