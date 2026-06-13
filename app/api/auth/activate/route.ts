import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachCheckoutToUser,
  getCheckoutSessionInfo,
  sessionBelongsToUser,
} from "@/lib/stripe-session";
import {
  draftToProfilePayload,
  normalizeDraft,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let sessionId = "";
  let clientDraft: Partial<OnboardingDraft> | null = null;
  try {
    const body = await req.json();
    sessionId = body?.session_id ?? "";
    clientDraft = body?.draft ?? null;
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: "session_id requis" }, { status: 400 });
  }

  try {
    const stripeInfo = await getCheckoutSessionInfo(sessionId);

    if (!sessionBelongsToUser(stripeInfo, user)) {
      return NextResponse.json({ error: "Session invalide" }, { status: 403 });
    }

    const draft = normalizeDraft(clientDraft, {
      email: user.email,
      full_name:
        clientDraft?.full_name ||
        stripeInfo.fullName ||
        "",
      plan_id: stripeInfo.planId,
      draft_id: stripeInfo.draftId ?? undefined,
    });

    if (!draft.email) {
      return NextResponse.json({ error: "Email manquant pour l'activation" }, { status: 400 });
    }

    const info = await attachCheckoutToUser(sessionId, user.id, user.email, stripeInfo);

    const admin = createAdminClient();
    const { error } = await admin.from("profiles").upsert({
      ...draftToProfilePayload(draft, user.id),
      plan_id: info.planId,
      subscription_status: info.status ?? (info.active ? "active" : "none"),
      stripe_customer_id: info.customerId,
      stripe_subscription_id: info.subscriptionId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
