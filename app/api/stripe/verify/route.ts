import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutSessionInfo } from "@/lib/stripe-session";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id requis" }, { status: 400 });
  }

  try {
    const info = await getCheckoutSessionInfo(sessionId);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      if (info.userId && info.userId !== user.id && !info.pending) {
        return NextResponse.json({ error: "Session invalide" }, { status: 403 });
      }

      if (info.active) {
        const updates: Record<string, string | null> = {
          subscription_status: "active",
          stripe_customer_id: info.customerId,
          stripe_subscription_id: null,
          updated_at: new Date().toISOString(),
        };
        if (info.planId) updates.plan_id = info.planId;

        await supabase.from("profiles").update(updates).eq("id", user.id);
      }
    }

    return NextResponse.json({
      active: info.active,
      status: info.status,
      email: info.email,
      full_name: info.fullName,
      plan_id: info.planId,
      draft_id: info.draftId,
      pending: info.pending,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
