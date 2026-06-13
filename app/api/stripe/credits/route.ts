import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { CREDIT_PACKS, creditPackPriceCents, isCreditPackId } from "@/lib/plans";

/** Crée une session Stripe Checkout pour un pack de dossiers prêts. */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id || !user.email) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    let packId: string | null = null;
    try {
      const body = await req.json();
      packId = typeof body?.pack === "string" ? body.pack : null;
    } catch {
      return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
    }

    if (!isCreditPackId(packId)) {
      return NextResponse.json({ error: "Pack inconnu" }, { status: 400 });
    }
    const pack = CREDIT_PACKS[packId];

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id, full_name")
      .eq("id", user.id)
      .maybeSingle();

    const stripe = getStripe();
    let customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.full_name || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const metadata = {
      checkout_type: "credits",
      credit_pack: pack.id,
      credits: String(pack.credits),
      supabase_user_id: user.id,
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: creditPackPriceCents(pack),
            product_data: {
              name: `JEAN PAUL · ${pack.label} supplémentaires`,
              description: pack.hint,
              metadata: { credit_pack: pack.id, credits: String(pack.credits) },
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/dashboard/facturation?credits_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/facturation?credits=1&cancelled=1`,
      metadata,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Impossible de créer la session de paiement";
    console.error("[stripe/credits]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
