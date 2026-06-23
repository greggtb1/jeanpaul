import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MIN_PASSWORD = 6;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) {
      return NextResponse.json({ error: "Email et mot de passe requis." }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        affiliate_only: true,
      },
    });

    if (error || !data.user) {
      const message = error?.message?.toLowerCase() || "Erreur";
      const status = message.includes("already") || message.includes("registered") ? 409 : 400;
      return NextResponse.json(
        {
          error:
            status === 409
              ? "Un compte existe déjà avec cet email. Connectez-vous."
              : error?.message || "Impossible de créer le compte.",
        },
        { status }
      );
    }

    await admin.from("profiles").upsert({
      id: data.user.id,
      email,
      full_name: null,
      onboarding_done: false,
      subscription_status: "none",
      plan_id: "chill",
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, user_id: data.user.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

