const LETTER_ACCEPT =
  ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export const LETTER_FILE_ACCEPT = LETTER_ACCEPT;

function isPlainTextFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".text")
  );
}

export async function extractLetterText(file: File): Promise<string> {
  if (isPlainTextFile(file)) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("Le fichier est vide.");
    return text;
  }

  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extract-letter", { method: "POST", body: fd });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Le serveur n'a pas pu lire le PDF. Réessayez ou importez un .docx / .txt.");
  }
  const data = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "Extraction impossible.");
  if (!data.text?.trim()) throw new Error("Aucun texte extrait du document.");
  return data.text;
}
