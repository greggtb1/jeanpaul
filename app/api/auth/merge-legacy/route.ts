import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Rattache les données d'un ancien profil (localStorage) au compte auth par email. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    await admin.rpc("merge_legacy_profile", {
      p_new_id: user.id,
      p_email: user.email,
    });
  } catch {
    /* pas de legacy à fusionner */
  }

  return NextResponse.json({ ok: true });
}
