import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export type SubscriptionInfo = {
  status: string;
  planId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  amount: number | null;
  currency: string | null;
  lastInvoiceDate: string | null;
  lastInvoiceAmount: number | null;
  lastInvoicePdfUrl: string | null;
  hasCustomer: boolean;
  mode: "subscription" | "one_time" | "none";
};

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id, stripe_subscription_id, subscription_status, plan_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json<SubscriptionInfo>({
        status: profile?.subscription_status || "none",
        planId: profile?.plan_id || null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        amount: null,
        currency: null,
        lastInvoiceDate: null,
        lastInvoiceAmount: null,
        lastInvoicePdfUrl: null,
        hasCustomer: false,
        mode: "none",
      });
    }

    const stripe = getStripe();
    const info: SubscriptionInfo = {
      status: profile.subscription_status || "active",
      planId: profile.plan_id || null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      amount: null,
      currency: null,
      lastInvoiceDate: null,
      lastInvoiceAmount: null,
      lastInvoicePdfUrl: null,
      hasCustomer: true,
      mode: "none",
    };

    // Subscription récurrente
    if (profile.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(
          profile.stripe_subscription_id as string,
          { expand: ["latest_invoice"] }
        );
        info.mode = "subscription";
        info.status = sub.status;
        info.currentPeriodEnd = new Date((sub as any).current_period_end * 1000).toISOString();
        info.cancelAtPeriodEnd = sub.cancel_at_period_end;
        info.cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null;

        const items = sub.items?.data;
        if (items?.length) {
          const price = items[0].price;
          info.amount = price.unit_amount;
          info.currency = price.currency;
        }

        const inv = sub.latest_invoice as any;
        if (inv && typeof inv === "object") {
          info.lastInvoiceDate = inv.created ? new Date(inv.created * 1000).toISOString() : null;
          info.lastInvoiceAmount = inv.amount_paid ?? null;
          info.lastInvoicePdfUrl = inv.invoice_pdf ?? null;
        }
      } catch {}
    } else {
      // Paiement unique — cherche la dernière charge du customer
      info.mode = "one_time";
      try {
        const charges = await stripe.charges.list({
          customer: profile.stripe_customer_id as string,
          limit: 1,
        });
        const charge = charges.data[0];
        if (charge) {
          info.lastInvoiceDate = new Date(charge.created * 1000).toISOString();
          info.lastInvoiceAmount = charge.amount;
          info.currency = charge.currency;
          info.lastInvoicePdfUrl = charge.receipt_url ?? null;
        }
      } catch {}
    }

    return NextResponse.json(info);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur";
    console.error("[stripe/subscription]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
