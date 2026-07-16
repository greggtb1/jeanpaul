import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  countPendingUnlockJobs,
  hasTrialUnlockPending,
  markTrialUnlockPending,
} from "@/lib/trial-unlock";
import { deleteTrialDecoyJobs } from "@/lib/trial-decoy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .maybeSingle();

    const isPaid =
      profile?.subscription_status === "active" ||
      profile?.subscription_status === "trialing";

    try {
      const admin = createAdminClient();
      if (isPaid) {
        await deleteTrialDecoyJobs(admin, user.id);
      }
    } catch {
      /* service role absent */
    }

    const { data: jobs } = await supabase
      .from("jobs")
      .select("cv_url,letter_url,fit_score,data,url")
      .eq("user_id", user.id)
      .eq("deleted", false);

    const lockedCount = countPendingUnlockJobs(jobs ?? []);

    let pending = false;
    try {
      const admin = createAdminClient();
      pending = await hasTrialUnlockPending(admin, user.id);
      if (isPaid && lockedCount > 0 && !pending) {
        await markTrialUnlockPending(admin, user.id);
        pending = true;
      }
    } catch {
      /* service role absent — lockedCount suffit côté client */
      pending = isPaid && lockedCount > 0;
    }

    return NextResponse.json({
      pending: isPaid && lockedCount > 0 && pending,
      lockedCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
