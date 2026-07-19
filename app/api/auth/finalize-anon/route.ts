import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MIN_PASSWORD = 6;

/**
 * Convertit une session anonyme en compte permanent via l'API admin
 * (email + mot de passe, email_confirm=true) — sans e-mail de confirmation.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    let body: { email?: string; password?: string } = {};
    try {
      body = (await req.json()) as { email?: string; password?: string };
    } catch {
      body = {};
    }

    const pendingEmail =
      typeof user.new_email === "string" ? user.new_email.trim().toLowerCase() : "";
    const email = (body.email || user.email || pendingEmail || "")
      .trim()
      .toLowerCase();
    const password = (body.password || "").trim();

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { error: "Indiquez une adresse e-mail valide." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Compte déjà permanent : forcer email confirmé (sans mail).
    if (!user.is_anonymous) {
      await admin.auth.admin.updateUserById(user.id, {
        email,
        email_confirm: true,
      });
      return NextResponse.json({ ok: true, alreadyPermanent: true });
    }

    // Password requis sauf reprise d'un ancien flux (email_change pending + mdp déjà posé).
    const patch: {
      email: string;
      email_confirm: true;
      password?: string;
    } = {
      email,
      email_confirm: true,
    };
    if (password.length >= MIN_PASSWORD) {
      patch.password = password;
    } else if (!pendingEmail) {
      return NextResponse.json(
        {
          error: `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`,
        },
        { status: 400 }
      );
    }

    const { error } = await admin.auth.admin.updateUserById(user.id, patch);

    if (error) {
      const msg = error.message || "Impossible de créer le compte";
      if (/already|registered|exists|duplicate/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              "Cet e-mail est déjà utilisé. Connectez-vous avec ce compte, ou choisissez une autre adresse.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    await admin
      .from("profiles")
      .update({
        email,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur serveur";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
