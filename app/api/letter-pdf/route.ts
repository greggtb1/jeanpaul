import { buildLetterPdfBuffer, letterPdfFilename, type LetterSender } from "@/lib/letter-pdf-build";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as {
      body?: string;
      company?: string;
      title?: string;
      sender?: LetterSender;
    };

    const body = payload.body?.trim();
    const company = payload.company?.trim() || "Entreprise";
    const title = payload.title?.trim() || "Poste";

    if (!body) {
      return Response.json({ error: "Texte de la lettre manquant." }, { status: 400 });
    }

    const pdf = buildLetterPdfBuffer(body, company, title, payload.sender || { name: "Candidat" });
    const filename = letterPdfFilename(company);

    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return Response.json(
      { error: (e as Error).message || "Génération PDF impossible." },
      { status: 500 }
    );
  }
}
