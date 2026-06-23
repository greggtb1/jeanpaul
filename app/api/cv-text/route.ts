import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanDocumentText, extractPdfText } from "@/lib/pdf-text";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let rawUrl = "";
  try {
    const body = await req.json();
    rawUrl = typeof body?.url === "string" ? body.url : "";
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const path = extractStoragePath(rawUrl);
  if (!path) {
    return NextResponse.json({ error: "URL de stockage invalide" }, { status: 400 });
  }

  const userId = user.id;
  const isOwned =
    path.startsWith(`apps/${userId}/`) ||
    path.startsWith(`${userId}/`) ||
    path.startsWith("pending/");

  if (!isOwned) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from("cvs").download(path);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Impossible de charger le CV" },
        { status: 500 }
      );
    }

    const buf = Buffer.from(await data.arrayBuffer());
    const text = cleanDocumentText(await extractPdfText(buf));
    if (!text) {
      return NextResponse.json({ error: "Aucun texte lisible dans ce CV" }, { status: 400 });
    }

    return NextResponse.json({ text });
  } catch (e) {
    console.error("[cv-text]", e);
    return NextResponse.json({ error: "Impossible d'extraire le CV" }, { status: 500 });
  }
}

function extractStoragePath(url: string): string | null {
  for (const marker of [
    "/storage/v1/object/public/cvs/",
    "/storage/v1/object/sign/cvs/",
    "/storage/v1/object/authenticated/cvs/",
  ]) {
    if (url.includes(marker)) {
      return decodeURIComponent(url.split(marker)[1].split("?")[0]);
    }
  }
  return null;
}
