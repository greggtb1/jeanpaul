import { cleanDocumentText, extractPdfText } from "@/lib/pdf-text";
import { parseCvProfile } from "@/lib/parse-cv-profile";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Fichier manquant." }, { status: 400 });
    }

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return Response.json({ error: "PDF uniquement pour l'extraction de profil." }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const raw = cleanDocumentText(await extractPdfText(buf));
    if (!raw) {
      return Response.json(
        { error: "Aucun texte lisible dans ce PDF (scanné ?)." },
        { status: 400 }
      );
    }

    const profile = parseCvProfile(raw);
    return Response.json({ profile });
  } catch (err) {
    console.error("[extract-cv]", err);
    return Response.json({ error: "Impossible d'analyser le CV." }, { status: 500 });
  }
}
