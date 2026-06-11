import mammoth from "mammoth";
import { cleanDocumentText, extractPdfText } from "@/lib/pdf-text";

export const runtime = "nodejs";

const MAX_CHARS = 12_000;

function pickMainBody(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 40);

  if (blocks.length <= 2) return text;

  const scored = blocks.map((block, i) => {
    const words = block.split(/\s+/).length;
    const letterish =
      /(?:madame|monsieur|cher|chère|objet|cordialement|salutations|motiv|poste|candidature)/i.test(
        block
      );
    return { block, score: words + (letterish ? 80 : 0) - i * 2 };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 6).sort((a, b) => text.indexOf(a.block) - text.indexOf(b.block));
  const joined = top.map((s) => s.block).join("\n\n");
  return joined.length > text.length * 0.35 ? joined : text;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Fichier manquant." }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buf = Buffer.from(await file.arrayBuffer());
    let raw = "";

    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      raw = await extractPdfText(buf);
    } else if (
      name.endsWith(".docx") ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: buf });
      raw = result.value || "";
    } else if (isPlainText(name, file.type)) {
      raw = buf.toString("utf-8");
    } else {
      return Response.json(
        { error: "Format accepté : PDF, Word (.docx), .txt ou .md." },
        { status: 400 }
      );
    }

    const cleaned = cleanDocumentText(raw);
    if (!cleaned) {
      return Response.json(
        { error: "Aucun texte lisible dans ce document (PDF scanné ?)." },
        { status: 400 }
      );
    }

    const text = pickMainBody(cleaned).slice(0, MAX_CHARS);
    return Response.json({ text });
  } catch {
    return Response.json({ error: "Impossible d'extraire le texte du document." }, { status: 500 });
  }
}

function isPlainText(name: string, type: string): boolean {
  return type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md");
}
