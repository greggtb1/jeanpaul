import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/storage/signed-url?url=<stored_url>
 * 
 * Prend une URL Supabase Storage (publique ou signée expirée) stockée en base,
 * extrait le chemin et retourne une URL signée fraîche valable 1h.
 * Nécessite une session auth valide.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url requis" }, { status: 400 });
  }

  const path = extractStoragePath(rawUrl);
  if (!path) {
    return NextResponse.json({ error: "URL de stockage invalide" }, { status: 400 });
  }

  // Sécurité : le chemin doit appartenir à l'utilisateur connecté
  // Schéma : apps/{user_id}/... ou {user_id}/... ou pending/{draftId}/...
  const userId = user.id;
  const isOwned =
    path.startsWith(`apps/${userId}/`) ||
    path.startsWith(`${userId}/`) ||
    path.startsWith("pending/"); // pendant l'onboarding

  if (!isOwned) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from("cvs")
      .createSignedUrl(path, 60 * 60); // 1h

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message ?? "Impossible de générer l'URL" }, { status: 500 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function extractStoragePath(url: string): string | null {
  for (const marker of [
    "/storage/v1/object/public/cvs/",
    "/storage/v1/object/sign/cvs/",
    "/storage/v1/object/authenticated/cvs/",
  ]) {
    if (url.includes(marker)) {
      return url.split(marker)[1].split("?")[0];
    }
  }
  return null;
}
