import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export function isCreditsSession(session: Stripe.Checkout.Session): boolean {
  return session.metadata?.checkout_type === "credits";
}

/**
 * Crédite les dossiers prêts d'une session payée, une seule fois
 * (idempotent via une ligne app_state `credits_grant:{sessionId}`).
 * Appelé par le webhook ET par le retour de paiement.
 */
export async function grantCreditsForSession(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session
): Promise<{ granted: boolean; credits: number }> {
  const userId =
    session.client_reference_id || session.metadata?.supabase_user_id || null;
  const credits = parseInt(session.metadata?.credits ?? "", 10);

  if (!userId || !Number.isFinite(credits) || credits <= 0) {
    return { granted: false, credits: 0 };
  }
  if (session.payment_status !== "paid") {
    return { granted: false, credits: 0 };
  }

  const { error: claimErr } = await admin.from("app_state").insert({
    id: `credits_grant:${session.id}`,
    user_id: userId,
    data: { credits, pack: session.metadata?.credit_pack ?? null },
  });

  // Déjà créditée (webhook + verify peuvent arriver tous les deux)
  if (claimErr) {
    if (claimErr.code === "23505") return { granted: false, credits };
    throw new Error(claimErr.message);
  }

  const { error: grantErr } = await admin.rpc("grant_bonus_credits", {
    p_user_id: userId,
    p_credits: credits,
  });
  if (grantErr) {
    // Libère le verrou pour permettre une nouvelle tentative
    await admin.from("app_state").delete().eq("id", `credits_grant:${session.id}`);
    throw new Error(grantErr.message);
  }

  return { granted: true, credits };
}
