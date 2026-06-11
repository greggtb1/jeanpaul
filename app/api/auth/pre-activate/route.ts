import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckoutSessionInfo, attachCheckoutToUser } from "@/lib/stripe-session";
import { draftToProfilePayload, normalizeDraft, type OnboardingDraft } from "@/lib/onboarding-draft";

/**
 * Route appelée juste après signUp() quand Supabase exige la confirmation email.
 * Sauvegarde le profil + onboarding_done=true sans attendre la confirmation.
 * Non-bloquant : l'email de confirmation est quand même envoyé.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string = body?.session_id ?? "";
    const userId: string = body?.user_id ?? "";
    const clientDraft: Partial<OnboardingDraft> | null = body?.draft ?? null;

    if (!sessionId || !userId) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Vérifier que l'utilisateur existe dans auth
    const { data: { user }, error: userError } = await admin.auth.admin.getUserById(userId);
    if (userError || !user?.email) {
      return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
    }

    // Vérifier le paiement Stripe
    const info = await getCheckoutSessionInfo(sessionId);
    if (!info.active) {
      return NextResponse.json({ error: "Paiement non confirmé" }, { status: 400 });
    }

    // Rattacher la session Stripe à l'utilisateur
    await attachCheckoutToUser(sessionId, userId, user.email, info);

    const fullName = clientDraft?.full_name || info.fullName || "";

    const draft = normalizeDraft(clientDraft, {
      email: user.email,
      full_name: fullName,
      plan_id: info.planId,
      draft_id: info.draftId ?? undefined,
    });

    await admin.from("profiles").upsert({
      ...draftToProfilePayload(draft, userId),
      subscription_status: "active",
      stripe_customer_id: info.customerId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    // Non-bloquant : log uniquement
    console.error("[pre-activate]", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
