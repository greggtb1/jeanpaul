import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { grantCreditsForSession, isCreditsSession } from "@/lib/stripe-credits";

/** Au retour du paiement : confirme la session et crédite (idempotent). */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id requis" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!isCreditsSession(session)) {
      return NextResponse.json({ error: "Session invalide" }, { status: 400 });
    }
    const sessionUser =
      session.client_reference_id || session.metadata?.supabase_user_id;
    if (sessionUser !== user.id) {
      return NextResponse.json({ error: "Session invalide" }, { status: 403 });
    }

    const admin = createAdminClient();
    const result = await grantCreditsForSession(admin, session);

    const { data: profile } = await admin
      .from("profiles")
      .select("bonus_credits")
      .eq("id", user.id)
      .maybeSingle();

    return NextResponse.json({
      paid: session.payment_status === "paid",
      credits: result.credits,
      balance: profile?.bonus_credits ?? 0,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur";
    console.error("[stripe/credits/verify]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
