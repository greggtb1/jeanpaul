import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/storage/save-cv
 * multipart : file (PDF) + url (URL de stockage existante du CV)
 *
 * Écrase le PDF du CV à son emplacement actuel (upsert) après avoir vérifié
 * que le chemin appartient bien à l'utilisateur connecté.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let file: FormDataEntryValue | null = null;
  let rawUrl = "";
  try {
    const form = await req.formData();
    file = form.get("file");
    rawUrl = typeof form.get("url") === "string" ? (form.get("url") as string) : "";
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fichier manquant" }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "PDF uniquement" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 });
  }

  const path = extractStoragePath(rawUrl);
  if (!path) {
    return NextResponse.json({ error: "URL de stockage invalide" }, { status: 400 });
  }

  const userId = user.id;
  const isOwned =
    path.startsWith(`apps/${userId}/`) || path.startsWith(`${userId}/`);
  if (!isOwned) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from("cvs").upload(path, buffer, {
      upsert: true,
      contentType: "application/pdf",
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
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
