import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const draftId = formData.get("draft_id");

    if (!(file instanceof File) || typeof draftId !== "string") {
      return NextResponse.json({ error: "Fichier ou draft_id manquant" }, { status: 400 });
    }

    if (!/^[0-9a-f-]{36}$/i.test(draftId)) {
      return NextResponse.json({ error: "draft_id invalide" }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF uniquement" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 10 Mo)" }, { status: 400 });
    }

    const admin = createAdminClient();
    const safeName = file.name.replace(/[^\w.\-]/g, "_");
    const path = `pending/${draftId}/${Date.now()}_${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage.from("cvs").upload(path, buffer, {
      upsert: true,
      contentType: "application/pdf",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data } = admin.storage.from("cvs").getPublicUrl(path);
    return NextResponse.json({
      url: data.publicUrl,
      filename: file.name,
      path,
    });
  } catch (e) {
    const message = (e as Error).message;
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
