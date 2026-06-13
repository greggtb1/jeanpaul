import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  attachCheckoutToUser,
  getCheckoutSessionInfo,
  sessionBelongsToUser,
  type CheckoutSessionInfo,
} from "@/lib/stripe-session";

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

    if (user?.email) {
      if (!sessionBelongsToUser(info, user)) {
        return NextResponse.json({ error: "Session invalide" }, { status: 403 });
      }

      if (info.active) {
        const synced = await attachCheckoutToUser(sessionId, user.id, user.email, info);
        const updates: Record<string, string | null> = {
          subscription_status: "active",
          stripe_customer_id: synced.customerId,
          stripe_subscription_id: synced.subscriptionId,
          updated_at: new Date().toISOString(),
        };
        if (synced.planId) updates.plan_id = synced.planId;

        const admin = createAdminClient();
        await admin.from("profiles").update(updates).eq("id", user.id);
      }
    }

    return NextResponse.json({
      active: info.active,
      status: info.status,
      pending: info.pending,
      plan_id: info.planId,
      email: info.email,
      full_name: info.fullName,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
