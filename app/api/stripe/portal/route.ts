import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.id) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id as string | undefined;
    if (!customerId) {
      return NextResponse.json(
        { error: "Aucun compte Stripe associé. Contactez le support." },
        { status: 400 }
      );
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    let body: { return_url?: string } = {};
    try { body = await req.json(); } catch {}
    const returnUrl = body?.return_url || `${origin}/dashboard/facturation`;

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur portail Stripe";
    console.error("[stripe/portal]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
