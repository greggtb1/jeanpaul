import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ensureGregPromoCode } from "@/lib/stripe-promo";
import { getPlan, parsePlanId, STRIPE_LAUNCH_UNIT_AMOUNT, type Plan } from "@/lib/plans";
import type Stripe from "stripe";

function buildLineItems(plan: Plan): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const priceId = process.env.STRIPE_ONE_TIME_PRICE_ID?.trim();
  if (priceId) return [{ price: priceId, quantity: 1 }];

  return [
    {
      price_data: {
        currency: "eur",
        unit_amount: STRIPE_LAUNCH_UNIT_AMOUNT,
        product_data: {
          name: `JEAN PAUL · ${plan.name}`,
          description: `${plan.description} (accès lancement, paiement unique)`,
        },
      },
      quantity: 1,
    },
  ];
}

function checkoutSessionBase(
  plan: Plan,
  origin: string,
  planId: string,
  draftId: string,
  extra: Stripe.Checkout.SessionCreateParams
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: "payment",
    line_items: buildLineItems(plan),
    allow_promotion_codes: true,
    success_url: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/subscribe?cancelled=1&plan=${planId}`,
    ...extra,
    metadata: {
      plan_id: planId,
      draft_id: draftId,
      checkout_type: "one_time",
      ...extra.metadata,
    },
  };
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let planId = parsePlanId(null);
    let email = "";
    let fullName = "";
    let draftId = "";

    try {
      const body = await req.json();
      planId = parsePlanId(body?.plan);
      email = (body?.email ?? "").trim().toLowerCase();
      fullName = (body?.full_name ?? "").trim();
      draftId = (body?.draft_id ?? "").trim();
    } catch {
      return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
    }

    const plan = getPlan(planId);
    const stripe = getStripe();
    await ensureGregPromoCode(stripe);
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    if (user?.id && user.email) {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("stripe_customer_id, full_name, email, plan_id")
        .eq("id", user.id)
        .maybeSingle();

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
          plan_id: planId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      const session = await stripe.checkout.sessions.create(
        checkoutSessionBase(plan, origin, planId, draftId, {
          customer: customerId,
          client_reference_id: user.id,
          metadata: {
            supabase_user_id: user.id,
            plan_id: planId,
            draft_id: draftId,
            checkout_type: "one_time",
          },
        })
      );

      return NextResponse.json({ url: session.url, plan: planId });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email requis" }, { status: 400 });
    }

    if (!draftId) {
      return NextResponse.json({ error: "draft_id requis" }, { status: 400 });
    }

    const customer = await stripe.customers.create({
      email,
      name: fullName || undefined,
      metadata: { plan_id: planId, draft_id: draftId, pending: "true" },
    });

    const session = await stripe.checkout.sessions.create(
      checkoutSessionBase(plan, origin, planId, draftId, {
        customer: customer.id,
        metadata: {
          plan_id: planId,
          draft_id: draftId,
          email,
          pending: "true",
          checkout_type: "one_time",
        },
      })
    );

    return NextResponse.json({ url: session.url, plan: planId });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Impossible de créer la session de paiement";
    console.error("[stripe/checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
