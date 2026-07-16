import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCheckoutSessionInfo } from "@/lib/stripe-session";
import { markTrialUnlockPending } from "@/lib/trial-unlock";
import { deleteTrialDecoyJobs } from "@/lib/trial-decoy";

const MIN_PASSWORD = 6;

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === normalized
    );
    if (match) return match;

    if (data.users.length < 200) break;
    page += 1;
  }

  return null;
}

function isExistingUserError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("already") || lower.includes("registered");
}

/**
 * Crée ou met à jour le compte après paiement Stripe vérifié.
 * L'email est considéré comme confirmé (pas d'email de confirmation Supabase).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string = body?.session_id ?? "";
    const email: string = (body?.email ?? "").trim().toLowerCase();
    const password: string = body?.password ?? "";
    const fullName: string = (body?.full_name ?? "").trim();

    if (!sessionId || !email || !password) {
      return NextResponse.json({ error: "Paramètres manquants" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).` },
        { status: 400 }
      );
    }

    const info = await getCheckoutSessionInfo(sessionId);
    if (!info.active) {
      return NextResponse.json({ error: "Paiement non confirmé" }, { status: 400 });
    }

    const paidEmail = info.email?.trim().toLowerCase();
    if (!paidEmail) {
      return NextResponse.json(
        { error: "Session invalide : email de paiement manquant" },
        { status: 400 }
      );
    }
    if (paidEmail !== email) {
      return NextResponse.json(
        { error: "L'email doit correspondre à celui du paiement" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const userMeta = fullName ? { full_name: fullName } : undefined;

    const profileFromPayment = {
      plan_id: info.planId,
      subscription_status: "active" as const,
      stripe_customer_id: info.customerId,
      stripe_subscription_id: info.subscriptionId,
      updated_at: new Date().toISOString(),
    };

    // Mode essai : si un utilisateur anonyme est en session et que le paiement
    // lui appartient, on convertit son compte (offres et documents conservés).
    try {
      const supabase = await createClient();
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();

      const anonUser =
        sessionUser?.is_anonymous && (!info.userId || info.userId === sessionUser.id)
          ? sessionUser
          : null;

      if (anonUser) {
        const { error: convertError } = await admin.auth.admin.updateUserById(anonUser.id, {
          email,
          password,
          email_confirm: true,
          user_metadata: {
            ...((anonUser.user_metadata as Record<string, unknown>) ?? {}),
            ...(userMeta ?? {}),
          },
        });

        if (!convertError) {
          const { data: prevProfile } = await admin
            .from("profiles")
            .select("subscription_status,trial_used,is_trial")
            .eq("id", anonUser.id)
            .maybeSingle();

          await admin.from("profiles").upsert({
            id: anonUser.id,
            email,
            full_name: fullName || null,
            is_trial: false,
            ...profileFromPayment,
          });

          if (
            prevProfile?.subscription_status === "trial" ||
            prevProfile?.trial_used ||
            prevProfile?.is_trial
          ) {
            await markTrialUnlockPending(admin, anonUser.id);
            await deleteTrialDecoyJobs(admin, anonUser.id);
          }

          return NextResponse.json({ ok: true, user_id: anonUser.id, converted: true });
        }

        if (!isExistingUserError(convertError.message)) {
          return NextResponse.json({ error: convertError.message }, { status: 400 });
        }
        // Email déjà associé à un autre compte → parcours classique ci-dessous.
      }
    } catch {
      /* pas de session anonyme exploitable : parcours classique */
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMeta,
    });

    if (!createError && created.user) {
      await admin.from("profiles").upsert({
        id: created.user.id,
        email,
        full_name: fullName || null,
        ...profileFromPayment,
      });
      return NextResponse.json({ ok: true, user_id: created.user.id });
    }

    if (!createError || !isExistingUserError(createError.message)) {
      return NextResponse.json(
        { error: createError?.message || "Impossible de créer le compte" },
        { status: 400 }
      );
    }

    const existing = await findUserByEmail(admin, email);
    if (!existing) {
      return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...((existing.user_metadata as Record<string, unknown>) ?? {}),
        ...(userMeta ?? {}),
      },
    });

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    await admin.from("profiles").upsert({
      id: existing.id,
      email,
      full_name: fullName || null,
      ...profileFromPayment,
    });

    return NextResponse.json({ ok: true, user_id: existing.id });
  } catch (e) {
    console.error("[register-after-payment]", (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
