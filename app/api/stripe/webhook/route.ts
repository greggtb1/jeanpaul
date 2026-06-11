import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

async function syncSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) return;

  const admin = createAdminClient();
  const updates: Record<string, string> = {
    subscription_status: subscription.status,
    stripe_subscription_id: subscription.id,
    stripe_customer_id:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    updated_at: new Date().toISOString(),
  };
  if (subscription.metadata?.plan_id) {
    updates.plan_id = subscription.metadata.plan_id;
  }

  await admin.from("profiles").update(updates).eq("id", userId);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 500 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Signature manquante" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.supabase_user_id;
      if (!userId || session.metadata?.pending === "true") break;

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        onboarding_done: true,
      };
      if (typeof session.customer === "string") updates.stripe_customer_id = session.customer;
      if (session.metadata?.plan_id) updates.plan_id = session.metadata.plan_id;

      if (session.mode === "payment" && session.payment_status === "paid") {
        updates.subscription_status = "active";
      } else if (typeof session.subscription === "string") {
        updates.stripe_subscription_id = session.subscription;
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        updates.subscription_status = sub.status;
      }

      await admin.from("profiles").update(updates).eq("id", userId);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
