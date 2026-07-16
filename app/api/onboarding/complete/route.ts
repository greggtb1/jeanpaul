import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Body = {
  full_name?: string;
  email?: string;
  phone?: string;
  location?: string;
  target_roles?: string[];
  target_locations?: string[];
  location_search_mode?: "city" | "radius";
  location_radius_km?: number;
  contract_type?: string[];
  remote_pref?: string[];
  salary_min?: number;
  letter_tone?: string;
  letter_sample?: string;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  const subscribed =
    profile?.subscription_status === "active" ||
    profile?.subscription_status === "trialing";

  if (!subscribed) {
    return NextResponse.json({ error: "Abonnement inactif" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const { error } = await admin
    .from("profiles")
    .update({
      full_name: body.full_name || null,
      email: body.email || null,
      phone: body.phone || null,
      location: body.location || null,
      target_roles: body.target_roles?.length ? body.target_roles : null,
      target_locations: body.target_locations?.length ? body.target_locations : null,
      location_search_mode: body.location_search_mode || "city",
      location_radius_km:
        body.location_search_mode === "city" ? null : body.location_radius_km ?? 25,
      contract_type: body.contract_type?.length ? body.contract_type : null,
      remote_pref: body.remote_pref?.length ? body.remote_pref : null,
      salary_min: body.salary_min ?? null,
      letter_tone: body.letter_tone || null,
      letter_sample: body.letter_sample || null,
      onboarding_done: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
